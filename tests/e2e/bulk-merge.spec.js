import {
  test, expect, signIn, isolatedWorld, row, checkbox, statusOf, bulkButton, sha, PULLS_URL, TOKEN, OWNER, OTHER_REPO,
} from './fixtures.js';

const sessionToken = worker => worker.evaluate(() => chrome.storage.session.get('token'));

async function openList({ worker, pulls, page }, theme) {
  await signIn(worker);
  await pulls(theme);
  await page.goto(PULLS_URL);
  await expect(statusOf(page, 1)).toHaveText('Ready to merge');
}

test.describe('readiness and selection', () => {
  test('every row shows why it is or is not ready', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    const expected = {
      1: 'Ready to merge', 2: 'Ready to merge', 3: 'Ready to merge', 4: 'Checks failed',
      5: 'Checks running', 7: 'Draft', 8: 'Merge conflicts',
    };
    for (const [number, label] of Object.entries(expected)) {
      await expect(statusOf(page, number)).toHaveText(label);
    }
    await expect(checkbox(page, 5)).toHaveAttribute('aria-describedby', 'prm-status-5');
  });

  test('a not-ready PR ticks like any other, so GitHub\'s own bulk actions keep working', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    await checkbox(page, 4).click();
    await checkbox(page, 5).focus();
    await page.keyboard.press('Space');
    await expect(checkbox(page, 4)).toBeChecked();
    await expect(checkbox(page, 5)).toBeChecked();
    expect(await page.evaluate(() => window.__selected())).toEqual([4, 5]);
    const button = bulkButton(page);
    await expect(button).toHaveText(/Bulk merge\s*0/); // counts only ready PRs
    await expect(button).toHaveAttribute('aria-disabled', 'true'); // still focusable
    await button.click({ force: true }); // a person can press it: it says why on each row
    await expect(statusOf(page, 4)).toHaveClass(/prm-nudge/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a ready PR can be ticked and unticked as usual', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    await checkbox(page, 2).click();
    await expect(checkbox(page, 2)).toBeChecked();
    expect(await page.evaluate(() => window.__selected())).toEqual([2]);
    await checkbox(page, 2).click();
    expect(await page.evaluate(() => window.__selected())).toEqual([]);
  });

  test('the count follows every tick, though GitHub changes nothing else on the page', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    for (const [number, count] of [[1, 1], [2, 2], [4, 2], [3, 3]]) {
      await checkbox(page, number).click();
      await expect(bulkButton(page)).toHaveText(new RegExp(`Bulk merge\\s*${count}`));
    }
    await checkbox(page, 1).click();
    await expect(bulkButton(page)).toHaveText(/Bulk merge\s*2/);
  });

  test('select all is left to GitHub; Bulk merge counts the ready PRs in it', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    await page.locator('input[id$="-list-view-select-all"]').click();
    await expect.poll(() => page.evaluate(() => window.__selected())).toEqual([1, 2, 3, 4, 5, 7, 8]);
    await expect(bulkButton(page)).toHaveText(/Bulk merge\s*3/);
  });

  test('the Bulk merge button sits first in GitHub\'s selection toolbar and counts ready PRs', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    await expect(page.locator('.prm-action')).toHaveCount(0); // no toolbar without a selection
    await checkbox(page, 1).click();
    await checkbox(page, 3).click();
    const actions = page.locator('[role="toolbar"][aria-label="Pull request actions"] > div > *');
    await expect(actions.first()).toHaveClass('prm-action');
    await expect(actions.nth(1)).toHaveAttribute('data-action-bar-item', 'mark-as');
    const button = bulkButton(page);
    await expect(button).toHaveText(/Bulk merge\s*2/);
    await expect(button).toHaveClass(/fx-btn/); // cloned from GitHub's own button
    await expect(button).toBeEnabled();
  });

  test('the page goes quiet once painted, with a row ticked', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page });
    await checkbox(page, 1).click();
    await expect(bulkButton(page)).toBeEnabled();
    await page.waitForTimeout(300);
    const mutations = await page.evaluate(() => new Promise(resolve => {
      let count = 0;
      const observer = new MutationObserver(records => { count += records.length; });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      setTimeout(() => { observer.disconnect(); resolve(count); }, 2_000);
    }));
    expect(mutations).toBe(0);
  });

  test('checks finishing while the page is open make a PR ready without a reload', async ({ worker, pulls, page, github }) => {
    test.setTimeout(45_000);
    await openList({ worker, pulls, page });
    await expect(statusOf(page, 5)).toHaveText('Checks running');
    const slow = github.prs.get(5);
    slow.contexts = slow.contexts.map(c => ({ ...c, status: 'COMPLETED', conclusion: 'SUCCESS' }));
    slow.rollupState = 'SUCCESS';
    slow.mergeStateStatus = 'CLEAN';
    // The content script polls every 15s while any row is still settling.
    await expect(statusOf(page, 5)).toHaveText('Ready to merge', { timeout: 20_000 });
    await checkbox(page, 5).click();
    await expect(bulkButton(page)).toHaveText(/Bulk merge\s*1/);
  });

  test('without a token the toolbar offers to connect', async ({ pulls, page }) => {
    await pulls();
    await page.goto(PULLS_URL);
    await checkbox(page, 5).click();
    await expect(bulkButton(page)).toHaveText('Connect GitHub to bulk merge');
    await expect(page.locator('.prm-chip')).toHaveCount(0);
  });

  test('while rate limited, pressing Bulk merge with nothing ready asks GitHub nothing', async ({ worker, pulls, page, github }) => {
    github.rateLimited = true;
    await signIn(worker);
    await pulls();
    await page.goto(PULLS_URL);
    await expect(statusOf(page, 1)).toHaveText('Rate limited');
    await checkbox(page, 1).click();
    const reads = github.calls.filter(call => call.path === '/graphql').length;
    const button = bulkButton(page);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await button.click({ force: true });
    await button.focus();
    await page.keyboard.down('Enter');
    for (let i = 0; i < 5; i++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await page.waitForTimeout(500);
    expect(github.calls.filter(call => call.path === '/graphql').length).toBe(reads);
    await expect(statusOf(page, 1)).toHaveClass(/prm-nudge/);
  });

  test('when GitHub rejects the token every row says so and points to settings', async ({ worker, pulls, page, github, context }) => {
    github.graphqlStatus = 401;
    await signIn(worker);
    await pulls();
    await page.goto(PULLS_URL);
    await expect(statusOf(page, 1)).toContainText('Token rejected');
    await checkbox(page, 1).click();
    await expect(bulkButton(page)).toHaveText('Fix GitHub token');
    const [settings] = await Promise.all([
      context.waitForEvent('page'),
      row(page, 1).getByRole('button', { name: 'Fix token' }).click(),
    ]);
    await expect.poll(() => settings.url()).toMatch(/\/src\/options\.html$/);
  });

  test('reaching the list by in-page navigation from the repository home works', async ({ worker, pulls, page, github, context }) => {
    await signIn(worker);
    await pulls();
    const inContentScript = await isolatedWorld(context, page);
    await page.goto(`https://github.com/${OWNER}/widgets`);
    // Let the extension settle on the home page, where it stops watching the DOM, before leaving it.
    await expect.poll(() => inContentScript('new Promise(resolve => setTimeout(resolve, 200, true))').catch(() => false)).toBe(true);
    await page.evaluate(() => window.__softNav('/acme/widgets/pulls'));
    await expect(statusOf(page, 1)).toHaveText('Ready to merge');
    await checkbox(page, 1).click();
    await bulkButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Merge 1 pull request' });
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged', { timeout: 15_000 });
    expect(github.merges().map(call => call.path)).toEqual(['/repos/acme/widgets/pulls/1/merge-async']);
  });

  test('a late answer for the previous repository is never applied to the next one', async ({ worker, pulls, page, github }) => {
    await signIn(worker);
    await pulls();
    github.readinessDelayMs['acme/widgets'] = 1_000; // #1 is ready there
    github.readinessDelayMs['acme/gadgets'] = 3_000; // #1 is still running here
    await page.goto(PULLS_URL);
    await expect.poll(() => github.calls.some(call => call.path === '/graphql' && call.body.variables.repo === 'widgets')).toBe(true);
    // Leave for gadgets, whose list renders only after widgets' answer has landed.
    await page.evaluate(other => window.__softNav(`/acme/${other}/pulls`, 1_500), OTHER_REPO);
    await expect(row(page, 1)).toBeVisible();
    // Until gadgets' own answer arrives, #1 must look unknown and never count as ready.
    await expect(statusOf(page, 1)).toHaveText('Checking status');
    await checkbox(page, 1).click();
    await expect(bulkButton(page)).toHaveText(/Bulk merge\s*0/);
    await expect(statusOf(page, 1)).toHaveText('Checks running', { timeout: 5_000 });
  });

  test('the content script cannot use token actions or merge another repository', async ({ worker, pulls, page, context, github }) => {
    const inContentScript = await isolatedWorld(context, page);
    await openList({ worker, pulls, page });
    const ask = message => inContentScript(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
    for (const type of ['token-status', 'token-unlock', 'token-save', 'token-clear', 'token-lock']) {
      expect(await ask({ type, passphrase: 'x'.repeat(12), token: 'ghp_'.padEnd(40, 'x') })).toMatchObject({ ok: false, error: 'bad-request' });
    }
    expect(await ask({ type: 'merge-submit', owner: 'acme', repo: 'gadgets', number: 2, headOid: sha(1), method: 'SQUASH', runId: crypto.randomUUID() }))
      .toMatchObject({ status: 'failed', detail: 'Request rejected' });
    expect(await ask({ type: 'merge-status', owner: 'acme', repo: 'gadgets', entries: [{ number: 2, uuid: '00000000-0000-4000-8000-000000000002' }] }))
      .toMatchObject({ ok: false, error: 'bad-request' });
    expect(github.merges()).toHaveLength(0);
    expect(await sessionToken(worker)).toHaveProperty('token'); // still unlocked
  });

  test('the content script cannot read extension storage', async ({ worker, pulls, page, context }) => {
    const inContentScript = await isolatedWorld(context, page);
    await openList({ worker, pulls, page });
    expect(await inContentScript(`Promise.allSettled([chrome.storage.local.get(null), chrome.storage.session.get(null)])
      .then(results => results.map(r => r.status))`)).toEqual(['rejected', 'rejected']);
  });
});

