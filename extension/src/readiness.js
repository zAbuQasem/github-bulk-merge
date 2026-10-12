// Decides whether GitHub would merge a pull request cleanly with every check finished
// and passing. Anything this function cannot positively confirm is "not ready".

const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

// code -> [label, tone, icon, settles]. A reason that does not settle may change on its own
// (checks finishing, GitHub computing mergeability), so the page keeps polling.
export const REASONS = {
  ready: ['Ready to merge', 'success', 'check', true],
  closed: ['Closed', 'neutral', 'closed', true],
  merged: ['Merged', 'done', 'merge', true],
  draft: ['Draft', 'neutral', 'draft', true],
  conflicts: ['Merge conflicts', 'danger', 'x', true],
  'checks-failed': ['Checks failed', 'danger', 'x', true],
  'checks-running': ['Checks running', 'attention', 'dot', false],
  'checks-unreadable': ['Checks not readable', 'danger', 'alert', true],
  'no-checks': ['No checks reported', 'attention', 'alert', false],
  'too-many-checks': ['Too many checks to verify', 'attention', 'alert', true],
  'changes-requested': ['Changes requested', 'danger', 'x', true],
  'review-required': ['Review required', 'attention', 'eye', true],
  behind: ['Behind base branch', 'attention', 'sync', true],
  blocked: ['Blocked by branch rules', 'danger', 'lock', true],
  computing: ['Checking mergeability', 'neutral', 'sync', false],
  'in-merge-queue': ['In merge queue', 'neutral', 'sync', false],
  'no-permission': ['No merge permission', 'neutral', 'lock', true],
  'not-clean': ['Not mergeable yet', 'attention', 'alert', false],
};

export function describe(code) {
  const [label, tone, icon, settles] = REASONS[code] ?? ['Unavailable', 'danger', 'alert', false];
  return { code, label, tone, icon, settles };
}

function checksVerdict(rollup, headRefOid) {
  const contexts = rollup?.contexts;
  if (!contexts || contexts.totalCount === 0) return 'no-checks';
  // Checks reported for an older commit say nothing about the head being merged.
  if (rollup.commit?.oid !== headRefOid) return 'checks-running';
  if (contexts.pageInfo?.hasNextPage || contexts.totalCount > contexts.nodes.length) return 'too-many-checks';
  // Fewer nodes than GitHub counts means some were withheld (for example, a token that
  // cannot read check runs). Never judge on a partial list.
  if (contexts.nodes.length !== contexts.checkRunCount + contexts.statusContextCount) return 'checks-unreadable';
  let running = false;
  for (const node of contexts.nodes) {
    if (node.__typename === 'CheckRun') {
      if (node.status !== 'COMPLETED') running = true;
      else if (!PASSING_CONCLUSIONS.has(node.conclusion)) return 'checks-failed';
    } else if (node.__typename === 'StatusContext') {
      if (node.state === 'PENDING' || node.state === 'EXPECTED') running = true;
      else if (node.state !== 'SUCCESS') return 'checks-failed';
    } else {
      return 'checks-failed'; // a context type this version does not know how to judge
    }
  }
  if (running) return 'checks-running';
  // Every context we can see passed; the rollup must agree before we trust it.
  return rollup.state === 'SUCCESS' ? null : 'checks-running';
}

// pr: a PullRequest node from the readiness query (see github.js).
export function readiness(pr) {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state !== 'OPEN') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.isInMergeQueue) return 'in-merge-queue';
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'conflicts';
  const checks = checksVerdict(pr.statusCheckRollup, pr.headRefOid);
  if (checks) return checks;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'review-required';
  if (pr.mergeStateStatus === 'BEHIND') return 'behind';
  if (pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN') return 'computing';
  if (pr.mergeStateStatus === 'BLOCKED') return 'blocked';
  if (pr.mergeable !== 'MERGEABLE' || pr.mergeStateStatus !== 'CLEAN') return 'not-clean';
  return 'ready';
}
