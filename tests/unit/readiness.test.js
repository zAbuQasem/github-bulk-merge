import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readiness, describe as describeReason, REASONS } from '../../extension/src/readiness.js';

const run = (name, status, conclusion = null) => ({ __typename: 'CheckRun', name, status, conclusion });
const ctx = (context, state) => ({ __typename: 'StatusContext', context, state });
const HEAD = 'a'.repeat(40);
const rollup = (nodes, state = 'SUCCESS', totalCount = nodes.length, extra = {}) => ({
  state,
  commit: { oid: HEAD },
  contexts: {
    totalCount,
    checkRunCount: nodes.filter(n => n.__typename === 'CheckRun').length,
    statusContextCount: nodes.filter(n => n.__typename === 'StatusContext').length,
    pageInfo: { hasNextPage: false },
    nodes,
    ...extra,
  },
});

const GREEN = rollup([run('No two challenges share an ID', 'COMPLETED', 'SUCCESS'), run('Create PR', 'COMPLETED', 'SUCCESS')]);
const pr = (over = {}) => ({
  number: 1, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  reviewDecision: null, isInMergeQueue: false, headRefOid: HEAD, statusCheckRollup: GREEN, ...over,
});

const CASES = [
  ['clean PR with all checks passing', pr(), 'ready'],
  ['neutral and skipped conclusions pass', pr({ statusCheckRollup: rollup([run('a', 'COMPLETED', 'NEUTRAL'), run('b', 'COMPLETED', 'SKIPPED')]) }), 'ready'],
  ['commit status success passes', pr({ statusCheckRollup: rollup([ctx('ci/legacy', 'SUCCESS')]) }), 'ready'],
  ['approved review is fine', pr({ reviewDecision: 'APPROVED' }), 'ready'],

  ['merged PR', pr({ state: 'MERGED' }), 'merged'],
  ['closed PR', pr({ state: 'CLOSED' }), 'closed'],
  ['draft', pr({ isDraft: true, mergeStateStatus: 'DRAFT' }), 'draft'],
  ['conflicting', pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), 'conflicts'],
  ['dirty while mergeable is still unknown', pr({ mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY' }), 'conflicts'],

  ...['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE', null].map(c =>
    [`check run concluded ${c}`, pr({ statusCheckRollup: rollup([run('ok', 'COMPLETED', 'SUCCESS'), run('bad', 'COMPLETED', c)], 'FAILURE') }), 'checks-failed']),
  ...['FAILURE', 'ERROR'].map(s =>
    [`status context ${s}`, pr({ statusCheckRollup: rollup([ctx('ci', s)], s) }), 'checks-failed']),
  ['unknown context type is never trusted', pr({ statusCheckRollup: rollup([{ __typename: 'FutureCheck' }]) }), 'checks-unreadable'],
  ['unknown context type counted by GitHub', pr({ statusCheckRollup: rollup([{ __typename: 'FutureCheck' }], 'SUCCESS', 1, { checkRunCount: 1 }) }), 'checks-failed'],
  ['failure wins over a still-running check', pr({ statusCheckRollup: rollup([run('slow', 'IN_PROGRESS'), run('bad', 'COMPLETED', 'FAILURE')], 'FAILURE') }), 'checks-failed'],

  ...['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED'].map(s =>
    [`check run ${s}`, pr({ statusCheckRollup: rollup([run('ok', 'COMPLETED', 'SUCCESS'), run('slow', s)], 'PENDING') }), 'checks-running']),
  ...['PENDING', 'EXPECTED'].map(s =>
    [`status context ${s}`, pr({ statusCheckRollup: rollup([ctx('ci', s)], s) }), 'checks-running']),
  ['contexts pass but rollup disagrees', pr({ statusCheckRollup: rollup([run('a', 'COMPLETED', 'SUCCESS')], 'PENDING') }), 'checks-running'],
  ['checks running hides UNSTABLE', pr({ mergeStateStatus: 'UNSTABLE', statusCheckRollup: rollup([run('slow', 'QUEUED')], 'PENDING') }), 'checks-running'],

  ['no rollup at all', pr({ statusCheckRollup: null }), 'no-checks'],
  ['rollup with zero contexts', pr({ statusCheckRollup: rollup([]) }), 'no-checks'],
  ['more contexts than fetched', pr({ statusCheckRollup: rollup([run('a', 'COMPLETED', 'SUCCESS')], 'SUCCESS', 101) }), 'too-many-checks'],
  ['another page of contexts exists', pr({ statusCheckRollup: rollup([run('a', 'COMPLETED', 'SUCCESS')], 'SUCCESS', 1, { pageInfo: { hasNextPage: true } }) }), 'too-many-checks'],
  ['GitHub counts check runs it did not return', pr({ statusCheckRollup: rollup([ctx('ci', 'SUCCESS')], 'SUCCESS', 1, { checkRunCount: 2 }) }), 'checks-unreadable'],
  ['rollup belongs to an older commit', pr({ statusCheckRollup: { ...GREEN, commit: { oid: 'b'.repeat(40) } } }), 'checks-running'],
  ['rollup without a commit', pr({ statusCheckRollup: { ...GREEN, commit: null } }), 'checks-running'],
  ['already in the merge queue', pr({ isInMergeQueue: true }), 'in-merge-queue'],
  ['superseded runs that all passed', pr({ statusCheckRollup: rollup([run('ids', 'COMPLETED', 'SUCCESS'), run('ids', 'COMPLETED', 'SUCCESS')]) }), 'ready'],
  ['an old failure next to a newer success stays blocked', pr({ statusCheckRollup: rollup([run('ids', 'COMPLETED', 'FAILURE'), run('ids', 'COMPLETED', 'SUCCESS')], 'SUCCESS') }), 'checks-failed'],

  ['changes requested', pr({ reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'BLOCKED' }), 'changes-requested'],
  ['review required', pr({ reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' }), 'review-required'],
  ['behind base with strict checks', pr({ mergeStateStatus: 'BEHIND' }), 'behind'],
  ['mergeable not computed yet', pr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), 'computing'],
  ['merge state not computed yet', pr({ mergeStateStatus: 'UNKNOWN' }), 'computing'],
  ['blocked even if the viewer could bypass', pr({ mergeStateStatus: 'BLOCKED' }), 'blocked'],
  ['unstable with green visible checks', pr({ mergeStateStatus: 'UNSTABLE' }), 'not-clean'],
  ['has-hooks is not treated as clean', pr({ mergeStateStatus: 'HAS_HOOKS' }), 'not-clean'],
  ['mergeable missing', pr({ mergeable: undefined }), 'not-clean'],
  ['unexpected merge state', pr({ mergeStateStatus: 'SOMETHING_NEW' }), 'not-clean'],
];

for (const [name, input, expected] of CASES) {
  test(`${name} -> ${expected}`, () => assert.equal(readiness(input), expected));
}

test('only "ready" is ready, and every code has a label', () => {
  for (const [, input] of CASES) {
    const code = readiness(input);
    assert.ok(REASONS[code], `no label for ${code}`);
  }
  const ready = Object.keys(REASONS).filter(code => describeReason(code).tone === 'success');
  assert.deepEqual(ready, ['ready']);
});

test('unknown codes describe as unavailable and keep polling', () => {
  assert.deepEqual(describeReason('nope'), { code: 'nope', label: 'Unavailable', tone: 'danger', icon: 'alert', settles: false });
});

test('every reason uses an icon the page can draw', () => {
  const content = readFileSync(new URL('../../extension/src/content.js', import.meta.url), 'utf8');
  const start = content.indexOf('const PATHS = {');
  const paths = content.slice(start, content.indexOf('\n  };', start));
  for (const [code, [, , icon]] of Object.entries(REASONS)) {
    assert.match(paths, new RegExp(`\\n\\s+${icon}: '`), `${code} uses an icon content.js does not have: ${icon}`);
  }
});