test.describe('bulk merge', () => {
  // ready: how many of the ticked PRs are ready, which is what the dialog's title counts.
  async function confirmMerge(page, numbers, ready = numbers.length) {
    for (const number of numbers) await checkbox(page, number).click();
    await bulkButton(page).click();
    const dialog = page.getByRole('dialog', { name: `Merge ${ready} pull request${ready === 1 ? '' : 's'}` });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('merges ready PRs one at a time, pinned to the confirmed commit, never bypassing rules', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 3]);
    await expect(dialog.getByRole('combobox', { name: 'Merge method' })).toHaveValue('SQUASH');
    await expect(dialog.locator('.prm-item')).toHaveText([/#1 sync: alice\/web-ready-1/, /#3 sync: bob\/pwn-ready-3/]);
    expect(github.merges()).toHaveLength(0); // nothing happens before confirmation

    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('2 merged', { timeout: 15_000 });
    await expect(dialog.locator('.prm-item-state')).toHaveText(['Merged', 'Merged']);
    await expect(dialog.locator('.prm-item').first()).toHaveAttribute('data-tone', 'done');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();

    expect(github.merges().map(call => ({ path: call.path, body: call.body }))).toEqual([
      { path: '/repos/acme/widgets/pulls/1/merge-async', body: { sha: sha(1), merge_method: 'squash', merge_action: 'direct_merge', bypass_rules: false } },
      { path: '/repos/acme/widgets/pulls/3/merge-async', body: { sha: sha(3), merge_method: 'squash', merge_action: 'direct_merge', bypass_rules: false } },
    ]);
    // Each merge was preceded, since the previous merge, by a fresh read of that PR alone.
    const sequence = github.calls.map(call => (call.path === '/graphql' ? `read:${call.body.query.match(/pr\d+:/g).join(',')}` : `${call.method}:${call.path}`));
    let previous = -1;
    for (const number of [1, 3]) {
      const put = sequence.indexOf(`PUT:/repos/acme/widgets/pulls/${number}/merge-async`);
      expect(sequence.slice(previous + 1, put)).toContain(`read:pr${number}:`);
      previous = put;
    }
  });

  test('all GitHub traffic comes from the service worker with the token', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [2]);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged', { timeout: 15_000 });
    expect(github.calls.length).toBeGreaterThan(2);
    for (const call of github.calls) {
      expect(call.fromWorker).toBe(true);
      expect(call.auth).toBe(`Bearer ${TOKEN}`);
    }
    expect(await page.content()).not.toContain(TOKEN);
  });

  test('a PR that gets new commits after confirmation is skipped, not merged', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 2]);
    github.prs.get(2).headRefOid = sha(222); // someone pushes while the dialog is open
    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged, 1 skipped', { timeout: 15_000 });
    await expect(dialog.locator('.prm-item').nth(1)).toContainText('New commits were pushed after you confirmed');
    expect(github.merges().map(call => call.path)).toEqual(['/repos/acme/widgets/pulls/1/merge-async']);
  });

  test('merges overlap: every merge is sent before the first one finishes', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.mergeDelayMs = 6_000; // GitHub takes a while to finish each merge
    const dialog = await confirmMerge(page, [1, 2, 3]);
    await dialog.getByRole('button', { name: 'Merge 3 pull requests' }).click();
    await expect.poll(() => github.merges().length, { timeout: 5_000 }).toBe(3);
    expect([...github.prs.values()].filter(pr => pr.state === 'MERGED')).toHaveLength(0);
    await expect(dialog.locator('.prm-item-state')).toHaveText(['Merging', 'Merging', 'Merging']);
    await expect(dialog.locator('.prm-progress')).toHaveText('3 merged', { timeout: 20_000 });
  });

  test('a PR that conflicts once an earlier merge lands is never merged', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.onMerged = merged => {
      if (merged.number === 1) Object.assign(github.prs.get(3), { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
    };
    const dialog = await confirmMerge(page, [1, 3]);
    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    // Caught by the re-check if #1 landed first, otherwise refused by GitHub when it runs #3.
    await expect(dialog.locator('.prm-progress')).toHaveText(/^1 merged, 1 (skipped|failed)$/, { timeout: 15_000 });
    await expect(dialog.locator('.prm-item').nth(1)).toContainText(/merge conflict/i);
    expect(github.prs.get(3).state).toBe('OPEN');
  });

  test('a merge GitHub refuses because the base branch moved is re-checked and tried once more', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.baseMovedOnce.add(3);
    const dialog = await confirmMerge(page, [1, 3]);
    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('2 merged', { timeout: 20_000 });
    expect(github.merges().map(call => call.path)).toEqual([
      '/repos/acme/widgets/pulls/1/merge-async',
      '/repos/acme/widgets/pulls/3/merge-async',
      '/repos/acme/widgets/pulls/3/merge-async',
    ]);
  });

  test('a merge GitHub keeps refusing because the base branch moved is tried once more, then given up', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.baseMovedAlways.add(3);
    const dialog = await confirmMerge(page, [1, 3]);
    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged, 1 failed', { timeout: 20_000 });
    await expect(dialog.locator('.prm-item').nth(1)).toContainText('GitHub kept reporting that the base branch moved');
    expect(github.puts.get(3)).toBe(2);
  });

  test('a ticked PR that is no longer ready when Bulk merge is pressed is listed as excluded', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    await checkbox(page, 1).click();
    await checkbox(page, 2).click();
    // Someone re-runs #2's checks after it was ticked; the press re-reads GitHub first.
    Object.assign(github.prs.get(2), { mergeStateStatus: 'UNSTABLE', rollupState: 'PENDING',
      contexts: [{ __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null }] });
    await bulkButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Merge 1 pull request' });
    await expect(dialog.locator('.prm-excluded')).toContainText('#2');
    await expect(dialog.locator('.prm-excluded .prm-chip')).toHaveText('Checks running');
    await expect(dialog.locator('.prm-excluded .prm-chip')).toHaveAttribute('data-tone', 'attention');
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await dialog.getByRole('button', { name: 'Merge only the 1 ready' }).click(); // waits until it re-enables
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged', { timeout: 15_000 });
    expect(github.merges().map(call => call.path)).toEqual(['/repos/acme/widgets/pulls/1/merge-async']);
  });

  test('a selection with PRs that are not ready asks a second time and merges only the ready ones', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 4, 5], 1);
    await expect(dialog.locator('.prm-excluded-list li')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await expect(dialog.getByRole('status')).toHaveText('2 of the 3 selected pull requests are not ready and will not be merged.');
    const again = dialog.getByRole('button', { name: 'Merge only the 1 ready' });
    expect(await again.isDisabled()).toBe(true); // right after the first press
    await expect(dialog.getByRole('button', { name: 'Back' })).toBeFocused();
    expect(github.merges()).toHaveLength(0); // the first press only asked
    await expect(again).toBeEnabled();
    await again.click();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged', { timeout: 15_000 });
    expect(github.merges().map(call => call.path)).toEqual(['/repos/acme/widgets/pulls/1/merge-async']);
  });

  test('a double click cannot pass both confirmations', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 8], 1);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).dblclick();
    await page.waitForTimeout(1_000);
    await expect(dialog.getByRole('button', { name: 'Merge only the 1 ready' })).toBeVisible();
    expect(github.merges()).toHaveLength(0);
  });

  test('holding Enter on Merge counts as one press', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 8], 1);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).focus();
    await page.keyboard.down('Enter');
    await expect(dialog.getByRole('status')).toHaveText(/not ready and will not be merged/);
    await page.waitForTimeout(1_000); // past the re-enable delay
    for (let i = 0; i < 5; i++) await page.keyboard.down('Enter'); // the key is still held: repeats
    await page.keyboard.up('Enter');
    await page.waitForTimeout(500);
    await expect(dialog.getByRole('status')).toHaveText(/not ready and will not be merged/); // still asking
    expect(github.merges()).toHaveLength(0);
  });

  test('Back, then Merge again, asks again with a fresh wait', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 5], 1);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await page.waitForTimeout(1_000);
    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    expect(await dialog.getByRole('button', { name: 'Merge only the 1 ready' }).isDisabled()).toBe(true);
    expect(github.merges()).toHaveLength(0);
  });

  for (const [how, act] of [
    ['Escape', page => page.keyboard.press('Escape')],
    ['the close button', (page, dialog) => dialog.getByRole('button', { name: 'Close' }).click()],
  ]) {
    test(`${how} at the second step closes the dialog and merges nothing`, async ({ worker, pulls, page, github }) => {
      await openList({ worker, pulls, page });
      const dialog = await confirmMerge(page, [2, 4], 1);
      await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
      await act(page, dialog);
      await expect(dialog).toBeHidden();
      await page.waitForTimeout(500);
      expect(github.merges()).toHaveLength(0);
    });
  }

  test('page script cannot press the dialog\'s Merge button', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 4], 1);
    await page.evaluate(async () => {
      const merge = document.querySelector('.prm-dialog .prm-btn-primary');
      merge.click();
      await new Promise(resolve => setTimeout(resolve, 1_000));
      merge.click();
    });
    await page.waitForTimeout(500);
    await expect(dialog.getByRole('status')).toHaveText(''); // never reached the second step
    await expect(dialog.getByRole('button', { name: 'Merge 1 pull request' })).toBeVisible();
    expect(github.merges()).toHaveLength(0);

    // A person's press reaches the second step; page script still cannot finish it.
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await page.waitForTimeout(1_000);
    await page.evaluate(() => document.querySelector('.prm-dialog .prm-btn-primary').click());
    await page.waitForTimeout(500);
    await expect(dialog.getByRole('status')).toHaveText(/not ready and will not be merged/);
    expect(github.merges()).toHaveLength(0);
  });

  test('page script clearing Merge\'s disabled state does not let a double click through', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 4], 1);
    await page.evaluate(() => {
      const merge = document.querySelector('.prm-dialog .prm-btn-primary');
      new MutationObserver(() => { if (merge.disabled) merge.disabled = false; })
        .observe(merge, { attributes: true, attributeFilter: ['disabled'] });
    });
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).dblclick();
    await page.waitForTimeout(1_000);
    await expect(dialog.getByRole('status')).toHaveText(/not ready and will not be merged/);
    expect(github.merges()).toHaveLength(0);
  });

  test('Back returns to the first step and Cancel then merges nothing', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [2, 7], 1);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('');
    await expect(dialog.getByRole('button', { name: 'Merge 1 pull request' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(github.merges()).toHaveLength(0);
  });

  test('Bulk merge cannot be pressed twice while it re-reads GitHub', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    await checkbox(page, 1).click();
    github.readinessDelayMs['acme/widgets'] = 1_000;
    const button = bulkButton(page);
    await button.click();
    await page.waitForTimeout(300); // several paints happen during the re-read
    expect(await button.isDisabled()).toBe(true); // right now, not eventually
    await button.click({ timeout: 500 }).catch(() => {}); // a second press, if the button allows one
    await expect(page.getByRole('dialog')).toHaveCount(1, { timeout: 5_000 });
    await page.waitForTimeout(1_500); // the second re-read would have finished by now
    await expect(page.locator('dialog.prm-dialog')).toHaveCount(1);
  });

  test('a merge GitHub accepted but whose result was lost is reported as unknown and stops the run', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.failMergePoll = true;
    const dialog = await confirmMerge(page, [1, 2, 3]);
    await dialog.getByRole('button', { name: 'Merge 3 pull requests' }).click();
    await expect(dialog.locator('.prm-progress')).toContainText(/^0 merged.*failed\. Stopped: /, { timeout: 20_000 });
    await expect(dialog.locator('.prm-item').first()).toContainText('Check this pull request before retrying');
    await expect(dialog.locator('.prm-item[data-status="merged"]')).toHaveCount(0); // never claimed as merged
    const reloaded = page.waitForEvent('load');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await reloaded; // the list is reloaded, since #1 may have merged
  });

  test('Stop pressed while a PR is still being re-checked sends nothing', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 2]);
    github.readinessDelayMs['acme/widgets'] = 2_500; // the re-check right before the merge is slow
    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    await expect(dialog.locator('.prm-item').first()).toHaveAttribute('data-status', 'checking');
    await dialog.getByRole('button', { name: 'Stop sending' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText(/^0 merged, 2 skipped/, { timeout: 15_000 });
    await expect(dialog.locator('.prm-item').first()).toContainText('Stopped before sending');
    expect(github.merges()).toHaveLength(0);
  });

  test('a throttled read during the base-moved retry waits and reads again', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.baseMovedOnce.add(3);
    github.throttledRetryReads = 2;
    const dialog = await confirmMerge(page, [1, 3]);
    await dialog.getByRole('button', { name: 'Merge 2 pull requests' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('2 merged', { timeout: 25_000 });
  });

  test('a throttled read of a merge result waits and reads again instead of failing', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.throttledReads = 2;
    const dialog = await confirmMerge(page, [1]);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged', { timeout: 20_000 });
  });

  test('Stop sends nothing more, and a merge already sent still finishes', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.mergeDelayMs = 1_500;
    const dialog = await confirmMerge(page, [1, 2, 3]);
    await dialog.getByRole('button', { name: 'Merge 3 pull requests' }).click();
    await expect(dialog.locator('.prm-item').first()).toHaveAttribute('data-status', 'merging');
    await dialog.getByRole('button', { name: 'Stop sending' }).click();
    await expect(dialog.locator('.prm-progress')).toHaveText(/^1 merged, 2 skipped/, { timeout: 15_000 });
    expect(github.merges()).toHaveLength(1);
  });

  test('Escape does not close the dialog while merging', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    github.mergeDelayMs = 1_500;
    const dialog = await confirmMerge(page, [1]);
    await dialog.getByRole('button', { name: 'Merge 1 pull request' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.prm-progress')).toHaveText('1 merged', { timeout: 15_000 });
  });

  test('cancelling the dialog merges nothing', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    const dialog = await confirmMerge(page, [1, 2]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(github.merges()).toHaveLength(0);
  });

  test('a synthetic click from page script cannot start a merge', async ({ worker, pulls, page, github }) => {
    await openList({ worker, pulls, page });
    await checkbox(page, 1).click();
    await expect(bulkButton(page)).toBeEnabled();
    await page.evaluate(() => document.querySelector('.prm-action-button').click());
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(github.merges()).toHaveLength(0);
  });
});

