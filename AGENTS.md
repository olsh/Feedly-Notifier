# Repository Guidelines

## Project Structure & Module Organization

Feedly Notifier is a browser extension for Chrome, Firefox, Opera, and Edge. Source files live in `src/`: JavaScript modules are under `src/scripts/`, extension pages are `popup.html` and `options.html`, and static resources are grouped into `styles/`, `images/`, `sound/`, and `_locales/`. Store-listing translations are maintained separately in `translations/store/`. Grunt generates unpacked extension files and release archives in `build/`; treat that directory as disposable output. Unit tests live in `test/` (Vitest) and end-to-end tests in `e2e/` (Playwright).

## Build, Test, and Development Commands

- `npm ci` installs the exact dependency versions from `package-lock.json`.
- `npm run lint` checks JavaScript with the repository's ESLint configuration.
- `npm run lint:fix` applies safe, automatic lint fixes.
- `npm run lint:addon` runs Mozilla's `addons-linter` over `build/feedly-notifier-firefox.zip`, so build the firefox package first. It is the same linter that gates the addons.mozilla.org upload, and CI runs it on every pull request. It fails on errors only; the remaining warnings are expected -- the `sidePanel` calls core.js guards at runtime, `innerHTML` inside vendored jQuery/DOMPurify, and the min-version pair for `data_collection_permissions`, which Firefox reads only from 140 while the manifest floor is 128.
- `npm test` runs the Vitest unit suite; `npm run test:watch` reruns on change and `npm run test:coverage` reports coverage.
- `npm run build:e2e` produces the two unpacked builds the end-to-end suite loads -- `build/` for chromium and `build-firefox/` for firefox, whose manifests differ so one directory cannot hold both -- and `npm run test:e2e` runs both projects. `npm run test:e2e:chromium` and `npm run test:e2e:firefox` run one at a time, and `npm run test:e2e:headed` watches them. The chromium half needs `npx playwright install chromium` once; the firefox half needs Firefox installed, and downloads a geckodriver through selenium-manager on first run.
- `npx grunt sandbox --clientId=<id> --clientSecret=<secret> --browser=chrome` creates an unpacked development build in `build/`. Supported browser values are `chrome`, `opera`, and `firefox`.
- `npx grunt build --clientId=<id> --clientSecret=<secret> --browser=firefox` cleans, builds, and packages a browser-specific ZIP.

After a sandbox build, load `build/` as an unpacked/temporary extension in the target browser.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, four-space indentation, final newlines, and no trailing whitespace. ESLint targets ES2021 browser scripts and enforces double quotes, semicolons, braces for control flow, and indented `switch` cases. Use `camelCase` for variables and functions and descriptive lowercase filenames consistent with `feedly.api.js` and `background.js`. Keep browser-specific behavior explicit and localize user-facing text through `src/_locales/`.

## Testing Guidelines

Run `npm run lint` and `npm test` before submitting; run `npm run test:e2e` as well when touching the popup, the options page, or the background worker. There is no coverage threshold.

**Unit tests (`test/`, Vitest, `*.test.js`).** The source files export nothing -- they are classic browser globals joined at runtime by `importScripts`. `test/helpers/load-core.js` evaluates them in a fresh `vm` context per test and hands back `appGlobal` and the top-level functions; a fresh context is also how state is reset between tests. `test/helpers/browser-mock.js` stands in for the promise-based `browser.*` API, and `test/helpers/load-page.js` loads `popup.js` and `options.js` into jsdom for their pure logic. Two things to know before writing tests:

- The `// @if BROWSER='...'` directives are comments, so raw `src/` runs *every* branch and the last one wins. The loaders preprocess source first (chrome by default); pass `targetBrowser` to assert another target. `test/preprocess.test.js` pins the in-house line-preserving preprocessor against the one Grunt uses.
- The background is loaded the way the target browser loads it. Chromium runs `background.js` as a service worker that pulls its dependencies in with `importScripts`, which the loader supplies; Firefox runs it as an event page, which has no `importScripts`, so the dependencies are listed in the manifest's `background.scripts` and `loadBackground` follows that list instead. `readManifest` in `test/helpers/load-core.js` is the shared way to read a preprocessed `manifest.json`, and `test/preprocess.test.js` pins the two dependency lists against each other so they cannot drift.
- The `vm` context has its own intrinsics, so `toBeInstanceOf(Array)` and `rejects.toThrow(Error)` do not hold. Assert structurally instead -- `toEqual`, `toMatchObject`, `toHaveProperty("status", 401)`. `Date` is injected from the host realm and does work.

