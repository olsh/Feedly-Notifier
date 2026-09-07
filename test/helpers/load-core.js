import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { preprocessPreservingLines } from "./preprocess.js";
import { createBrowserMock } from "./browser-mock.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptsDir = path.join(projectRoot, "src", "scripts");

/**
 * Compiling core.js is the only expensive part of loading, so scripts are
 * compiled once per (file, browser) pair and then run into a fresh context for
 * each test.
 */
const scriptCache = new Map();

function compileScript(name, targetBrowser) {
    const key = `${name}:${targetBrowser}`;
    if (!scriptCache.has(key)) {
        const filename = path.join(scriptsDir, name);
        const source = readFileSync(filename, "utf8");
        // Line-preserving, so stack traces and coverage point at the real file.
        const processed = targetBrowser ? preprocessPreservingLines(source, targetBrowser) : source;
        /*
         * Compiling this repository's own src/scripts files is the entire
         * purpose of the loader: the input is a checked-in source file, never
         * user input, and it runs in an isolated context under the test runner
         * only. Suppression must sit on the reported line itself.
         */
        scriptCache.set(key, new Script(processed, { filename })); // NOSONAR
    }
    return scriptCache.get(key);
}

/**
 * `let` and `const` bindings live in the realm's global lexical environment
 * rather than on the global object, so they never appear on the context. A
 * follow-up script in the *same* context can still see them, which is how
 * `FeedlyApiClient` gets published to the test.
 */
const EXPOSE_LEXICALS = new Script( // NOSONAR - fixed literal, no dynamic input
    "globalThis.FeedlyApiClient = FeedlyApiClient;",
    { filename: "expose-lexicals.js" }
);

function createSandbox(browser, options) {
    return {
        browser,
        chrome: browser,
        console,
        fetch: options.fetch || (async () => {
            throw new Error("Unexpected fetch call: pass a stub via loadCore({ fetch })");
        }),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        // Injected from the host realm so `toBeInstanceOf(Date)` holds in
        // assertions. Other intrinsics stay realm-local -- see the cross-realm
        // note below.
        Date,
        URL,
        URLSearchParams,
        Audio: options.Audio
    };
}

/**
 * Evaluates feedly.api.js and core.js in a fresh V8 context and returns the
 * globals they define.
 *
 * Why a `vm` context at all: the scripts export nothing. They are classic
 * browser globals joined at runtime by `importScripts()`. A `vm` context
 * exposes top-level `function` declarations and `var` as properties of its
 * global object, which is what makes `appGlobal` and every core.js function
 * reachable without touching src/.
 *
 * Source is preprocessed by default. Raw src/ is actively misleading: the
 * `// @if BROWSER=...` directives are comments, so every branch executes and
 * the last one wins -- unpreprocessed, getMethodUrl always reports firefox.
 *
 * CROSS-REALM GOTCHAS. The context has its own intrinsics, so:
 *   - `expect(x).toBeInstanceOf(Array)` fails. Use `Array.isArray(x)`, which is
 *     cross-realm safe, or the structural `toEqual`.
 *   - `expect(p).rejects.toThrow(Error)` fails. Assert on shape instead:
 *     `.rejects.toMatchObject({ message })` or `.rejects.toHaveProperty("status", 401)`.
 *   - `Date` is injected from the host realm, so `toBeInstanceOf(Date)` does work.
 *
 * @param {object} [options]
 * @param {string|null} [options.targetBrowser="chrome"] - preprocess target, or
 *        null to evaluate raw source.
 * @param {object} [options.storage] - seed data for `{ local, sync, session }`.
 * @param {Function} [options.fetch] - stub for the global `fetch`.
 * @returns {{ctx: object, browser: object, appGlobal: object, FeedlyApiClient: Function}}
 */
function loadCore(options = {}) {
    const targetBrowser = options.targetBrowser === undefined ? "chrome" : options.targetBrowser;
    const browser = options.browser || createBrowserMock(options);

    const ctx = createContext(createSandbox(browser, options));

    // Separate scripts, each named after its real file, so failures point at
    // the right source. The second script sees the first script's `let`.
    compileScript("feedly.api.js", targetBrowser).runInContext(ctx);
    compileScript("core.js", targetBrowser).runInContext(ctx);
    EXPOSE_LEXICALS.runInContext(ctx);

    return {
        ctx,
        browser,
        appGlobal: ctx.appGlobal,
        FeedlyApiClient: ctx.FeedlyApiClient
    };
}

/**
 * Loads the MV3 service worker entry point on top of the core scripts.
 *
 * background.js pulls its dependencies in with `importScripts`, which exists
 * only in a worker, so the loader supplies it and ignores the vendor polyfill
 * (the browser mock already stands in for it).
 *
 * Loading has side effects by design: `ensureInitialized()` runs eagerly, so
 * options are read and the schedule started before this returns.
 *
 * @returns {{ctx, browser, appGlobal, onMessage: Function}} `onMessage`
 *          dispatches to the registered runtime.onMessage handler.
 */
function loadBackground(options = {}) {
    const targetBrowser = options.targetBrowser === undefined ? "chrome" : options.targetBrowser;
    const browser = options.browser || createBrowserMock(options);

    const sandbox = createSandbox(browser, options);
    sandbox.importScripts = (...names) => {
        for (const name of names) {
            // The polyfill is what provides `browser`; the mock already does.
            if (name.includes("browser-polyfill")) {
                continue;
            }
            compileScript(path.basename(name), targetBrowser).runInContext(ctx);
        }
        EXPOSE_LEXICALS.runInContext(ctx);
    };

    const ctx = createContext(sandbox);
    compileScript("background.js", targetBrowser).runInContext(ctx);

    const listeners = browser._events["runtime.onMessage"];

    return {
        ctx,
        browser,
        appGlobal: ctx.appGlobal,
        onMessage: (message, sender) => listeners[0](message, sender || {}),
        /*
         * Boot is asynchronous and `startSchedule` fires updateCounter and
         * updateFeeds without awaiting them, so tests must let both settle
         * before touching the caches -- otherwise the boot fetch lands mid-test
         * and overwrites whatever the test just seeded.
         */
        ready: async () => {
            await ctx.ensureInitialized();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    };
}

/**
 * Evaluates feedly.api.js alone, for tests that only need the HTTP client.
 */
function loadApiClient(options = {}) {
    const targetBrowser = options.targetBrowser === undefined ? "chrome" : options.targetBrowser;
    const browser = options.browser || createBrowserMock(options);

    const ctx = createContext(createSandbox(browser, options));

    compileScript("feedly.api.js", targetBrowser).runInContext(ctx);
    EXPOSE_LEXICALS.runInContext(ctx);

    return { ctx, browser, FeedlyApiClient: ctx.FeedlyApiClient };
}

export { loadCore, loadBackground, loadApiClient, projectRoot, scriptsDir };
