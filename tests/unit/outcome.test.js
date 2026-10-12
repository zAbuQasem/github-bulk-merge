import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOutcome } from '../../extension/src/github.js';

const CASES = [
  ['accepted, still running', { state: 'pending', uuid: 'u' }, { status: 'pending', uuid: 'u' }],
  ['merged', { state: 'merged', message: 'Pull request was merged.' }, { status: 'merged', detail: '' }],
  ['merged by someone else first', { state: 'merged', message: 'Pull request is already merged.' }, { status: 'merged', detail: 'Already merged' }],
  ['base branch moved', { state: 'failed', message: 'Base branch was modified. Review and try the merge again.' }, { status: 'retry' }],
  ['refused with a reason', { state: 'failed', message: 'Merge conflict between base and head' }, { status: 'failed', detail: 'Merge conflict between base and head' }],
  ['refused without a reason', { state: 'failed', message: '' }, { status: 'failed', detail: 'GitHub refused the merge' }],
];

for (const [name, result, expected] of CASES) {
  test(`${name} -> ${expected.status}`, () => assert.deepEqual(mergeOutcome(result), expected));
}

test('an unconfirmed outcome reads as one sentence, then the advice', () => {
  const advice = 'Check this pull request before retrying.';
  for (const [message, detail] of [['Lost contact.', `Lost contact. ${advice}`], ['No answer', `No answer. ${advice}`],
    ['Still running?', `Still running? ${advice}`], ['', `Merge outcome unknown. ${advice}`]]) {
    assert.equal(mergeOutcome({ state: 'unknown', message }).detail, detail);
  }
});

test('anything GitHub cannot confirm stops the run and is never called merged or refused', () => {
  for (const result of [{ state: 'unknown', message: 'GitHub is still processing the merge' }, { state: 'enqueued', message: '' }, { state: 'surprise', message: '' }]) {
    const outcome = mergeOutcome(result);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.fatal, true);
    assert.equal(outcome.uncertain, true);
  }
});
