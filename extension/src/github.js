// GitHub API calls made by the service worker. Every URL is built here from validated
// parts; nothing a caller passes is used as a URL.

import { readiness, describe } from './readiness.js';

const API = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const FETCH_TIMEOUT_MS = 25_000; // a fetch slower than 30s gets the service worker killed

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class GitHubError extends Error {
  // kind: auth | rate-limit | network | api
  constructor(kind, message, retryAfterMs = 0) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

// How long GitHub asks us to wait, from retry-after or the rate-limit reset time.
function retryAfterMs(headers) {
  const seconds = Number(headers.get('retry-after'));
  if (seconds > 0) return seconds * 1000;
  const reset = Number(headers.get('x-ratelimit-reset'));
  return reset > 0 ? Math.max(reset * 1000 - Date.now(), 0) : 0;
}

export const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
export const SHA = /^[0-9a-f]{40}$/;
export const METHODS = ['MERGE', 'SQUASH', 'REBASE'];

async function request(token, path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubError('network', 'Could not reach GitHub');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new GitHubError('auth', 'GitHub rejected the token. Update it in the extension settings.');
  // GitHub sometimes throttles without its usual headers, saying so only in the body.
  const limited = response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')
    || /rate limit/i.test(data?.message ?? '');
  if (response.status === 429 || (response.status === 403 && limited)) {
    throw new GitHubError('rate-limit', 'GitHub rate limit reached. Try again in a few minutes.', retryAfterMs(response.headers));
  }
  return { status: response.status, data, headers: response.headers };
}

const PR_FIELDS = `
  number title state isDraft isInMergeQueue mergeable mergeStateStatus reviewDecision headRefOid
  statusCheckRollup {
    state
    commit { oid }
    contexts(first: 100) {
      totalCount checkRunCount statusContextCount
      pageInfo { hasNextPage }
      nodes {
        __typename
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
      }
    }
  }`;

const MERGE_PERMISSIONS = new Set(['WRITE', 'MAINTAIN', 'ADMIN']);

// Returns { methods: { default, allowed }, prs: { [number]: verdict } } for one repository.
export async function fetchReadiness(token, owner, repo, numbers) {
  const aliases = numbers.map(n => `pr${n}: pullRequest(number: ${n}) { ...pr }`).join('\n');
  const query = `query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      viewerPermission viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
      ${aliases}
    }
  }
  fragment pr on PullRequest { ${PR_FIELDS} }`;

  const { status, data, headers } = await request(token, '/graphql', { method: 'POST', body: { query, variables: { owner, repo } } });
  if (status !== 200) throw new GitHubError('api', data?.message || `GitHub returned ${status}`);
  // GraphQL reports rate limits with HTTP 200.
  if (data.errors?.some(error => error.type === 'RATE_LIMITED')) {
    throw new GitHubError('rate-limit', 'GitHub rate limit reached. Try again in a few minutes.', retryAfterMs(headers));
  }
  // Partial data with errors (a permission gap, a missing PR) is never read as "no checks".
  if (data.errors?.length || !data.data?.repository) {
    throw new GitHubError('api', data.errors?.[0]?.message || 'GitHub returned no repository data');
  }

  const repository = data.data.repository;
  const allowed = [
    repository.mergeCommitAllowed && 'MERGE',
    repository.squashMergeAllowed && 'SQUASH',
    repository.rebaseMergeAllowed && 'REBASE',
  ].filter(Boolean);
  const canMerge = MERGE_PERMISSIONS.has(repository.viewerPermission);

  const prs = {};
  for (const number of numbers) {
    const pr = repository[`pr${number}`];
    if (!pr) continue;
    const code = canMerge ? readiness(pr) : 'no-permission';
    prs[number] = { ...describe(code), headOid: pr.headRefOid, title: pr.title };
  }
  return {
    methods: { default: repository.viewerDefaultMergeMethod, allowed },
    prs,
  };
}

// Re-reads one PR, giving GitHub time when it is still computing mergeability.
export async function freshVerdict(token, owner, repo, number) {
  const delays = [1_000, 2_000, 4_000, 8_000];
  for (let attempt = 0; ; attempt++) {
    const { methods, prs } = await fetchReadiness(token, owner, repo, [number]);
    const verdict = prs[number];
    if (!verdict) throw new GitHubError('api', `Pull request #${number} was not found`);
    if (verdict.code !== 'computing' || attempt === delays.length) return { ...verdict, methods };
    // A REST read is GitHub's documented trigger for computing mergeability.
    if (attempt === 0) await request(token, `/repos/${owner}/${repo}/pulls/${number}`);
    await sleep(delays[attempt]);
  }
}

export const UUID = /^[0-9a-f-]{36}$/i;

// Hands one merge to GitHub through the async merge API with bypass_rules=false, so GitHub
// itself refuses to skip repository rules even when the token's owner may bypass them.
// Resolves to { state: 'pending', uuid } while GitHub works on it, or a final
// { state: 'merged' | 'failed' | 'unknown', message }. Once the request may have reached
// GitHub, anything short of a definite answer is 'unknown', never 'failed'.
export async function submitMerge(token, owner, repo, number, sha, method) {
  let put;
  try {
    put = await request(token, `/repos/${owner}/${repo}/pulls/${number}/merge-async`, {
      method: 'PUT',
      body: { sha, merge_method: method.toLowerCase(), merge_action: 'direct_merge', bypass_rules: false },
    });
  } catch (error) {
    if (error.kind === 'network') return { state: 'unknown', message: 'The merge request may have reached GitHub but no answer came back' };
    throw error; // 401 and rate limits are refusals: nothing was merged
  }
  const message = put.data?.details?.message || put.data?.message || '';
  if (put.status === 200) return { state: put.data?.status === 'merged' ? 'merged' : 'unknown', message };
  if (put.status >= 500) return { state: 'unknown', message: message || `GitHub returned ${put.status}` };
  if (put.status !== 202) return { state: 'failed', message: message || `GitHub returned ${put.status}` };
  const uuid = put.data?.details?.uuid;
  if (!uuid || !UUID.test(uuid)) return { state: 'unknown', message: 'GitHub accepted the merge without a request id' };
  return { state: 'pending', uuid };
}

// Reads where a submitted merge stands: { state: 'pending' | 'merged' | 'failed' | 'enqueued' |
// 'unknown', message }. A 5xx counts as GitHub being unreachable (network); token and rate-limit
// problems throw GitHubError as everywhere else, so reading again later is safe.
const MERGE_STATES = new Set(['pending', 'merged', 'failed', 'enqueued']);

export async function readMerge(token, owner, repo, number, uuid) {
  const { status, data } = await request(token, `/repos/${owner}/${repo}/pulls/${number}/merge-async/${uuid}`);
  if (status >= 500) throw new GitHubError('network', `GitHub returned ${status}`);
  // GitHub explains a refused merge in the body, whatever the status code; keep its reason.
  if (MERGE_STATES.has(data?.status)) return { state: data.status, message: data?.details?.message || '' };
  if (status === 200) return { state: 'pending', message: '' };
  return { state: 'unknown', message: data?.details?.message || data?.message || `GitHub returned ${status} for the merge result` };
}

// What a merge result means for the run. fatal: stop sending further merges (an outcome nobody
// can confirm). retry: GitHub refused only because the base branch moved under it.
export function mergeOutcome(result) {
  if (result.state === 'pending') return { status: 'pending', uuid: result.uuid };
  if (result.state === 'merged') return { status: 'merged', detail: /already merged/i.test(result.message) ? 'Already merged' : '' };
  if (result.state === 'failed' && /base branch was modified/i.test(result.message)) return { status: 'retry' };
  if (result.state === 'failed') return { status: 'failed', detail: result.message || 'GitHub refused the merge' };
  if (result.state === 'enqueued') return { status: 'failed', detail: 'GitHub queued this merge instead of merging it', fatal: true, uncertain: true };
  const reason = (result.message || 'Merge outcome unknown').trim();
  return { status: 'failed', detail: `${/[.!?]$/.test(reason) ? reason : `${reason}.`} Check this pull request before retrying.`, fatal: true, uncertain: true };
}

// Validates a token for the settings page. Classic tokens only: fine-grained tokens are a
// documented gap for reading check runs, which would make checks look absent.
export async function inspectToken(token) {
  if (token.startsWith('github_pat_')) {
    throw new GitHubError('auth', 'Fine-grained tokens cannot always read check runs, so checks could look green when they are not. Use a classic token with the repo scope.');
  }
  const { status, data, headers } = await request(token, '/user');
  if (status !== 200 || !data?.login) throw new GitHubError('api', data?.message || `GitHub returned ${status}`);
  const scopes = (headers.get('x-oauth-scopes') || '').split(',').map(scope => scope.trim()).filter(Boolean);
  if (!scopes.includes('repo')) {
    throw new GitHubError('auth', `This token has no repo scope (scopes: ${scopes.join(', ') || 'none'}). Bulk merge needs repo to read checks and merge.`);
  }
  return { login: data.login };
}
