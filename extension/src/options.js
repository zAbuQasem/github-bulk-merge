// Settings page. The token and passphrase are handed to the service worker and never read back;
// the worker keeps the token on disk only encrypted with the passphrase.

const $ = id => document.getElementById(id);

// GitHub's colourblind and tritanopia themes move success and the primary button to blue
// (and, for colourblind, danger to orange). Values from GitHub's theme stylesheets.
const VARIANTS = {
  light_colorblind: { '--success': '#0969da', '--danger': '#bc4c00', '--danger-muted': '#fff1e5', '--primary-bg': '#0969da', '--primary-bg-hover': '#0864d1' },
  light_tritanopia: { '--success': '#0969da', '--primary-bg': '#0969da', '--primary-bg-hover': '#0864d1' },
  dark_colorblind: { '--success': '#58a6ff', '--danger': '#f0883e', '--danger-muted': '#db6d281a', '--primary-bg': '#1f6feb', '--primary-bg-hover': '#1b63d3' },
  dark_tritanopia: { '--success': '#58a6ff', '--primary-bg': '#1f6feb', '--primary-bg-hover': '#1b63d3' },
};
const systemDark = matchMedia('(prefers-color-scheme: dark)');

// theme: the color mode and theme names GitHub had on its last visited page, if any.
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme?.mode === 'light' || theme?.mode === 'dark') root.dataset.scheme = theme.mode;
  else delete root.dataset.scheme;
  const dark = theme?.mode === 'dark' || (theme?.mode !== 'light' && systemDark.matches);
  const name = (dark ? theme?.dark : theme?.light)?.replace(/_high_contrast$/, '');
  root.removeAttribute('style');
  for (const [property, value] of Object.entries(VARIANTS[name] ?? {})) root.style.setProperty(property, value);
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

const VIEWS = { unlocked: 'connected', locked: 'unlock', none: 'connect' };

async function render() {
  const status = await chrome.runtime.sendMessage({ type: 'token-status' });
  applyTheme(status?.theme);
  systemDark.onchange = () => applyTheme(status?.theme);
  const view = VIEWS[status?.state] ?? 'connect';
  for (const id of Object.values(VIEWS)) $(id).hidden = id !== view;
  const who = status?.login ? `@${status.login}` : 'GitHub token';
  $('login').textContent = `Connected as ${who}`;
  $('locked-login').textContent = `${who} is locked`;
  for (const field of document.querySelectorAll('input')) field.value = '';
  document.querySelector(`#${view} input`)?.focus();
}

// Runs one request with its button showing progress; key derivation takes a moment.
async function submit(button, busyLabel, message) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  showError('');
  try {
    return await chrome.runtime.sendMessage(message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$('connect').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('passphrase').value !== $('passphrase-confirm').value) {
    showError('The passphrases do not match.');
    return;
  }
  const result = await submit($('save'), 'Checking…', { type: 'token-save', token: $('token').value, passphrase: $('passphrase').value });
  if (result?.ok) await render();
  else showError(result?.message || 'Could not save the token.');
});

$('unlock').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await submit($('unlock-submit'), 'Unlocking…', { type: 'token-unlock', passphrase: $('unlock-passphrase').value });
  if (result?.ok) {
    await render();
  } else {
    showError(result?.message || 'Could not unlock.');
    $('unlock-passphrase').select();
  }
});

$('lock').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'token-lock' });
  await render();
});

for (const id of ['remove', 'forget']) {
  $(id).addEventListener('click', async () => {
    showError('');
    await chrome.runtime.sendMessage({ type: 'token-clear' });
    await render();
  });
}

render();
