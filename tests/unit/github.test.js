import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReadiness, submitMerge, readMerge } from '../../extension/src/github.js';

// Every fetch gets this one response.
function answer(status, body, headers = {}) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers });
}

const SHA = 'a'.repeat(40);
const READY = {
  number: 1, title: 'Ready', state: 'OPEN', isDraft: false, isInMergeQueue: false, mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN', reviewDecision: null, headRefOid: SHA,
  statusCheckRollup: {
    state: 'SUCCESS', commit: { oid: SHA },
    contexts: { totalCount: 1, checkRunCount: 1, statusContextCount: 0, pageInfo: { hasNextPage: false },
      nodes: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
  },
};
const repository = viewerPermission => ({
  viewerPermission, viewerDefaultMergeMethod: 'MERGE', mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false, pr1: READY,
});

for (const [permission, code] of [['READ', 'no-permission'], ['TRIAGE', 'no-permission'], ['WRITE', 'ready'], ['MAINTAIN', 'ready'], ['ADMIN', 'ready']]) {
  test(`a ready PR with ${permission} permission -> ${code}`, async () => {
    answer(200, { data: { repository: repository(permission) } });
    const { prs } = await fetchReadiness('token', 'owner', 'repo', [1]);
    assert.equal(prs[1].code, code);
  });
}

test('partial data with errors is refused, never read as "no checks"', async () => {
  answer(200, { data: { repository: repository('ADMIN') }, errors: [{ message: 'Resource not accessible by integration' }] });
  await assert.rejects(fetchReadiness('token', 'owner', 'repo', [1]), { kind: 'api' });
});

test('a GraphQL rate limit reported with HTTP 200 is a rate limit', async () => {
  answer(200, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] });
  await assert.rejects(fetchReadiness('token', 'owner', 'repo', [1]), { kind: 'rate-limit' });
});

// GitHub sometimes throttles without its rate-limit headers. That is a rate limit on every call,
// so a throttled merge stops the run instead of reading as a refused merge.
const CALLS = {
  readiness: () => fetchReadiness('token', 'owner', 'repo', [1]),
  'merge request': () => submitMerge('token', 'owner', 'repo', 1, SHA, 'MERGE'),
  'merge result': () => readMerge('token', 'owner', 'repo', 1, '00000000-0000-4000-8000-000000000001'),
};
for (const [name, call] of Object.entries(CALLS)) {
  test(`${name}: a 429 without headers is a rate limit`, async () => {
    answer(429, {});
    await assert.rejects(call(), { kind: 'rate-limit' });
  });
  test(`${name}: a 403 that says "secondary rate limit" is a rate limit`, async () => {
    answer(403, { message: 'You have exceeded a secondary rate limit.' });
    await assert.rejects(call(), { kind: 'rate-limit' });
  });
}

test('a 403 that is not a rate limit is a refused merge', async () => {
  answer(403, { message: 'Resource not accessible by personal access token' });
  assert.deepEqual(await submitMerge('token', 'owner', 'repo', 1, SHA, 'MERGE'),
    { state: 'failed', message: 'Resource not accessible by personal access token' });
});
