// Bulk Merge on GitHub's pull request list: readiness on every row, a Bulk merge button in
// the selection toolbar, and the confirm/progress dialog that merges only ready PRs.
// The token never reaches this script; it only receives verdicts from the service worker.
(() => {
  'use strict';

  const ROUTE = /^\/([^/]+)\/([^/]+)\/pulls\/?$/;
  const LIST = 'ul[data-listview-component="items-list"]';
  const TITLE_LINK = 'a[data-testid="listitem-title-link"]';
  const ROW_CHECKBOX = 'input[type="checkbox"][data-listview-component="selection-input"]';
  const TOOLBAR = '[role="toolbar"][aria-label="Pull request actions"]';
  const META_LINE_ANCHOR = '[data-testid="timestamp-container"]';
  const POLL_MS = 15_000;

  // Octicons (MIT, GitHub Inc.), 16px.
  const PATHS = {
    check: 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
    x: 'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z',
    dot: 'M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
    merge: 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
    alert: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
    draft: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
    sync: 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z',
    lock: 'M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z',
    skip: 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z',
    closed: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
    eye: 'M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z',
    chevron: 'm4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z',
    key: 'M10.5 0a5.499 5.499 0 1 1-1.288 10.848l-.932.932a.749.749 0 0 1-.53.22H7v.75a.749.749 0 0 1-.22.53l-.5.5a.749.749 0 0 1-.53.22H5v.75a.749.749 0 0 1-.22.53l-.5.5a.749.749 0 0 1-.53.22h-2A1.75 1.75 0 0 1 0 14.25v-2c0-.199.079-.389.22-.53l4.932-4.932A5.5 5.5 0 0 1 10.5 0Zm-4 5.5c-.001.431.069.86.205 1.269a.75.75 0 0 1-.181.768L1.5 12.56v1.69c0 .138.112.25.25.25h1.69l.06-.06v-1.19a.75.75 0 0 1 .75-.75h1.19l.06-.06v-1.19a.75.75 0 0 1 .75-.75h1.19l1.023-1.025a.75.75 0 0 1 .768-.18A4 4 0 1 0 6.5 5.5ZM11 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  };

  const RUN_STATUS = {
    queued: ['dot', 'Queued', 'neutral'],
    checking: ['sync', 'Re-checking', 'neutral'],
    merging: ['sync', 'Merging', 'neutral'],
    merged: ['merge', 'Merged', 'done'],
    skipped: ['skip', 'Skipped', 'attention'],
    failed: ['x', 'Failed', 'danger'],
  };

  function icon(name, extraClass = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `prm-icon ${extraClass}`.trim());
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', PATHS[name] ?? PATHS.alert);
    svg.append(path);
    return svg;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Hyphenated keys (aria-*, data-*) are attributes; everything else is a DOM property.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.includes('-')) node.setAttribute(key, value);
      else node[key] = value;
    }
    node.append(...children.filter(child => child != null));
    return node;
  }

  // ---- state ---------------------------------------------------------------------------

  let page = null;            // { owner, repo } while on a PR list route
  let status = 'idle';        // idle | loading | active | no-token | error
  let errorKind = '';         // auth | rate-limit | network | api | ... while status is error
  let errorMessage = '';
  let pollAfter = 0;          // no background refresh before this time (rate limits)
  let busy = false;           // Bulk merge pressed, dialog not open yet
  let themeSent = false;
  let verdicts = new Map();   // number -> { code, label, tone, settles, headOid, title }
  let repoMethods = null;     // { default, allowed: [] }
  let lastKey = '';
  let inFlight = null;
  let dialogOpen = false;
  let dead = false;

  const isActive = () => !dead && page && status !== 'idle' && status !== 'no-token';

  function verdictFor(number) {
    if (!isActive()) return null;
    if (verdicts.has(number)) return verdicts.get(number);
    if (status === 'error') {
      const label = { auth: 'Token rejected', locked: 'Locked', 'rate-limit': 'Rate limited' }[errorKind] ?? 'Status unavailable';
      return { code: 'error', label, tone: 'danger', icon: 'alert', settles: false };
    }
    return { code: 'loading', label: 'Checking status', tone: 'neutral', icon: 'sync', settles: false };
  }

  const isReady = number => verdictFor(number)?.code === 'ready';

  // Only the settings page can fix these: no token, a rejected token, or a locked one.
  const needsSettings = () => status === 'no-token' || (status === 'error' && ['auth', 'locked'].includes(errorKind));

  // ---- reading GitHub's list -------------------------------------------------------------

  function readRows() {
    const list = page && document.querySelector(LIST);
    if (!list) return [];
    const rows = [];
    for (const li of list.children) {
      const link = li.querySelector(TITLE_LINK);
      const checkbox = li.querySelector(ROW_CHECKBOX);
      if (!link || !checkbox) continue;
      const match = link.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
      if (!match || match[1].toLowerCase() !== page.owner.toLowerCase() || match[2].toLowerCase() !== page.repo.toLowerCase()) continue;
      rows.push({ li, checkbox, number: Number(match[3]), title: link.textContent.trim() });
    }
    return rows;
  }

  // ---- talking to the worker -------------------------------------------------------------

  function shutdown() {
    dead = true;
    observer.disconnect();
    clearInterval(pollTimer);
    document.querySelectorAll('.prm-status, .prm-action, .prm-dialog').forEach(node => node.remove());
  }

  async function ask(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      // The extension was reloaded or removed; this copy of the script is orphaned.
      shutdown();
      return null;
    }
  }

  // Resolves once verdicts as fresh as this call are applied. force: a person asked, so the
  // read happens even while backing off from a rate limit or a rejected token.
  function refresh(rows, { force = false } = {}) {
    const numbers = rows.map(row => row.number);
    const key = `${page.owner}/${page.repo}#${numbers.join(',')}`;
    if (!force && (key === lastKey || Date.now() < pollAfter)) return Promise.resolve();
    lastKey = key;
    if (numbers.length === 0) return Promise.resolve();
    const asked = page;
    const run = (async () => {
      const response = await ask({ type: 'readiness', owner: asked.owner, repo: asked.repo, numbers });
      if (dead || page !== asked) return; // navigated to another repository meanwhile
      if (inFlight !== run) {
        await inFlight; // a newer read (and any read that superseded it) carries fresher data
        return;
      }
      apply(response);
    })();
    inFlight = run;
    return run;
  }

  function apply(response) {
    if (response?.ok) {
      status = 'active';
      errorKind = '';
      pollAfter = 0;
      repoMethods = response.methods;
      for (const [number, verdict] of Object.entries(response.prs)) verdicts.set(Number(number), verdict);
    } else if (response?.error === 'no-token') {
      status = 'no-token';
      verdicts.clear();
    } else {
      status = 'error';
      errorKind = response?.error || 'internal';
      errorMessage = response?.message || 'Could not reach the extension';
      // Back off: until GitHub's reset for a rate limit, a minute for a rejected token.
      if (errorKind === 'rate-limit') pollAfter = Date.now() + Math.min(Math.max(response?.retryAfterMs ?? 0, 60_000), 3_600_000);
      else if (needsSettings()) pollAfter = Date.now() + 60_000;
      verdicts.clear();
    }
    schedule();
  }

  // ---- painting ----------------------------------------------------------------------------

  function setAttr(node, name, value) {
    if (value == null) {
      if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) {
      node.setAttribute(name, value);
    }
  }

  function paintRow(row) {
    const verdict = verdictFor(row.number);
    const anchor = row.li.querySelector(META_LINE_ANCHOR)?.parentElement;
    let holder = row.li.querySelector('.prm-status');

    if (!verdict) {
      holder?.remove();
      return;
    }

    if (anchor && (!holder || holder.parentElement !== anchor)) {
      holder?.remove();
      holder = el('span', { className: 'prm-status' },
        el('span', { className: 'prm-sep', textContent: '·', 'aria-hidden': 'true' }),
        el('span', { className: 'prm-chip', id: `prm-status-${row.number}` }));
      anchor.append(holder);
    }
    const chip = holder?.querySelector('.prm-chip');
    const key = `${verdict.code}:${verdict.label}`;
    if (chip && chip.dataset.key !== key) {
      chip.dataset.key = key;
      chip.dataset.code = verdict.code;
      chip.dataset.tone = verdict.tone;
      chip.replaceChildren(icon(verdict.icon, verdict.code === 'loading' || verdict.code === 'computing' ? 'prm-spin' : ''), verdict.label);
      // Offer the way to settings right where the error is, without needing a selection.
      if (verdict.code === 'error' && needsSettings()) {
        const fix = el('button', { type: 'button', className: 'prm-fix', textContent: errorKind === 'locked' ? 'Unlock' : 'Fix token' });
        fix.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          if (event.isTrusted) ask({ type: 'open-options' });
        });
        chip.append(fix);
      }
    }

    if (chip) setAttr(row.checkbox, 'aria-describedby', chip.id);
  }

  function paintToolbar(rows) {
    const host = document.querySelector(TOOLBAR)?.firstElementChild;
    let item = document.querySelector('.prm-action');
    if (!host || !page || dead) {
      item?.remove();
      return;
    }
    if (!item || item.parentElement !== host) {
      item?.remove();
      item = buildAction(host);
      host.prepend(item);
    }

    const button = item.querySelector('button');
    const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
    const setIcon = name => {
      const lead = button.querySelector('.prm-action-icon');
      if (lead.dataset.icon !== name) {
        lead.dataset.icon = name;
        lead.replaceChildren(icon(name));
      }
    };
    const label = button.querySelector('.prm-action-label');
    const counter = button.querySelector('.prm-counter');

    const tokenProblem = needsSettings();
    if (tokenProblem) {
      setIcon('key');
      setText(label, status === 'no-token' ? 'Connect GitHub to bulk merge'
        : errorKind === 'locked' ? 'Unlock to bulk merge' : 'Fix GitHub token');
      counter.hidden = true;
      setText(counter, '');
      setAttr(button, 'aria-label', null);
      setAttr(button, 'aria-disabled', null);
      button.disabled = false;
      setAttr(button, 'title', status === 'no-token'
        ? 'Bulk merge needs a GitHub token. Opens the extension settings.'
        : errorKind === 'locked' ? 'The token is encrypted and locked. Opens the extension settings to unlock it.'
          : `GitHub rejected the saved token. ${errorMessage} Opens the extension settings.`);
      return;
    }

    const selected = rows.filter(row => row.checkbox.checked);
    const ready = selected.filter(row => isReady(row.number));
    const noun = `pull request${ready.length === 1 ? '' : 's'}`;
    setIcon('merge');
    setText(label, 'Bulk merge');
    counter.hidden = false;
    setText(counter, String(ready.length));
    setAttr(button, 'aria-label', `Bulk merge, ${ready.length} ready ${noun} selected`);
    // With nothing ready the button stays focusable (aria-disabled) and a press points at
    // each selected row's status; it is truly disabled only while busy or a dialog is open.
    button.disabled = dialogOpen || busy;
    setAttr(button, 'aria-disabled', ready.length === 0 && !button.disabled ? 'true' : null);
    setAttr(button, 'title', status === 'error'
      ? `Pull request status is unavailable: ${errorMessage}`
      : ready.length === 0 ? 'None of the selected pull requests are ready to merge' : `Merge ${ready.length} ready ${noun}`);
  }

  // Deep-clone one of GitHub's own toolbar buttons and swap its contents, so Primer's
  // current classes and inner layout (leading visual, text, trailing visual) apply as-is.
  function buildAction(host) {
    const template = host.querySelector('button[data-component="Button"]');
    const button = template ? template.cloneNode(true) : el('button', { className: 'prm-btn' });
    for (const node of [button, ...button.querySelectorAll('*')]) {
      for (const name of ['id', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'popovertarget']) {
        node.removeAttribute(name);
      }
    }
    button.querySelectorAll('[data-component="trailingAction"]').forEach(node => node.remove());
    const content = button.querySelector('[data-component="buttonContent"]') ?? button;
    const part = (name, make) => {
      let node = content.querySelector(`[data-component="${name}"]`);
      if (!node) {
        node = el('span', { 'data-component': name });
        make(node);
      }
      node.replaceChildren();
      return node;
    };
    const lead = part('leadingVisual', node => content.prepend(node));
    const text = part('text', node => content.append(node));
    const trail = part('trailingVisual', node => content.append(node));
    lead.classList.add('prm-action-icon');
    text.classList.add('prm-action-label');
    trail.append(el('span', { className: 'prm-counter', hidden: true }));
    button.type = 'button';
    button.classList.add('prm-action-button');
    button.addEventListener('click', onActionClick);
    // A held Enter would press it again on every repeat.
    button.addEventListener('keydown', event => {
      if (event.repeat && event.key === 'Enter') event.preventDefault();
    });
    const item = el('div', { className: 'prm-action' }, button);
    item.dataset.actionBarItem = 'bulk-merge';
    return item;
  }

  function paint() {
    if (dead) return;
    const match = location.pathname.match(ROUTE);
    const next = match ? { owner: match[1], repo: match[2] } : null;
    if (!next || !page || next.owner !== page.owner || next.repo !== page.repo) {
      verdicts = new Map();
      repoMethods = null;
      lastKey = '';
      inFlight = null;
      errorKind = '';
      // Until the worker answers, no row counts as ready (fail closed).
      status = next ? 'loading' : 'idle';
      page = next;
    }
    // Watch the DOM only on a pull request list; navigation events bring the script back.
    if (!page) {
      observer.disconnect();
      paintToolbar([]);
      return;
    }
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    if (!themeSent) {
      themeSent = true;
      const root = document.documentElement.dataset;
      if (root.colorMode) ask({ type: 'theme', mode: root.colorMode, light: root.lightTheme ?? 'light', dark: root.darkTheme ?? 'dark' });
    }
    const rows = readRows();
    rows.forEach(paintRow);
    paintToolbar(rows);
    refresh(rows);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled || dead) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      paint();
    }, 50);
  }

  // Points at a row's status, which says why it is not ready.
  function nudge(number) {
    const chip = document.getElementById(`prm-status-${number}`);
    if (!chip) return;
    chip.classList.remove('prm-nudge');
    void chip.offsetWidth; // restart the animation
    chip.classList.add('prm-nudge');
  }

  // ---- bulk merge --------------------------------------------------------------------------

  async function onActionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted) return; // page script can synthesize clicks; only a person may start this
    if (needsSettings()) {
      ask({ type: 'open-options' });
      return;
    }
    if (busy || dialogOpen) return;
    const selected = readRows().filter(row => row.checkbox.checked);
    // Nothing ready and GitHub asked us to wait: say why without another read.
    if (Date.now() < pollAfter && !selected.some(row => isReady(row.number))) {
      selected.forEach(row => nudge(row.number));
      return;
    }
    busy = true;
    event.currentTarget.disabled = true;
    const pressedOn = page;
    try {
      // Re-read every selected PR so the dialog shows GitHub's state as of now.
      await refresh(readRows(), { force: true });
      if (page === pressedOn) prepareDialog(); // not if the list moved to another repository
    } finally {
      busy = false;
      schedule();
    }
  }

  function prepareDialog() {
    const selected = readRows().filter(row => row.checkbox.checked);
    const included = [];
    const excluded = [];
    for (const row of selected) {
      const verdict = verdictFor(row.number);
      if (verdict?.code === 'ready') included.push({ number: row.number, title: verdict.title || row.title, headOid: verdict.headOid });
      else excluded.push({ number: row.number, title: verdict?.title || row.title, verdict });
    }
    if (included.length === 0) {
      selected.forEach(row => nudge(row.number)); // the status on each row says why
      return;
    }
    openDialog(included, excluded);
  }

  const METHOD_LABELS = { MERGE: 'Create a merge commit', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

  function openDialog(included, excluded) {
    dialogOpen = true;
    const { owner, repo } = page;
    const methods = repoMethods?.allowed.length ? repoMethods.allowed : ['MERGE'];
    const preferred = methods.includes(repoMethods?.default) ? repoMethods.default : methods[0];
    const count = included.length;
    const noun = `pull request${count === 1 ? '' : 's'}`;

    const methodSelect = el('select', { className: 'prm-select', id: 'prm-method' },
      ...methods.map(method => el('option', { value: method, textContent: METHOD_LABELS[method] ?? method, selected: method === preferred })));

    const items = new Map();
    const list = el('ol', { className: 'prm-list', 'aria-label': 'Pull requests to merge' });
    for (const pr of included) {
      const state = el('span', { className: 'prm-item-state' });
      const detail = el('span', { className: 'prm-item-detail' });
      const item = el('li', { className: 'prm-item' },
        el('span', { className: 'prm-item-icon' }),
        el('span', { className: 'prm-item-main' },
          el('span', { className: 'prm-item-title' }, el('span', { className: 'prm-item-number', textContent: `#${pr.number}` }), ` ${pr.title}`),
          detail),
        state);
      items.set(pr.number, { item, state, detail });
      list.append(item);
    }

    const excludedSection = excluded.length === 0 ? null : el('section', { className: 'prm-excluded', 'aria-labelledby': 'prm-excluded-title' },
      el('h3', { id: 'prm-excluded-title', className: 'prm-excluded-title', textContent: `Not included (${excluded.length})` }),
      el('ul', { className: 'prm-excluded-list' }, ...excluded.map(pr => el('li', {},
        el('span', { className: 'prm-item-number', textContent: `#${pr.number}` }),
        el('span', { className: 'prm-excluded-name', textContent: ` ${pr.title}` }),
        el('span', { className: 'prm-chip prm-excluded-reason', 'data-tone': pr.verdict?.tone ?? 'danger' },
          icon(pr.verdict?.icon), pr.verdict?.label ?? 'Status unavailable')))));

    const progress = el('p', { className: 'prm-progress', role: 'status' });
    const cancel = el('button', { type: 'button', className: 'prm-btn', textContent: 'Cancel' });
    const confirm = el('button', { type: 'button', className: 'prm-btn prm-btn-primary' }, icon('merge'), `Merge ${count} ${noun}`);
    const close = el('button', { type: 'button', className: 'prm-close', 'aria-label': 'Close' }, icon('x'));

    const dialog = el('dialog', { className: 'prm-dialog', 'aria-labelledby': 'prm-dialog-title' },
      el('header', { className: 'prm-header' },
        el('div', {},
          el('h2', { id: 'prm-dialog-title', className: 'prm-title', textContent: `Merge ${count} ${noun}` }),
          el('p', { className: 'prm-subtitle', textContent: `${owner}/${repo}: each one is re-checked right before it merges` })),
        close),
      el('div', { className: 'prm-body' },
        el('div', { className: 'prm-field' },
          el('label', { htmlFor: 'prm-method', textContent: 'Merge method' }),
          el('span', { className: 'prm-select-wrap' }, methodSelect, icon('chevron', 'prm-select-chevron'))),
        list,
        excludedSection),
      el('footer', { className: 'prm-footer' }, progress, cancel, confirm));

    const setItem = (number, statusName, detailText = '') => {
      const entry = items.get(number);
      if (!entry) return;
      const [iconName, text, tone] = RUN_STATUS[statusName] ?? RUN_STATUS.failed;
      entry.item.dataset.status = statusName;
      entry.item.dataset.tone = tone;
      entry.item.querySelector('.prm-item-icon').replaceChildren(icon(iconName, statusName === 'checking' || statusName === 'merging' ? 'prm-spin' : ''));
      entry.state.textContent = text;
      entry.detail.textContent = detailText;
    };
    included.forEach(pr => setItem(pr.number, 'queued'));

    let phase = 'confirm';
    const setPhase = next => {
      phase = next;
      dialog.dataset.phase = next;
    };
    let stopRequested = false;
    let anyMerged = false; // merged, or possibly merged: the list must be reloaded either way
    const tally = { merged: 0, skipped: 0, failed: 0 };

    const finish = (note = '') => {
      setPhase('done');
      const parts = [`${tally.merged} merged`];
      if (tally.skipped) parts.push(`${tally.skipped} skipped`);
      if (tally.failed) parts.push(`${tally.failed} failed`);
      progress.textContent = note ? `${parts.join(', ')}. ${note}` : parts.join(', ');
      close.hidden = false;
      cancel.hidden = true;
      confirm.hidden = false;
      confirm.disabled = false;
      confirm.replaceChildren('Done');
      confirm.focus();
    };

    const teardown = () => {
      dialog.close();
      dialog.remove();
      dialogOpen = false;
      if (anyMerged) location.reload(); // GitHub's list does not drop merged rows on its own
      else refresh(readRows(), { force: true });
    };

    // Each PR is re-checked at the confirmed commit and handed to GitHub about a second apart
    // (GitHub asks for that between merges); results are collected as GitHub finishes them, so
    // one slow merge never holds up the next. Every message is a short task for the worker.
    const runId = crypto.randomUUID();
    let stopRun = () => {};
    const start = async () => {
      setPhase('running');
      methodSelect.disabled = true;
      close.hidden = true;
      confirm.hidden = true;
      cancel.textContent = 'Stop sending';
      const method = methodSelect.value;
      const send = async message => {
        try {
          return await chrome.runtime.sendMessage({ ...message, owner, repo, runId });
        } catch {
          return null; // the extension was reloaded or removed mid-run
        }
      };
      // The worker checks this right before every merge request, so a PR whose re-check is
      // still running when Stop is pressed is not sent either.
      stopRun = () => {
        stopRequested = true;
        send({ type: 'merge-stop' });
      };
      const unconfirmed = detail => ({ status: 'failed', detail: `${detail} Check this pull request before retrying.`, fatal: true, uncertain: true });
      const settled = new Set();
      let note = '';
      const settle = (number, result) => {
        if (settled.has(number)) return;
        settled.add(number);
        const final = ['merged', 'skipped', 'failed'].includes(result?.status) ? result : unconfirmed('Lost contact with the extension.');
        setItem(number, final.status, final.detail);
        tally[final.status] += 1;
        if (final.status === 'merged' || final.uncertain) anyMerged = true;
        if (final.fatal && !note) {
          note = `Stopped: ${final.detail}`;
          stopRun();
        }
      };

      const pending = new Map(); // number -> { uuid, sentAt, unreachable }
      const retries = [];
      let lastTry = false;
      // GitHub refused only because the base branch moved under it: try once more at the end.
      const retryLater = number => {
        if (lastTry) {
          settle(number, { status: 'failed', detail: 'GitHub kept reporting that the base branch moved' });
        } else {
          retries.push(number);
          setItem(number, 'queued', 'GitHub asked to try again once the others finish');
        }
      };
      const submitted = (number, result) => {
        if (result?.status === 'pending') {
          pending.set(number, { uuid: result.uuid, sentAt: performance.now(), unreachable: 0 });
          setItem(number, 'merging');
        } else if (result?.status === 'retry') {
          retryLater(number);
        } else {
          settle(number, result);
        }
      };
      let sending = true;
      const collect = async () => {
        let wait = 1_000;
        while (sending || pending.size) {
          await sleep(wait);
          wait = 1_000;
          if (!pending.size) continue;
          const asked = [...pending];
          const reply = await send({ type: 'merge-status', entries: asked.map(([number, { uuid }]) => ({ number, uuid })) });
          for (const [number, entry] of asked) {
            const result = reply?.ok ? reply.results?.[number] : { status: 'pending', unreachable: true };
            if (!result || result.status === 'pending') {
              entry.unreachable = result?.unreachable ? entry.unreachable + 1 : 0;
              wait = Math.max(wait, Math.min(result?.retryAfterMs ?? 0, 60_000));
              const why = reply?.ok ? 'GitHub accepted the merge but its result could not be read.' : `Lost contact with the extension${reply?.message ? ` (${reply.message})` : ''}.`;
              if (entry.unreachable >= 3) {
                pending.delete(number);
                settle(number, unconfirmed(why));
              } else if (performance.now() - entry.sentAt > 90_000) {
                pending.delete(number);
                settle(number, unconfirmed('GitHub is still processing the merge.'));
              }
              continue;
            }
            pending.delete(number);
            submitted(number, result);
          }
          if (!sending && !lastTry && pending.size) progress.textContent = `Waiting for GitHub to finish ${pending.size}`;
        }
      };
      const collecting = collect();

      try {
        for (const [index, pr] of included.entries()) {
          if (stopRequested) {
            settle(pr.number, { status: 'skipped', detail: note ? 'Not sent' : 'Stopped before sending' });
            continue;
          }
          progress.textContent = `Sending ${index + 1} of ${count}`;
          setItem(pr.number, 'checking');
          const result = await send({ type: 'merge-submit', number: pr.number, headOid: pr.headOid, method });
          submitted(pr.number, result);
          if (result?.sent && index < included.length - 1) await sleep(1_000);
        }
        sending = false;
        await collecting;

        // Re-check each and try once more, one at a time: each finishes before the next is sent,
        // so the base branch cannot move under it again because of this run.
        lastTry = true;
        for (const [index, number] of retries.entries()) {
          if (stopRequested) {
            settle(number, { status: 'skipped', detail: 'Not sent' });
            continue;
          }
          progress.textContent = `Trying again ${index + 1} of ${retries.length}`;
          setItem(number, 'checking');
          const pr = included.find(item => item.number === number);
          submitted(number, await send({ type: 'merge-submit', number, headOid: pr.headOid, method }));
          await collect();
        }
      } finally {
        // Whatever happened, every row ends with an outcome and the dialog can be closed.
        sending = false;
        for (const pr of included) {
          if (!settled.has(pr.number)) settle(pr.number, unconfirmed('The run ended before this pull request finished.'));
        }
        finish(note || (stopRequested ? 'Stopped by you; merges already sent were finished by GitHub.' : ''));
      }
    };

    // A selection with PRs that are not ready is confirmed twice. The first press only says
    // how many will be skipped, moves focus to Back, and keeps Merge disabled for a moment,
    // so a double click, a held Enter or a reflex second press cannot pass both steps.
    const SECOND_PRESS_DELAY_MS = 800;
    let armTimer = 0;
    let armedAt = 0; // kept here too: page script can clear a DOM attribute, not this
    const askAgain = () => {
      setPhase('confirm-skip');
      armedAt = performance.now();
      confirm.disabled = true;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        if (phase === 'confirm-skip') confirm.disabled = false;
      }, SECOND_PRESS_DELAY_MS);
      const skipped = excluded.length;
      progress.replaceChildren(icon('alert'),
        `${skipped} of the ${count + skipped} selected pull requests ${skipped === 1 ? 'is' : 'are'} not ready and will not be merged.`);
      confirm.replaceChildren(icon('merge'), `Merge only the ${count} ready`);
      cancel.textContent = 'Back';
      dialog.querySelector('.prm-excluded')?.scrollIntoView({ block: 'nearest' });
      cancel.focus();
    };
    const backToConfirm = () => {
      clearTimeout(armTimer);
      confirm.disabled = false;
      setPhase('confirm');
      progress.replaceChildren();
      confirm.replaceChildren(icon('merge'), `Merge ${count} ${noun}`);
      cancel.textContent = 'Cancel';
    };
    confirm.addEventListener('click', event => {
      if (!event.isTrusted) return;
      if (phase === 'confirm') {
        if (excluded.length > 0) askAgain();
        else start();
      } else if (phase === 'confirm-skip') {
        if (performance.now() - armedAt < SECOND_PRESS_DELAY_MS) return;
        start();
      } else if (phase === 'done') {
        teardown();
      }
    });
    cancel.addEventListener('click', () => {
      if (phase === 'running') {
        stopRun();
        cancel.disabled = true;
        cancel.textContent = 'Stopping';
      } else if (phase === 'confirm-skip') {
        backToConfirm();
      } else {
        teardown();
      }
    });
    dialog.addEventListener('keydown', event => {
      event.stopPropagation(); // keep GitHub's single-key shortcuts from firing behind the dialog
      // A held Enter repeats keydowns, and Chrome turns each into a fresh click: one press only.
      if (event.repeat && event.key === 'Enter') event.preventDefault();
    });
    close.addEventListener('click', teardown);
    dialog.addEventListener('cancel', event => {
      event.preventDefault(); // Escape: close only when nothing is running
      if (phase !== 'running') teardown();
    });
    // Chrome may force-close a modal after repeated Escape presses; keep a running batch visible.
    dialog.addEventListener('close', () => {
      if (phase === 'running') dialog.showModal();
    });

    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
    schedule();
  }

  // ---- wiring ------------------------------------------------------------------------------

  const observer = new MutationObserver(schedule);
  // Ticking a row changes the checkbox but nothing in the DOM, so listen for the change itself.
  document.addEventListener('change', schedule, true);
  navigation.addEventListener('currententrychange', schedule); // every in-page navigation, back and forward too
  // Coming back from the settings tab is the usual way a token appears or gets fixed.
  const recheckToken = () => {
    if (dead || !page || document.visibilityState !== 'visible' || !needsSettings()) return;
    lastKey = ''; // focus and visibilitychange arrive together; schedule() turns them into one read
    pollAfter = 0;
    schedule();
  };
  document.addEventListener('visibilitychange', recheckToken);
  window.addEventListener('focus', recheckToken);
  const pollTimer = setInterval(() => {
    if (!isActive() || document.visibilityState !== 'visible' || Date.now() < pollAfter || busy || dialogOpen) return;
    const rows = readRows();
    if (rows.some(row => !verdictFor(row.number).settles)) refresh(rows, { force: true });
  }, POLL_MS);
  schedule();
})();
