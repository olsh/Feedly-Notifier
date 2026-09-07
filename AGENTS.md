# Repository Guidelines

## Project Structure & Module Organization

Feedly Notifier is a browser extension for Chrome, Firefox, Opera, and Edge. Source files live in `src/`: JavaScript modules are under `src/scripts/`, extension pages are `popup.html` and `options.html`, and static resources are grouped into `styles/`, `images/`, `sound/`, and `_locales/`. Store-listing translations are maintained separately in `translations/store/`. Grunt generates unpacked extension files and release archives in `build/`; treat that directory as disposable output. Unit tests live in `test/` (Vitest) and end-to-end tests in `e2e/` (Playwright).

## Build, Test, and Development Commands

- `npm ci` installs the exact dependency versions from `package-lock.json`.
- `npm run lint` checks JavaScript with the repository's ESLint configuration.
- `npm run lint:fix` applies safe, automatic lint fixes.
- `npm test` runs the Vitest unit suite; `npm run test:watch` reruns on change and `npm run test:coverage` reports coverage.
- `npm run build:e2e` produces the unpacked Chromium build the end-to-end suite loads, and `npm run test:e2e` runs it. Add `--headed` via `npm run test:e2e:headed` to watch it. Requires `npx playwright install chromium` once.
- `npx grunt sandbox --clientId=<id> --clientSecret=<secret> --browser=chrome` creates an unpacked development build in `build/`. Supported browser values are `chrome`, `opera`, and `firefox`.
- `npx grunt build --clientId=<id> --clientSecret=<secret> --browser=firefox` cleans, builds, and packages a browser-specific ZIP.

After a sandbox build, load `build/` as an unpacked/temporary extension in the target browser.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, four-space indentation, final newlines, and no trailing whitespace. ESLint targets ES2021 browser scripts and enforces double quotes, semicolons, braces for control flow, and indented `switch` cases. Use `camelCase` for variables and functions and descriptive lowercase filenames consistent with `feedly.api.js` and `background.js`. Keep browser-specific behavior explicit and localize user-facing text through `src/_locales/`.

## Testing Guidelines

Run `npm run lint` and `npm test` before submitting; run `npm run test:e2e` as well when touching the popup, the options page, or the background worker. There is no coverage threshold.

**Unit tests (`test/`, Vitest, `*.test.js`).** The source files export nothing -- they are classic browser globals joined at runtime by `importScripts`. `test/helpers/load-core.js` evaluates them in a fresh `vm` context per test and hands back `appGlobal` and the top-level functions; a fresh context is also how state is reset between tests. `test/helpers/browser-mock.js` stands in for the promise-based `browser.*` API, and `test/helpers/load-page.js` loads `popup.js` and `options.js` into jsdom for their pure logic. Two things to know before writing tests:

- The `// @if BROWSER='...'` directives are comments, so raw `src/` runs *every* branch and the last one wins. The loaders preprocess source first (chrome by default); pass `targetBrowser` to assert another target. `test/preprocess.test.js` pins the in-house line-preserving preprocessor against the one Grunt uses.
- The `vm` context has its own intrinsics, so `toBeInstanceOf(Array)` and `rejects.toThrow(Error)` do not hold. Assert structurally instead -- `toEqual`, `toMatchObject`, `toHaveProperty("status", 401)`. `Date` is injected from the host realm and does work.

**End-to-end tests (`e2e/`, Playwright, `*.spec.js`, CommonJS).** These load the real built extension into Chromium. Playwright cannot intercept a service worker's own fetches, so the suite instead launches Chromium with `--host-resolver-rules` pointing `cloud.feedly.com` at a local mock (`e2e/fixtures/feedly-server.js`) and rewrites the built API URL from https to http; the shipped `*://*.feedly.com/*` permission already covers http, so the manifest is used as released. Every other host resolves to nothing, keeping the suite hermetic. Sign in with the `signIn` fixture rather than driving OAuth, and note it deliberately waits for the extension's install-time `writeOptions()` before seeding, or the seeded token is overwritten. Tests that would trigger the `<all_urls>` permission prompt cannot work here -- Playwright cannot accept it -- so that path is covered in `test/options.test.js` instead.

Tests that deliberately pin existing incorrect behaviour are marked `KNOWN BUG` or `KNOWN BEHAVIOUR` with a file and line reference; treat those as a defect inventory, not as endorsements.

## Commit & Pull Request Guidelines

Recent history uses short, imperative subjects such as `Sanitize feed content in all browsers`; dependency updates use `Bump <package> from <old> to <new> (#123)`. Keep commits focused and avoid signatures, attribution footers, or generated-by notices. Pull requests should explain the user-visible change, link relevant issues, list browsers manually tested, and include screenshots for UI changes. Confirm lint, the unit suite, and a clean browser-specific build before requesting review.

## Security & Configuration

Never commit Feedly credentials, access tokens, generated `keys.json`, or build artifacts. Pass sandbox credentials only through local build arguments and review generated packages before distribution.
