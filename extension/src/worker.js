// Service worker: the only place the GitHub token is read and the only place that talks
// to GitHub. Content scripts send PR numbers and get back verdicts or merge outcomes.

import {
  fetchReadiness, freshVerdict, submitMerge, readMerge, mergeOutcome, inspectToken,
  GitHubError, NAME, SHA, UUID, METHODS,
} from './github.js';
import { seal, unseal } from './vault.js';

const ROUTE = /^\/([^/]+)\/([^/]+)\/pulls\/?$/;
const OPTIONS_URL = chrome.runtime.getURL('src/options.html');
const MAX_PRS = 100;

// The token reaches disk only sealed with the maintainer's passphrase (vault.js, in
// storage.local). Unlocked, it lives in storage.session: memory only, gone when Chrome closes
// or the maintainer locks it. Both areas are closed to content scripts.
const storageReady = Promise.allSettled([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

async function getToken() {
  await storageReady;
  const { token } = await chrome.storage.session.get('token');
  return typeof token === 'string' && token ? token : null;
}

// none: nothing saved. locked: sealed on disk, not unlocked since Chrome started. unlocked: ready.
async function tokenState() {
  if (await getToken()) return 'unlocked';
  const { vault } = await chrome.storage.local.get('vault');
  return vault ? 'locked' : 'none';
}

const validName = name => typeof name === 'string' && NAME.test(name) && name !== '.' && name !== '..';
const validNumber = n => Number.isSafeInteger(n) && n > 0;

const fromGitHubTab = sender => sender.id === chrome.runtime.id && sender.origin === 'https://github.com'
  && sender.frameId === 0 && typeof sender.tab?.id === 'number';

// Messages from GitHub pages are trusted only for the repository the tab is showing. The tab's
// URL, not sender.url: sender.url is frozen at document load and GitHub navigates in place.
function pullListOf(sender, message) {
  if (!fromGitHubTab(sender) || typeof sender.tab.url !== 'string') return null;
  const url = new URL(sender.tab.url);
  if (url.origin !== 'https://github.com') return null;
  const match = url.pathname.match(ROUTE);
  if (!match || !validName(match[1]) || !validName(match[2])) return null;
  if (message.owner !== match[1] || message.repo !== match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

const fromOptionsPage = sender => sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === OPTIONS_URL;

const REJECTED = { ok: false, error: 'bad-request', message: 'Request rejected' };

async function readinessFor(message, sender) {
  const page = pullListOf(sender, message);
  const { numbers } = message;
  if (!page || !Array.isArray(numbers) || numbers.length === 0 || numbers.length > MAX_PRS || !numbers.every(validNumber)) {
    return REJECTED;
  }
  const token = await getToken();
  if (!token) {
    return (await tokenState()) === 'none'
      ? { ok: false, error: 'no-token' }
      : { ok: false, error: 'locked', message: 'The extension is locked. Unlock it in the extension settings.' };
  }
  try {
    const { methods, prs } = await fetchReadiness(token, page.owner, page.repo, numbers);
    return { ok: true, methods, prs };
  } catch (error) {
    return { ok: false, error: error.kind ?? 'api', message: error.message, retryAfterMs: error.retryAfterMs ?? 0 };
  }
}

const failure = error => ({
  status: 'failed',
  detail: error.message || 'Unexpected error',
  fatal: !(error instanceof GitHubError) || error.kind !== 'api',
});

function mergeRequest(message, sender) {
  const page = pullListOf(sender, message);
  const { number, headOid, method, runId } = message;
  if (!page || !validNumber(number) || !SHA.test(headOid ?? '') || !METHODS.includes(method) || !UUID.test(runId ?? '')) return null;
  return { ...page, number, headOid, method, runId };
}

// Runs the maintainer stopped (or that hit a fatal error). Checked right before every merge
// request, so a PR whose re-check was still running when Stop was pressed is not sent.
const stoppedRuns = new Set();
const STOPPED = { status: 'skipped', detail: 'Stopped before sending' };

const REJECTED_MERGE = { status: 'failed', detail: 'Request rejected', fatal: true };
const NO_TOKEN = { status: 'failed', detail: 'The extension is locked or has no GitHub token. Unlock it in the extension settings.', fatal: true };

// Re-reads the PR; null when it is still ready at exactly the commit the user confirmed.
async function stillReady(token, { owner, repo, number, headOid, method }) {
  const verdict = await freshVerdict(token, owner, repo, number);
  if (verdict.headOid !== headOid) return { status: 'skipped', detail: 'New commits were pushed after you confirmed' };
  if (verdict.code !== 'ready') return { status: 'skipped', detail: verdict.label };
  if (!verdict.methods.allowed.includes(method)) {
    return { status: 'failed', detail: `This repository does not allow ${method.toLowerCase()} merges`, fatal: true };
  }
  return null;
}

// Re-checks one PR and hands its merge to GitHub without waiting for it to finish; the page
// reads the outcome with merge-status.
async function submitOne(message, sender) {
  const merge = mergeRequest(message, sender);
  if (!merge) return REJECTED_MERGE;
  const token = await getToken();
  if (!token) return NO_TOKEN;
  try {
    const notReady = await stillReady(token, merge);
    if (notReady) return notReady;
    if (stoppedRuns.has(merge.runId)) return STOPPED;
    return { ...mergeOutcome(await submitMerge(token, merge.owner, merge.repo, merge.number, merge.headOid, merge.method)), sent: true };
  } catch (error) {
    return failure(error);
  }
}

// Reads the results of merges already handed to GitHub, for up to 100 PRs at once.
// A read GitHub could not answer stays pending and says so (unreachable); the page decides
// when that has gone on long enough to call the outcome unknown.
async function mergeStatus(message, sender) {
  const page = pullListOf(sender, message);
  const { entries } = message;
  const valid = Array.isArray(entries) && entries.length > 0 && entries.length <= MAX_PRS
    && entries.every(entry => validNumber(entry?.number) && UUID.test(entry?.uuid ?? ''));
  if (!page || !valid) return REJECTED;
  const token = await getToken();
  if (!token) return { ok: false, error: 'no-token' };
  const results = await Promise.all(entries.map(async ({ number, uuid }) => {
    try {
      return [number, mergeOutcome(await readMerge(token, page.owner, page.repo, number, uuid))];
    } catch (error) {
      // Reading a result changes nothing: when GitHub is unreachable or throttling reads, wait
      // and read again; the page decides when that has gone on long enough.
      if (error instanceof GitHubError && (error.kind === 'network' || error.kind === 'rate-limit')) {
        return [number, { status: 'pending', unreachable: true, retryAfterMs: error.retryAfterMs ?? 0 }];
      }
      return [number, mergeOutcome({ state: 'unknown', message: error.message })];
    }
  }));
  return { ok: true, results: Object.fromEntries(results) };
}

async function saveToken({ token: raw, passphrase }) {
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (token.length < 20 || token.length > 255 || !/^[\x21-\x7e]+$/.test(token)) {
    return { ok: false, message: 'That does not look like a GitHub token.' };
  }
  if (typeof passphrase !== 'string' || passphrase.length < 10 || passphrase.length > 1024) {
    return { ok: false, message: 'Use a passphrase of at least 10 characters.' };
  }
  try {
    const { login } = await inspectToken(token);
    await storageReady;
    await chrome.storage.local.set({ vault: await seal(token, passphrase), login });
    await chrome.storage.session.set({ token });
    return { ok: true, login };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function unlock(message) {
  if (typeof message.passphrase !== 'string' || !message.passphrase) return { ok: false, message: 'Enter your passphrase.' };
  const { vault, login } = await chrome.storage.local.get(['vault', 'login']);
  if (!vault) return { ok: false, message: 'There is no saved token to unlock.' };
  try {
    const token = await unseal(vault, message.passphrase);
    const { vault: current } = await chrome.storage.local.get('vault');
    if (current?.ciphertext !== vault.ciphertext) return { ok: false, message: 'The saved token changed while unlocking. Try again.' };
    await chrome.storage.session.set({ token });
    return { ok: true, login: login ?? null };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

// Token changes run one at a time, so a Remove cannot interleave with an Unlock or a Save.
let tokenQueue = Promise.resolve();
function serial(task) {
  const run = tokenQueue.then(task);
  tokenQueue = run.catch(() => {});
  return run;
}

async function handle(message, sender) {
  switch (message?.type) {
    case 'merge-stop':
      if (!fromGitHubTab(sender) || !UUID.test(message.runId ?? '')) return REJECTED;
      stoppedRuns.add(message.runId);
      if (stoppedRuns.size > 100) stoppedRuns.delete(stoppedRuns.values().next().value);
      return { ok: true };
    case 'readiness':
      return readinessFor(message, sender);
    case 'merge-submit':
      return submitOne(message, sender);
    case 'merge-status':
      return mergeStatus(message, sender);
    case 'open-options':
      if (fromGitHubTab(sender)) await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'theme': {
      // GitHub's theme choice, so the settings page can use the same palette.
      const { mode, light, dark } = message;
      const valid = ['light', 'dark', 'auto'].includes(mode) && [light, dark].every(name => typeof name === 'string' && /^[a-z_]{1,40}$/.test(name));
      if (!fromGitHubTab(sender) || !valid) return REJECTED;
      await chrome.storage.local.set({ theme: { mode, light, dark } });
      return { ok: true };
    }
    case 'token-status': {
      if (!fromOptionsPage(sender)) return REJECTED;
      const { login, theme } = await chrome.storage.local.get(['login', 'theme']);
      return { ok: true, state: await tokenState(), login: login ?? null, theme: theme ?? null };
    }
    case 'token-save':
      return fromOptionsPage(sender) ? serial(() => saveToken(message)) : REJECTED;
    case 'token-unlock':
      return fromOptionsPage(sender) ? serial(() => unlock(message)) : REJECTED;
    case 'token-lock':
      if (!fromOptionsPage(sender)) return REJECTED;
      return serial(async () => {
        await chrome.storage.session.remove('token');
        return { ok: true };
      });
    case 'token-clear':
      if (!fromOptionsPage(sender)) return REJECTED;
      return serial(async () => {
        await chrome.storage.local.remove(['vault', 'login']);
        await chrome.storage.session.remove('token');
        return { ok: true };
      });
    default:
      return REJECTED;
  }
}

// A plain listener that returns true keeps the channel open for the async reply.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse, error => sendResponse({ ok: false, error: 'internal', message: String(error?.message ?? error) }));
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install' && (await tokenState()) === 'none') chrome.runtime.openOptionsPage();
});
