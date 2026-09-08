import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { preprocessPreservingLines } from "./preprocess.js";
import { createBrowserMock } from "./browser-mock.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptsDir = path.join(projectRoot, "src", "scripts");
const manifestPath = path.join(projectRoot, "src", "manifest.json");

/**
 * The manifest as the build resolves it for a target.
 *
 * manifest.json carries plain `//` comments around the directives -- browsers strip
 * them when parsing, `JSON.parse` will not -- so whole-line comments are blanked
 * first. A trailing comment after a value would still throw here rather than be
 * tolerated, which is deliberate: the shipped file has to stay parseable by this rule.
 */
function readManifest(targetBrowser) {
    const resolved = preprocessPreservingLines(readFileSync(manifestPath, "utf8"), targetBrowser);

    return JSON.parse(
        resolved.split("\n").map(line => (/^\s*\/\//.test(line) ? "" : line)).join("\n")
    );
}

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

/**
 * Runs background dependencies into `ctx`, in order, then republishes the lexical
 * bindings they declared.
 *
 * The vendor polyfill is skipped: it is what provides `browser` in the real thing
 * and the mock already does -- and it is not in src/scripts to load anyway, the
 * Gruntfile copies it out of node_modules.
 */
function runBackgroundScripts(ctx, names, targetBrowser) {
    // EXPOSE_LEXICALS would throw on FeedlyApiClient if nothing had run.
    if (names.length === 0) {
        return;
    }

    for (const name of names) {
        if (name.includes("browser-polyfill")) {
            continue;
        }
        compileScript(path.basename(name), targetBrowser).runInContext(ctx);
    }

    EXPOSE_LEXICALS.runInContext(ctx);
}

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
 * Loads the MV3 background entry point on top of the core scripts, the way the
 * target browser does.
 *
 * On chromium background.js is a service worker and pulls its dependencies in with
 * `importScripts`, which exists only in a worker, so the loader supplies it. On
 * firefox it is an event page with no `importScripts` at all, and the browser loads
 * the dependencies listed in the manifest's `background.scripts` beforehand -- so the
 * loader follows that list instead. Either way the vendor polyfill is ignored, the
 * browser mock already stands in for it.
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
    // The worker global background.js calls itself. Only the chromium branch of that
    // call survives preprocessing, so on firefox this is never reached.
    sandbox.importScripts = (...names) => runBackgroundScripts(ctx, names, targetBrowser);

    const ctx = createContext(sandbox);

    /*
     * Read the list rather than restating it: a file added to background.scripts is
     * then loaded here too, and one added only here fails the drift check in
     * test/preprocess.test.js. background.js is the last entry and is run below the
     * same way for every target, so it is dropped. The chromium manifest has no such
     * key, which leaves this a no-op there.
     *
     * A null target means raw source, where every branch survives: both `background`
     * keys resolve and the importScripts call is left intact, so following the list
     * as well would load the core scripts twice. Leave that case to importScripts.
     */
    const declaredScripts = targetBrowser
        ? readManifest(targetBrowser).background.scripts || []
        : [];
    runBackgroundScripts(
        ctx,
        declaredScripts.filter(name => path.basename(name) !== "background.js"),
        targetBrowser
    );

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

export { loadCore, loadBackground, loadApiClient, readManifest, projectRoot, scriptsDir };
