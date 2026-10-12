// Stand-in for GitHub's React pull request list. It reproduces the DOM hooks the extension
// relies on (verified against github.com on 2026-10-11) and React's event delegation: one
// click listener on the root container and a controlled selection state. As on github.com, the
// toolbar appears with the first ticked row and then stays: later ticks change only the
// checkboxes and the count's text node. Navigation between pages is in place (history.pushState).
const app = document.getElementById('app');
const repos = JSON.parse(document.getElementById('prs').textContent);
let prs = [];
let selected = new Set();
let metadata = null;
let list = null;

function mount() {
  const match = location.pathname.match(/^\/([^/]+)\/([^/]+)(\/pulls)?\/?$/);
  selected = new Set();
  app.replaceChildren();
  if (!match?.[3]) {
    app.textContent = 'Repository home';
    return;
  }
  const [, owner, repo] = match;
  prs = repos[`${owner}/${repo}`] ?? [];

  const container = document.createElement('div');
  container.id = '_R_1_-list-view-container';
  metadata = document.createElement('div');
  metadata.id = '_R_1_-list-view-metadata';
  metadata.className = 'fx-metadata';
  metadata.innerHTML = `
    <div id="_R_2_-list-view-select-all-container" class="fx-selectall">
      <input type="checkbox" id="_R_2_-list-view-select-all" data-component="Checkbox" aria-label="Select all pull requests">
      <p class="fx-count"></p>
    </div>`;
  list = document.createElement('ul');
  list.setAttribute('role', 'list');
  list.dataset.listviewComponent = 'items-list';
  container.append(metadata, list);
  app.append(container);

  for (const pr of prs) {
    const li = document.createElement('li');
    li.id = `_R_1_-list-view-node-${pr.number}`;
    li.className = 'fx-row';
    li.innerHTML = `
      <div data-listview-item-title-container="true" class="fx-title">
        <h3><a data-testid="listitem-title-link" href="/${owner}/${repo}/pull/${pr.number}"><span></span></a></h3>
        <span class="fx-label"></span>
      </div>
      <div class="fx-select"><input type="checkbox" data-listview-component="selection-input" data-component="Checkbox"></div>
      <div class="fx-main"><div class="fx-line">
        <span>#${pr.number}</span>
        <span data-testid="timestamp-container"><span aria-hidden="true"> · </span><a>sync-bot</a> opened 2 hours ago</span>
        <span class="fx-checks"><span aria-hidden="true"> · </span>${pr.checks}</span>
      </div></div>`;
    li.querySelector('a span').textContent = pr.title;
    li.querySelector('.fx-label').textContent = pr.label;
    li.querySelector('input').setAttribute('aria-label', `Select: ${pr.title}`);
    list.append(li);
  }
  render();
}

function render() {
  const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
  boxes.forEach((box, i) => { box.checked = selected.has(prs[i].number); });
  const all = metadata.querySelector('input');
  all.checked = prs.length > 0 && selected.size === prs.length;
  all.indeterminate = selected.size > 0 && selected.size < prs.length;
  const count = metadata.querySelector('.fx-count');
  const text = `${selected.size} of ${prs.length} selected`;
  if (count.firstChild) count.firstChild.nodeValue = text; // how React updates text
  else count.textContent = text;
  const existing = metadata.querySelector('[role="toolbar"]');
  if (selected.size === 0) existing?.remove();
  if (selected.size === 0 || existing) return;
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Pull request actions');
  toolbar.className = 'fx-toolbar';
  toolbar.innerHTML = `<div class="fx-actions">${['Mark as', 'Label', 'Assign'].map(label => `
    <div data-action-bar-item="${label.toLowerCase().replace(' ', '-')}">
      <button type="button" data-component="Button" class="fx-btn" data-size="medium" data-variant="default" aria-haspopup="true" id="btn-${label.length}">
        <span data-component="buttonContent"><span data-component="text">${label}</span></span>
      </button>
    </div>`).join('')}</div>`;
  metadata.append(toolbar);
}

// React 19 delegates from the root container.
app.addEventListener('click', event => {
  const box = event.target.closest('input[type="checkbox"]');
  if (!box) return;
  if (box.id.endsWith('-list-view-select-all')) {
    if (selected.size === prs.length) selected.clear();
    else prs.forEach(pr => selected.add(pr.number));
  } else {
    const number = Number(box.closest('li').id.split('-').pop());
    if (box.checked) selected.add(number);
    else selected.delete(number);
  }
  render();
});

window.__selected = () => [...selected].sort((a, b) => a - b);
// mountDelayMs: the new page's list renders late, like a slow client-side route.
window.__softNav = (path, mountDelayMs = 0) => {
  history.pushState({}, '', path);
  if (!mountDelayMs) return mount();
  app.replaceChildren('Loading…');
  setTimeout(mount, mountDelayMs);
};
mount();
