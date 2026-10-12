import { test as base, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const EXTENSION = path.join(ROOT, 'extension');
const LIST_JS = readFileSync(path.join(import.meta.dirname, 'fixture', 'list.js'), 'utf8');

export const OWNER = 'acme';
export const REPO = 'widgets';
export const PULLS_URL = `https://github.com/${OWNER}/${REPO}/pulls`;
export const OTHER_REPO = 'gadgets'; // a second repository, for navigation between lists
export const TOKEN = 'ghp_testtokentesttokentesttokentest0001';

export const sha = n => n.toString(16).padStart(40, '0');

const green = () => [
  { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { __typename: 'CheckRun', name: 'unit tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
];

// One PR per readiness state.
export function scenario() {
  const pr = (number, title, over = {}) => ({
    number, title, label: title.split(': ')[1].split('/')[0],
    state: 'OPEN', isDraft: false, isInMergeQueue: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    reviewDecision: null, headRefOid: sha(number), contexts: green(), rollupState: 'SUCCESS', ...over,
  });
  return [
    pr(1, 'sync: alice/web-ready-1'),
    pr(2, 'sync: alice/web-ready-2'),
    pr(3, 'sync: bob/pwn-ready-3'),
    pr(4, 'sync: bob/crypto-dup-id', { mergeStateStatus: 'UNSTABLE', rollupState: 'FAILURE',
      contexts: [green()[0], { __typename: 'CheckRun', name: 'unit tests', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
    pr(5, 'sync: carol/rev-slow', { mergeStateStatus: 'UNSTABLE', rollupState: 'PENDING',
      contexts: [...green(), { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null }] }),
    pr(7, 'sync: gina/web-draft', { isDraft: true, mergeStateStatus: 'DRAFT' }),
    pr(8, 'sync: frank/web-stale', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
  ];
}

const checksLabel = pr => {
  const done = pr.contexts.filter(c => c.status === 'COMPLETED' && c.conclusion === 'SUCCESS').length;
  return `${done}/${pr.contexts.length}`;
};

// In acme/gadgets, #1 is still running: it must never borrow acme/widgets #1's verdict.
export function otherScenario() {
  return [
    { ...scenario()[4], number: 1, title: 'sync: dora/net-slow', label: 'dora', headRefOid: sha(9001) },
    { ...scenario()[0], number: 2, title: 'sync: dora/net-ready', label: 'dora', headRefOid: sha(9002) },
  ];
}

function pageHtml(repos, theme) {
  const data = JSON.stringify(Object.fromEntries([...repos].map(([name, prs]) => [name,
    [...prs.values()].map(pr => ({ number: pr.number, title: pr.title, label: pr.label, checks: checksLabel(pr) }))])));
  return `<!doctype html>
<html lang="en" data-color-mode="${theme}" data-light-theme="light" data-dark-theme="dark_colorblind">
<head>
<meta charset="utf-8"><title>Pull requests · ${OWNER}/${REPO}</title>
<style>
  :root {
    --fgColor-default: #1f2328; --fgColor-muted: #59636e; --fgColor-success: #1a7f37; --fgColor-danger: #d1242f;
    --fgColor-attention: #9a6700; --fgColor-done: #8250df; --fgColor-disabled: #818b98; --fgColor-accent: #0969da;
    --bgColor-default: #ffffff; --bgColor-muted: #f6f8fa; --bgColor-disabled: #eff2f5; --bgColor-neutral-muted: #818b981f;
    --bgColor-attention-muted: #fff8c5; --borderColor-default: #d1d9e0; --borderColor-muted: #d1d9e0b3;
    --borderRadius-medium: .375rem; --borderRadius-large: .75rem;
    --button-default-bgColor-rest: #f6f8fa; --button-default-bgColor-hover: #eff2f5; --button-default-borderColor-rest: #d1d9e0;
    --button-default-fgColor-rest: #25292e; --button-primary-bgColor-rest: #1f883d; --button-primary-bgColor-hover: #1c8139;
    --button-primary-borderColor-rest: #1f232826; --button-primary-fgColor-rest: #ffffff; --control-borderColor-rest: #d1d9e0;
    --control-transparent-bgColor-hover: #818b9826; --focus-outlineColor: #0969da; --overlay-backdrop-bgColor: #c8d1da66;
    --shadow-floating-large: 0 0 0 1px #d1d9e0, 0 40px 80px 0 #25292e3d;
    --overlay-bgColor: #ffffff; --overlay-borderColor: #d1d9e080; --control-bgColor-rest: #f6f8fa; --control-bgColor-hover: #eff2f5;
  }
  [data-color-mode="dark"] {
    --fgColor-default: #f0f6fc; --fgColor-muted: #9198a1; --fgColor-success: #58a6ff; --fgColor-danger: #f0883e;
    --fgColor-attention: #d29922; --fgColor-done: #b7bdc8; --fgColor-disabled: #656c76; --fgColor-accent: #4493f8;
    --bgColor-default: #0d1117; --bgColor-muted: #151b23; --bgColor-disabled: #212830; --bgColor-neutral-muted: #656c7633;
    --bgColor-attention-muted: #bb800926; --borderColor-default: #3d444d; --borderColor-muted: #3d444db3;
    --button-default-bgColor-rest: #212830; --button-default-bgColor-hover: #262c36; --button-default-borderColor-rest: #3d444d;
    --button-default-fgColor-rest: #f0f6fc; --button-primary-bgColor-rest: #1f6feb; --button-primary-bgColor-hover: #2a7aef;
    --button-primary-borderColor-rest: #ffffff26; --button-primary-fgColor-rest: #ffffff; --control-borderColor-rest: #3d444d;
    --control-transparent-bgColor-hover: #656c7633; --focus-outlineColor: #1f6feb; --overlay-backdrop-bgColor: #21283066;
    --shadow-floating-large: 0 0 0 1px #3d444d, 0 24px 48px 0 #010409;
    --overlay-bgColor: #010409; --overlay-borderColor: #3d444db3; --control-bgColor-rest: #212830; --control-bgColor-hover: #262c36;
  }
  body { margin: 0; background: var(--bgColor-default); color: var(--fgColor-default);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 24px 32px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  #app { border: 1px solid var(--borderColor-default); border-radius: 6px; }
  .fx-metadata { display: flex; align-items: center; gap: 16px; min-height: 48px; padding: 0 16px;
    background: var(--bgColor-muted); border-bottom: 1px solid var(--borderColor-default); border-radius: 6px 6px 0 0; }
  .fx-selectall { display: flex; align-items: center; gap: 12px; } .fx-count { margin: 0; font-weight: 600; }
  .fx-toolbar { display: flex; flex: 1 1 auto; justify-content: flex-end; } .fx-actions { display: flex; gap: 8px; margin-left: auto; }
  .fx-btn { height: 32px; padding: 0 12px; border: 1px solid var(--button-default-borderColor-rest); border-radius: 6px;
    background: var(--button-default-bgColor-rest); color: var(--button-default-fgColor-rest); font: inherit; font-weight: 500; }
  .fx-btn:disabled { color: var(--fgColor-disabled); }
  /* Primer lays a button's content out as a centered flex row; mirror that so a cloned button lines up. */
  .fx-btn [data-component="buttonContent"] { display: inline-flex; align-items: center; gap: 8px; }
  ul[role="list"] { list-style: none; margin: 0; padding: 0; }
  .fx-row { display: grid; grid-template-columns: 40px 1fr; grid-template-areas: "selection primary" "selection main";
    padding: 8px 16px 8px 0; border-top: 1px solid var(--borderColor-muted); }
  .fx-row:first-child { border-top: 0; }
  .fx-title { grid-area: primary; } .fx-title h3 { display: inline; font-size: 16px; margin: 0; }
  .fx-title a { color: var(--fgColor-default); font-weight: 600; text-decoration: none; }
  .fx-label { margin-left: 6px; padding: 0 7px; border: 1px solid #2ea04366; border-radius: 2em; color: #3fb950; font-size: 12px; font-weight: 500; }
  .fx-select { grid-area: selection; display: flex; justify-content: center; padding-top: 4px; }
  .fx-main { grid-area: main; } .fx-line { display: flex; flex-wrap: wrap; align-items: center; color: var(--fgColor-muted); font-size: 12px; }
</style>
</head>
<body><main><h1>All pull requests</h1><div id="app"></div></main>
<script type="application/json" id="prs">${data}</script>
<script src="/__fixture/list.js"></script>
</body></html>`;
}

function pullNode(pr) {
  const runs = pr.contexts.filter(c => c.__typename === 'CheckRun').length;
  return {
    number: pr.number, title: pr.title, state: pr.state, isDraft: pr.isDraft, isInMergeQueue: pr.isInMergeQueue,
    mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus, reviewDecision: pr.reviewDecision, headRefOid: pr.headRefOid,
    statusCheckRollup: {
      state: pr.rollupState,
      commit: { oid: pr.headRefOid },
      contexts: { totalCount: pr.contexts.length, checkRunCount: runs, statusContextCount: pr.contexts.length - runs, pageInfo: { hasNextPage: false }, nodes: pr.contexts },
    },
  };
}

// A small, stateful GitHub: readiness over GraphQL and merges over the async merge API.
export class FakeGitHub {
  constructor() {
    this.repos = new Map([
      [`${OWNER}/${REPO}`, new Map(scenario().map(pr => [pr.number, pr]))],
      [`${OWNER}/${OTHER_REPO}`, new Map(otherScenario().map(pr => [pr.number, pr]))],
    ]);
    this.prs = this.repos.get(`${OWNER}/${REPO}`);
    this.calls = [];
    this.graphqlStatus = 200;
    this.readinessDelayMs = {}; // per "owner/repo"
    this.mergeDelayMs = 0;
    this.failMergePoll = false;
    this.baseMovedOnce = new Set(); // PR numbers whose first merge GitHub refuses as "base branch was modified"
    this.baseMovedAlways = new Set(); // ...and whose every merge it refuses that way
    this.throttledReads = 0; // how many merge-result reads GitHub answers with a secondary rate limit
    this.throttledRetryReads = 0; // the same, but only for a PR's second merge request (the retry)
    this.puts = new Map(); // PR number -> merge requests received
    this.onMerged = () => {};
  }

  async install(context) {
    await context.route('https://api.github.com/**', route => this.handle(route));
  }

  async handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON?.() ?? null;
    this.calls.push({ method: request.method(), path: url.pathname, body, auth: await request.headerValue('authorization'), fromWorker: Boolean(request.serviceWorker()) });

    if (url.pathname === '/graphql') {
      if (this.rateLimited) {
        return route.fulfill({ status: 403, json: { message: 'API rate limit exceeded' },
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
      }
      if (this.graphqlStatus !== 200) return route.fulfill({ status: this.graphqlStatus, json: { message: 'Bad credentials' } });
      const name = `${body.variables.owner}/${body.variables.repo}`;
      const delay = this.readinessDelayMs[name];
      if (delay) await sleep(delay);
      const prs = this.repos.get(name) ?? new Map();
      const numbers = [...body.query.matchAll(/pr(\d+): pullRequest\(number: (\d+)\)/g)].map(m => Number(m[2]));
      const repository = { viewerPermission: 'ADMIN', viewerDefaultMergeMethod: 'SQUASH', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true };
      for (const n of numbers) repository[`pr${n}`] = prs.has(n) ? pullNode(prs.get(n)) : null;
      return route.fulfill({ json: { data: { repository } } });
    }

    let match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge-async$/);
    if (match && request.method() === 'PUT') {
      const pr = this.repos.get(`${match[1]}/${match[2]}`).get(Number(match[3]));
      this.puts.set(pr.number, (this.puts.get(pr.number) ?? 0) + 1);
      if (body.sha !== pr.headRefOid) return route.fulfill({ status: 400, json: { status: 'failed', details: { message: 'Pull request head branch was modified.' } } });
      return route.fulfill({ status: 202, json: { status: 'pending', details: { uuid: `00000000-0000-4000-8000-${String(pr.number).padStart(12, '0')}` } } });
    }
    match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge-async\/[0-9a-f-]{36}$/);
    if (match) {
      if (this.mergeDelayMs) await sleep(this.mergeDelayMs);
      const pr = this.repos.get(`${match[1]}/${match[2]}`).get(Number(match[3]));
      const throttleRetry = this.throttledRetryReads > 0 && (this.puts.get(pr.number) ?? 0) >= 2;
      if (this.throttledReads > 0 || throttleRetry) {
        if (throttleRetry) this.throttledRetryReads -= 1;
        else this.throttledReads -= 1;
        // Header-less, as GitHub sometimes answers: the message is the only hint.
        return route.fulfill({ status: 403, json: { message: 'You have exceeded a secondary rate limit.' } });
      }
      if (this.baseMovedOnce.delete(pr.number) || this.baseMovedAlways.has(pr.number)) {
        return route.fulfill({ json: { status: 'failed', details: { message: 'Base branch was modified. Review and try the merge again.' } } });
      }
      if (pr.mergeable === 'CONFLICTING') {
        return route.fulfill({ json: { status: 'failed', details: { message: 'Merge conflict between base and head' } } });
      }
      pr.state = 'MERGED'; // GitHub merged it, whether or not the answer gets back
      this.onMerged(pr);
      if (this.failMergePoll) return route.abort('connectionreset');
      return route.fulfill({ json: { status: 'merged', details: { message: 'Pull request was merged.', sha: sha(1000 + pr.number) } } });
    }
    if (url.pathname === '/user') {
      return route.fulfill({ json: { login: 'octotester' }, headers: { 'x-oauth-scopes': this.scopes ?? 'repo, read:org' } });
    }
    return route.fulfill({ status: 404, json: { message: 'Not Found' } });
  }

  merges() {
    return this.calls.filter(call => call.method === 'PUT');
  }
}

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless: full Chrome, so extensions load
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      viewport: { width: 1280, height: 800 },
    });
    // Offline by default; registered first so every later route takes precedence. Only web
    // traffic: the extension's own chrome-extension:// files must still load.
    await context.route(url => url.protocol === 'http:' || url.protocol === 'https:', route => route.abort('internetdisconnected'));
    // A fresh profile is a fresh install, which opens the settings tab once. Close it so it
    // cannot take over the test's page, and remember that it opened.
    const isSettings = page => page.url().endsWith('/src/options.html');
    await expect.poll(() => context.pages().some(isSettings), { timeout: 10_000 }).toBe(true).catch(() => {});
    context.openedSettingsOnInstall = context.pages().some(isSettings);
    for (const page of context.pages().filter(isSettings)) await page.close();
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await use(worker);
  },
  github: async ({ context }, use) => {
    const github = new FakeGitHub();
    await github.install(context);
    await use(github);
  },
  pulls: async ({ context, github }, use) => {
    const serve = async (theme = 'light') => {
      await context.route('https://github.com/__fixture/list.js', route => route.fulfill({ contentType: 'text/javascript', body: LIST_JS }));
      // Every acme page (repository home and pull request lists) is the same React-like app.
      await context.route(/^https:\/\/github\.com\/acme\/[^/]+(\/pulls)?\/?(\?.*)?$/, route => route.fulfill({
        contentType: 'text/html',
        // GitHub's real policy for scripts and styles on this page, with the fixture script allowed as 'self'.
        headers: { 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' github.githubassets.com" },
        body: pageHtml(github.repos, theme),
      }));
    };
    await use(serve);
  },
});

// An unlocked extension: the token in memory (session storage), as after entering the passphrase.
export async function signIn(worker) {
  await worker.evaluate(token => Promise.all([
    chrome.storage.session.set({ token }),
    chrome.storage.local.set({ login: 'octotester' }),
  ]), TOKEN);
}

// Evaluates expressions in the content script's isolated world. Call it before the page loads:
// DevTools announces the world as the page starts.
export async function isolatedWorld(context, page) {
  const cdp = await context.newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await cdp.send('Runtime.enable');
  return async expression => {
    const world = worlds.filter(w => w.auxData?.type === 'isolated' && w.name === 'Bulk Merge for GitHub').at(-1);
    const { result } = await cdp.send('Runtime.evaluate', { contextId: world.id, awaitPromise: true, returnByValue: true, expression });
    return result.value;
  };
}

export const row = (page, number) => page.locator(`li[id$="-list-view-node-${number}"]`);
export const checkbox = (page, number) => row(page, number).locator('input[data-listview-component="selection-input"]');
export const statusOf = (page, number) => row(page, number).locator('.prm-chip');
export const bulkButton = page => page.locator('.prm-action-button');

export { expect };
