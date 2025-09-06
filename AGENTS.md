# Repository Guidelines

## Project Structure & Module Organization
- `src/`: WebExtension source (Manifest V3). Key files: `scripts/background.js` (service worker), `scripts/core.js`, `scripts/popup.js`, `scripts/options.js`, `popup.html`, `options.html`, `_locales/`, `images/`, `styles/`, `sound/`.
- `build/`: Grunt output; load this folder as an unpacked extension.
- `logos/`, `translations/`: Project assets and translation resources.
- `.github/`: CI/config files. `.editorconfig`: formatting baseline.

## Build, Test, and Development Commands
Install dependencies:
```
npm install
```
Build a sandboxed, runnable bundle (use Feedly sandbox keys):
```
grunt sandbox --clientId=sandbox --clientSecret=R26NGS2Q9NAPSEJHCXM3 --browser=chrome
```
Other targets:
```
grunt            # copy + preprocess with keys
grunt build      # zipped artifact in build/, then cleanup
```
Load locally: Browser → Extensions → Developer Mode → “Load unpacked” → select `build/`.

## Coding Style & Naming Conventions
- Indentation: 4 spaces; UTF‑8; trim trailing whitespace (enforced by `.editorconfig`).
- JavaScript: use strict mode; prefer `const/let`, camelCase for variables/functions, PascalCase for constructors; keep filenames lowercase with dashes or dots (e.g., `feedly.api.js`).
- HTML/CSS: keep inline scripts minimal; reuse existing classes; keep assets under `images/`, `styles/`, `sound/`.
- ESLint is configured; keep changes focused and fix lint issues as you go.

## Linting
- Command: `npm run lint` (auto-fix: `npm run lint:fix`).
- Scope: ESLint across `.js` files; ignores `build/`, `node_modules/`, assets, and locales.
- Agent rule: after every code change, run `npm run lint` and fix issues before builds or PRs.

## Testing Guidelines
- No unit test suite in-repo. Perform manual smoke tests across supported browsers (Chrome, Firefox, Edge/Opera):
  - Auth flow, unread counter, desktop notifications, popup interactions, options persistence/sync.
  - Permissions prompts (e.g., optional `<all_urls>`) and background alarms.
- For UI changes, attach screenshots/GIFs of popup/options.

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject, reference issue/PR when applicable (e.g., `Fix: handle alarm reset (#123)` or dependency bumps as in history).
- PRs: clear description, motivation, scope, and testing notes; link related issues; include screenshots for UI; list browsers tested and steps to reproduce/verify.

## Security & Configuration Tips
- Do not commit real Feedly `clientId`/`clientSecret`. Use sandbox keys locally via Grunt options.
- Minimize permissions in `manifest.json`; justify any host/permission changes.
- Keep API endpoints consistent; `grunt sandbox` rewrites endpoints for sandbox usage.

## Architecture Overview
- Background service worker schedules updates and handles notifications/webRequests.
- Popup renders feeds and actions; Options manages user preferences with `chrome.storage` (sync/local based on settings).
