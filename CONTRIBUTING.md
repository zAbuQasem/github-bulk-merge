# Contributing

Thanks for taking a look. Bug reports and pull requests are both welcome.

## Setup

```bash
git clone https://github.com/zAbuQasem/github-bulk-merge.git
cd github-bulk-merge
npm ci
npx playwright install chromium
```

There is no build step. Load the `extension/` folder with **Load unpacked** on `chrome://extensions`, and press the reload button there after each change.

## Tests

```bash
npm test            # everything
npm run test:unit   # the readiness rule, the token vault and merge outcomes
npm run test:e2e    # the extension in Chromium, against a fake GitHub
```

The end-to-end tests never reach the real GitHub. They serve a copy of the pull request list and answer the API calls from `tests/e2e/fixtures.js`.

## Dependencies

CI installs packages through [Aikido Safe Chain](https://github.com/AikidoSec/safe-chain), which refuses known malware and any version published in the last 7 days. If you bump a dependency, pick a version that is at least a week old, or CI will fail to install it.

## Commit messages

Release notes and the changelog are built from [Conventional Commits](https://www.conventionalcommits.org/), so the prefix matters.

| Prefix | For |
|---|---|
| `feat:` | Something new a user can see or do |
| `fix:` | A bug fix |
| `security:` | A security improvement |
| `perf:` | Faster or lighter |
| `refactor:` | Code changes with no change in behaviour |
| `docs:` | README, CONTRIBUTING, comments |
| `chore:` | Dependencies, CI, tooling |

```
feat: let the merge method default to the repository's setting
fix: keep the counter in sync after GitHub re-renders the list
```

## Pull requests

1. Fork the repository and branch from `main`.
2. Run `npm test` before you push.
3. Open the pull request against `main`. The test workflow runs on it.

## Releasing

Maintainers only.

1. Bump `version` in `extension/manifest.json` and merge that to `main`.
2. Run **Actions → Release → Run workflow** with the same version, for example `v1.2.0`.

The workflow runs the tests, packages `extension/` as a zip with a SHA256SUMS file, publishes the release at the tested commit, and adds the notes to `CHANGELOG.md`. If `main` is protected against that commit, the release still goes out and the run's summary holds the changelog entry to add by hand.