**End-to-end tests (`e2e/`, Playwright, `*.spec.js`, CommonJS).** These load the real built extension into Chromium. Playwright cannot intercept a service worker's own fetches, so the suite instead launches Chromium with `--host-resolver-rules` pointing `cloud.feedly.com` at a local mock (`e2e/fixtures/feedly-server.js`) and rewrites the built API URL from https to http; the shipped `*://*.feedly.com/*` permission already covers http, so the manifest is used as released. Every other host resolves to nothing, keeping the suite hermetic. Sign in with the `signIn` fixture rather than driving OAuth, and note it deliberately waits for the extension's install-time `writeOptions()` before seeding, or the seeded token is overwritten. Tests that would trigger the `<all_urls>` permission prompt cannot work here -- Playwright cannot accept it -- so that path is covered in `test/options.test.js` instead.

**Firefox end-to-end tests (`e2e/firefox/`, `*.spec.js`).** Playwright has no Firefox add-on API of any kind, so this project uses the runner only: the specs drive a real geckodriver session through `selenium-webdriver` and install `build-firefox/` as a temporary add-on. `playwright.config.js` keeps them in a `firefox-extension` project of their own, so `trace`, `video` and `screenshot: only-on-failure` never fire -- `e2e/fixtures/firefox-extension.js` attaches a screenshot and the mock's request log by hand instead. The plumbing lives in `e2e/fixtures/firefox-driver.js`, and six things about it are load-bearing:

- **Hermeticity is a proxy, not a resolver rule.** Firefox has no `--host-resolver-rules`, so every request goes to a manual proxy pointed at the same mock; it applies in necko and therefore catches the event page's own fetches. It has to be the W3C `proxy` capability, because geckodriver owns `network.proxy.type` and silently resets prefs set by hand. `network.proxy.failover_direct` is off, or a refused proxy connection would fall back to a direct one. The mock answers CONNECT with a 502 (`refuseTunnel`) rather than dropping it: firefox reaches for remote settings and content signatures over https, and an unanswered tunnel counts as network activity still in flight, so its shutdown blocks on them and `driver.quit()` costs ~18.5s per session on windows instead of ~0.45s.
- **Three things would put the API URL back to https**, all of which surface only as a bare `NetworkError`: the preloaded HSTS list, which carries feedly.com; https-first; and -- the one that actually bites -- `upgrade-insecure-requests` in the MV3 default extension CSP, which the extension inherits without declaring a CSP of its own. The profile drops that one directive and keeps the shipped `script-src`.
- **`--allow-system-access` is a geckodriver argument.** Without it firefox refuses both chrome-context scripting and navigation to a `moz-extension://` url. The equivalent firefox flag is rejected when it arrives through capabilities, which is why the fixture builds the driver service itself instead of leaving it to selenium-manager.
- **Injected scripts are not `page.evaluate()`.** `executeScript` never awaits, so everything goes through `executeAsyncScript` and carries its errors back by hand. Marionette's sandbox has xray vision, so `browser`, `chrome` and page globals need `window.wrappedJSObject`, while `document` and `localStorage` do not.
- **The background is `runtime.getBackgroundPage()`**, which firefox still supports on MV3 event pages and which *starts* a suspended one -- convenient everywhere except `sidebar-cold-start.spec.js`. `background.send()` over the `runtime.onMessage` router in `background.js` is the public alternative; prefer it where it suffices.
- **The toolbar button is a `toolbaritem` wrapper**, and clicking it does nothing: the listener is on the `toolbarbutton` inside. Get that right and an ordinary `.click()` is enough -- firefox dispatches `action.onClicked` with user input already being handled, so `sidebarAction.toggle()` accepts the gesture with no event synthesis. `CustomizableUI` comes off the browser window rather than an import, because the module has already moved between `resource:///` and `moz-src:///`.

`extensions.background.idle.timeout` is pinned at its maximum so `sidebar-cold-start.spec.js` owns the only event-page suspension in the suite; it terminates the background deliberately and asserts `backgroundState` on both sides of the click, so it cannot pass vacuously. `moz-extension://` origins are randomised per profile, so the UUID is pinned through `extensions.webextensions.uuids` and cross-checked against `WebExtensionPolicy` in `e2e/firefox/extension-loads.spec.js`. `signIn` seeds `storage.sync` exactly as the chromium fixture does; if that ever proves unreliable for a temporary add-on, `SEED_INTO_LOCAL` in `e2e/fixtures/firefox-extension.js` switches it to `storage.local` with `disableOptionsSync`, which is shipped behaviour rather than a test hook.

Tests that deliberately pin existing incorrect behaviour are marked `KNOWN BUG` or `KNOWN BEHAVIOUR` with a file and line reference; treat those as a defect inventory, not as endorsements.

## Commit & Pull Request Guidelines

Recent history uses short, imperative subjects such as `Sanitize feed content in all browsers`; dependency updates use `Bump <package> from <old> to <new> (#123)`. Keep commits focused and avoid signatures, attribution footers, or generated-by notices. Pull requests should explain the user-visible change, link relevant issues, list browsers manually tested, and include screenshots for UI changes. Confirm lint, the unit suite, and a clean browser-specific build before requesting review.

## Security & Configuration

Never commit Feedly credentials, access tokens, generated `keys.json`, or build artifacts. Pass sandbox credentials only through local build arguments and review generated packages before distribution.