test.describe('settings', () => {
  const optionsUrl = worker => `chrome-extension://${new URL(worker.url()).host}/src/options.html`;

  test('a fresh install opens the settings page', async ({ context }) => {
    expect(context.openedSettingsOnInstall).toBe(true);
  });

  const PASSPHRASE = 'correct horse battery staple';

  async function saveToken(page, token = TOKEN, confirm = PASSPHRASE) {
    const form = page.locator('#connect');
    await form.getByLabel('Classic personal access token').fill(token);
    await form.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await form.getByLabel('Confirm passphrase').fill(confirm);
    await form.getByRole('button', { name: 'Save token' }).click();
  }

  async function saveAndLock(page) {
    await saveToken(page);
    await page.getByRole('button', { name: 'Lock now' }).click();
    await expect(page.getByText('@octotester is locked')).toBeVisible();
  }

  // Everything the extension wrote to disk, as one string.
  const onDisk = worker => worker.evaluate(() => chrome.storage.local.get(null).then(JSON.stringify));

  test('a saved token is encrypted on disk and only held in memory while unlocked', async ({ worker, page, github }) => {
    await page.goto(optionsUrl(worker));
    await saveToken(page);
    await expect(page.getByText('Connected as @octotester')).toBeVisible();
    expect(github.calls.find(call => call.path === '/user').auth).toBe(`Bearer ${TOKEN}`);
    const disk = await onDisk(worker);
    expect(disk).not.toContain(TOKEN);
    expect(disk).not.toContain(PASSPHRASE);
    expect(JSON.parse(disk).vault).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', iterations: 600_000 });
    expect(await sessionToken(worker)).toEqual({ token: TOKEN });
    expect(await page.content()).not.toContain(TOKEN);

    await page.getByRole('button', { name: 'Remove token' }).click();
    await expect(page.locator('#connect').getByLabel('Classic personal access token')).toBeVisible();
    expect(JSON.parse(await onDisk(worker))).not.toHaveProperty('vault');
    expect(await sessionToken(worker)).toEqual({});
  });

  test('passphrases that do not match are refused', async ({ worker, page }) => {
    await page.goto(optionsUrl(worker));
    await saveToken(page, TOKEN, `${PASSPHRASE}!`);
    await expect(page.getByRole('alert')).toHaveText('The passphrases do not match.');
    expect(JSON.parse(await onDisk(worker))).not.toHaveProperty('vault');
  });

  test('Lock now locks it; a wrong passphrase is refused and the right one unlocks', async ({ worker, page, github }) => {
    await page.goto(optionsUrl(worker));
    await saveAndLock(page);
    expect(await sessionToken(worker)).toEqual({});

    const unlock = page.locator('#unlock');
    await unlock.getByLabel('Passphrase').fill('not the passphrase at all');
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong passphrase.');
    expect(await sessionToken(worker)).toEqual({});

    await unlock.getByLabel('Passphrase').fill(PASSPHRASE);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('Connected as @octotester')).toBeVisible();
    expect(await sessionToken(worker)).toEqual({ token: TOKEN });
  });

  test('while locked the list says so on every row and points to settings', async ({ worker, pulls, page, context }) => {
    await page.goto(optionsUrl(worker));
    await saveAndLock(page);
    await pulls();
    await page.goto(PULLS_URL);
    await expect(statusOf(page, 1)).toContainText('Locked');
    await checkbox(page, 1).click();
    await expect(bulkButton(page)).toHaveText('Unlock to bulk merge');
    const [settings] = await Promise.all([
      context.waitForEvent('page'),
      row(page, 1).getByRole('button', { name: 'Unlock' }).click(),
    ]);
    await expect.poll(() => settings.url()).toMatch(/\/src\/options\.html$/);
  });

  test('the list hands GitHub\'s theme to the settings page, which uses its palette', async ({ worker, pulls, page }) => {
    await openList({ worker, pulls, page }, 'dark');
    await expect.poll(() => worker.evaluate(() => chrome.storage.local.get('theme')))
      .toEqual({ theme: { mode: 'dark', light: 'light', dark: 'dark_colorblind' } });
    await page.goto(optionsUrl(worker));
    await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark');
    const success = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--success').trim());
    expect(success).toBe('#58a6ff'); // GitHub's dark_colorblind success, blue rather than green
  });

  test('refuses fine-grained tokens and tokens without repo scope', async ({ worker, page, github }) => {
    await page.goto(optionsUrl(worker));
    await saveToken(page, 'github_pat_11AAAAAAA0123456789abcdefghijklmnopqrstuvwxyz');
    await expect(page.getByRole('alert')).toContainText('Fine-grained tokens cannot always read check runs');

    github.scopes = 'read:org, gist';
    await saveToken(page);
    await expect(page.getByRole('alert')).toContainText('no repo scope');
    expect(JSON.parse(await onDisk(worker))).not.toHaveProperty('vault');
  });
});
