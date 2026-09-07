import { readFileSync } from "node:fs";
import path from "node:path";

import { preprocessPreservingLines } from "./preprocess.js";
import { createBrowserMock } from "./browser-mock.js";
import { projectRoot } from "./load-core.js";

/**
 * Loads popup.js / options.js into the jsdom realm.
 *
 * These two cannot use the `vm` loader: they need a real DOM and the real
 * jQuery, Mustache and DOMPurify builds. The page markup is installed into the
 * jsdom document and the script is evaluated with indirect eval.
 *
 * IMPORTANT: both files open with `"use strict"`, and declarations in strict
 * eval code stay in the eval's own scope -- nothing reaches the global object,
 * not even `var` and `function`. So every symbol a test needs must be named in
 * `expose`, and the loader appends a trailer inside the same eval to publish
 * them. Accessors rather than values, so reassignment inside the script (such
 * as popup.js's `options`) stays visible.
 *
 * Keep assertions here to pure logic. jQuery's `:visible`, `slideToggle` and
 * `fadeOut` behave poorly under jsdom; DOM behaviour belongs in the Playwright
 * suite.
 */

const EXPORTS_GLOBAL = "__pageExports";

/** Installs a page's markup, minus its script tags, into the jsdom document. */
function installMarkup(pageName) {
    const html = readFileSync(path.join(projectRoot, "src", pageName), "utf8");
    const parsed = new DOMParser().parseFromString(html, "text/html");

    // The real vendor bundles live in build/, and jsdom would try to fetch them.
    parsed.querySelectorAll("script[src]").forEach(node => node.remove());

    document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
}

/**
 * jsdom implements no matchMedia, and setTheme() calls it unconditionally.
 * @param {boolean} prefersDark - what the media query should report.
 * @returns {Function[]} the change listeners the page registers.
 */
function stubMatchMedia(prefersDark) {
    const listeners = [];
    window.matchMedia = (query) => ({
        matches: Boolean(prefersDark),
        media: query,
        addEventListener: (event, handler) => listeners.push(handler),
        removeEventListener: () => {},
        addListener: (handler) => listeners.push(handler),
        removeListener: () => {}
    });
    return listeners;
}

/** Reads a script from src/scripts and preprocesses it for chrome. */
function readPageScript(name) {
    return preprocessPreservingLines(
        readFileSync(path.join(projectRoot, "src", "scripts", name), "utf8"),
        "chrome"
    );
}

/** Trailer that publishes named bindings out of a strict eval. */
function exportTrailer(target, names) {
    if (!names.length) {
        return "";
    }
    const accessors = names.map(name => `get ${name}() { return ${name}; }`).join(", ");
    return `\n;globalThis.${target} = { ${accessors} };`;
}

/**
 * @param {object} options
 * @param {string} options.script - file name under src/scripts.
 * @param {string} options.page - file name under src/.
 * @param {string[]} options.expose - symbols the test needs out of the script.
 * @param {Array<{script: string, expose: string[]}>} [options.dependencies] -
 *        scripts the page's own <script> tags load first.
 * @param {boolean} [options.prefersDark]
 * @returns {Promise<{page: object, browser: object, $: Function, themeListeners: Function[]}>}
 */
async function loadPage({
    script,
    page,
    expose = [],
    dependencies = [],
    prefersDark = false,
    ...mockOptions
}) {
    installMarkup(page);
    const themeListeners = stubMatchMedia(prefersDark);

    // jsdom's alert() only logs "not implemented"; saveOptions calls it.
    window.alert = () => {};

    const browser = mockOptions.browser || createBrowserMock(mockOptions);
    globalThis.browser = browser;
    globalThis.chrome = browser;

    // Bind the real libraries to the jsdom window, exactly as the pages do.
    const { default: jQuery } = await import("jquery");
    const { default: Mustache } = await import("mustache");
    const { default: DOMPurify } = await import("dompurify");
    const timeago = await import("timeago.js");

    globalThis.$ = jQuery;
    globalThis.jQuery = jQuery;
    globalThis.Mustache = Mustache;
    globalThis.DOMPurify = DOMPurify;
    globalThis.timeago = timeago;

    for (const dependency of dependencies) {
        (0, eval)(readPageScript(dependency.script) + exportTrailer("__dependency", dependency.expose));
        // Dependencies are consumed as bare globals by the page script.
        for (const name of dependency.expose) {
            globalThis[name] = globalThis.__dependency[name];
        }
    }

    (0, eval)(readPageScript(script) + exportTrailer(EXPORTS_GLOBAL, expose));

    return {
        page: globalThis[EXPORTS_GLOBAL] || {},
        browser,
        $: jQuery,
        themeListeners
    };
}

export { loadPage };
