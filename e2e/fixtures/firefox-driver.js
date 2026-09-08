const path = require("node:path");

const { Builder } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const proxy = require("selenium-webdriver/proxy");
const { getBinaryPaths } = require("selenium-webdriver/common/driverFinder");

const { FIREFOX_BUILD_DIR } = require("./build");

/* The id the firefox build declares in browser_specific_settings.gecko. A temporary
   add-on keeps the manifest's id, which is what makes everything below addressable. */
const ADDON_ID = "jid1-BOjn8b0IM7kH2w@jetpack";

/* moz-extension:// origins are a uuid firefox generates per profile, so extension pages
   have no fixed url the way chrome-extension://<id>/ does. Seeding the map firefox reads
   at startup pins it, and e2e/firefox/extension-loads.spec.js cross-checks the pin against
   the origin the browser actually handed the add-on. */
const EXTENSION_UUID = "d7ec2b7e-3a13-4f9d-9f2f-2b0f9a1c5e64";

/* Firefox derives a toolbar widget id from the add-on id: lowercased, with everything
   outside [a-z0-9_-] replaced, plus the action suffix. See makeWidgetId in
   browser/components/extensions/parent/ext-browserAction.js. Derived rather than written
   out, so the rule is the documentation. */
function makeWidgetId(addonId) {
    return addonId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

const WIDGET_ID = makeWidgetId(ADDON_ID) + "-browser-action";

function extensionUrl(page) {
    return "moz-extension://" + EXTENSION_UUID + "/" + page;
}

/**
 * Everything about the profile that is not the proxy itself.
 */
function profilePrefs() {
    return {
        //The proxy host and port are a capability rather than a pref (see manualProxy
        //below); these are the two settings around it that geckodriver leaves alone.
        //failover_direct defaults to true and would quietly retry a refused proxy
        //connection directly against the real internet -- exactly the leak the proxy is
        //here to prevent -- and trr.mode 5 keeps DNS-over-HTTPS from going out on its own.
        "network.proxy.failover_direct": false,
        "network.trr.mode": 5,

        //Three ways firefox would otherwise put the api url back to https behind the
        //build's back, all of which surface only as a bare NetworkError because the mock
        //speaks plain http and answers no CONNECT: the preloaded HSTS list, which carries
        //feedly.com; https-first, which retries every http load; and -- the one that
        //actually bites -- upgrade-insecure-requests in the MV3 default extension csp,
        //which the extension inherits without declaring a csp of its own. Only that one
        //directive is dropped, so the script-src the extension pages really run under is
        //the shipped one.
        "network.stricttransportsecurity.preloadlist": false,
        "dom.security.https_first": false,
        "dom.security.https_only_mode": false,
        "extensions.webextensions.default-content-security-policy.v3": "script-src 'self';",

        //Pins the moz-extension:// origin, so extension pages have a url the tests can
        //navigate to without first asking the browser what it generated.
        "extensions.webextensions.uuids": JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }),

        //The maximum. Suspending the event page is a behaviour one spec asks for
        //deliberately (e2e/firefox/sidebar-cold-start.spec.js) and nowhere else should it
        //happen by accident: core.js keeps persistent storage, tabs and webRequest
        //listeners, so an idle timer that could fire would make every other spec racy.
        "extensions.background.idle.timeout": 300000,

        //Everything firefox would otherwise fetch on its own, which under the proxy above
        //would land in mockApi.requests and make the assertions read like noise.
        //geckodriver already disables telemetry reporting, updates and remote settings;
        //these are the ones it leaves on.
        "browser.safebrowsing.malware.enabled": false,
        "browser.safebrowsing.phishing.enabled": false,
        "browser.safebrowsing.blockedURIs.enabled": false,
        "browser.safebrowsing.downloads.enabled": false,
        "network.captive-portal-service.enabled": false,
        "captivedetect.canonicalURL": "",
        "network.connectivity-service.enabled": false,
        "toolkit.telemetry.enabled": false,
        "toolkit.telemetry.unified": false,
        "toolkit.telemetry.server": "data:,",
        "browser.ping-centre.telemetry": false,
        "browser.discovery.enabled": false,
        "browser.region.network.url": "",
        "browser.region.update.enabled": false,
        "extensions.blocklist.enabled": false,
        "extensions.getAddons.cache.enabled": false,
        "browser.newtabpage.enabled": false,
        "browser.shell.checkDefaultBrowser": false,
        "browser.sessionstore.resume_from_crash": false
    };
}

/**
 * Sends every request to the mock, which is what makes the suite hermetic.
 *
 * Firefox has no --host-resolver-rules, so this is the equivalent: a manual proxy that
 * catches the event page's own fetches too, because it applies in necko rather than in
 * the automation layer -- the whole reason this works where Playwright's context.route()
 * could not. A host the mock does not route answers 404 rather than reaching the real
 * internet. It has to be the w3c capability and not prefs: geckodriver owns
 * network.proxy.type and resets it from the capability, silently undoing anything set by
 * hand.
 */
function manualProxy(mockPort) {
    const address = "127.0.0.1:" + mockPort;
    return proxy.manual({ http: address, https: address, bypass: [] });
}

/**
 * The geckodriver to run, configured to give the session system access.
 *
 * --allow-system-access is what lets webdriver both navigate to a moz-extension:// url
 * and evaluate in the browser chrome; without it firefox answers "System access is
 * required" to the second and refuses the first outright. It has to be a geckodriver
 * argument -- geckodriver rejects the equivalent firefox flag when it arrives through
 * capabilities -- and building the service ourselves is why the driver has to be located
 * here rather than left to selenium-manager.
 *
 * On CI the runner image ships geckodriver and points GECKOWEBDRIVER at it, which keeps
 * the suite on the version the image pinned. Locally there is usually no geckodriver at
 * all, and selenium-manager -- a binary bundled with selenium-webdriver, not a postinstall
 * hook, so `npm ci --ignore-scripts` still has it -- downloads and caches one.
 */
function geckodriverService(options) {
    const directory = process.env.GECKOWEBDRIVER;
    const binary = process.platform === "win32" ? "geckodriver.exe" : "geckodriver";
    const executable = directory
        ? path.join(directory, binary)
        : getBinaryPaths(options).driverPath;

    return new firefox.ServiceBuilder(executable).addArguments("--allow-system-access");
}

/**
 * Launches firefox and side-loads the unpacked firefox build into it.
 *
 * installAddon takes the directory as it stands -- selenium zips it before handing it to
 * geckodriver's moz/addon/install -- so there is no packaging step, and `temporary` is
 * what lets an unsigned build install at all.
 */
async function createDriver({ mockPort, headless }) {
    const options = new firefox.Options();

    for (const [key, value] of Object.entries(profilePrefs())) {
        options.setPreference(key, value);
    }

    options.setProxy(manualProxy(mockPort));

    if (headless) {
        options.addArguments("-headless");
    }

    const driver = await new Builder()
        .forBrowser("firefox")
        .setFirefoxOptions(options)
        .setFirefoxService(geckodriverService(options))
        .build();

    /* Everything past build() has to be able to fail without leaking the browser: the
       fixture only learns about the driver from the value returned here, so anything
       thrown before that leaves nothing holding a handle on geckodriver or firefox, and
       they survive the rest of the run. installAddon is the realistic one -- it rejects
       when build-firefox/ is missing. */
    try {
        //The w3c default is 30s, which outlives the spec that would have reported it.
        await driver.manage().setTimeouts({ script: 20000 });
        //Headless lays the chrome out too, but only into the window it was given. The
        //toolbar button needs one wide enough to have a navigation bar to sit in.
        await driver.manage().window().setRect({ width: 1280, height: 900 });

        const installedId = await driver.installAddon(FIREFOX_BUILD_DIR, true);

        if (installedId !== ADDON_ID) {
            throw new Error("Expected the add-on to install as " + ADDON_ID + ", got " + installedId);
        }

        return driver;
    } catch (error) {
        //Nothing useful to say if the teardown fails too, and it must not replace the
        //failure the caller is about to see.
        await driver.quit().catch(() => {});
        throw error;
    }
}

/*
 * The evaluate helpers below exist because marionette is not page.evaluate(), in three
 * ways that each break the obvious code silently:
 *
 *  - executeScript resolves whatever the body returns without awaiting it, so a promise
 *    comes back as {}. Everything goes through executeAsyncScript and the callback
 *    selenium appends as the last argument. A throw inside an async script never reaches
 *    that callback either -- it surfaces as a script timeout -- so errors are carried back
 *    by hand.
 *  - The sandbox marionette evaluates in has xray vision over the page. The WebExtension
 *    api object is installed on the waived window by Schemas.exportLazyGetter, so from the
 *    sandbox `browser` is as invisible as any page global. window.wrappedJSObject waives
 *    that, and the waiver is transitive, so one hop covers everything reached through it.
 *  - Arguments and results cross a compartment boundary. Rebuilding the argument from JSON
 *    hands the extension apis an object from the page's own compartment, and stringifying
 *    the result keeps marionette's serializer looking at a string rather than at a waived
 *    object it may not know how to clone.
 *
 * The injected function is stringified, so like page.evaluate() it can close over nothing
 * and `arg` has to survive JSON. Interpolating its source here rather than reaching for
 * the page's own Function is also what keeps MV3's script-src 'self' out of the way:
 * evalInSandbox is not subject to the page's CSP.
 */
function asyncScript(body) {
    return [
        "const [argJson, done] = arguments;",
        "const arg = argJson === null ? undefined : JSON.parse(argJson);",
        "Promise.resolve()",
        "    .then(() => { " + body + " })",
        "    .then(value => done({ json: JSON.stringify(value === undefined ? null : value) }))",
        "    .catch(error => done({ error: [error && error.message, error && error.stack].filter(Boolean).join(\" | \") || String(error) }));"
    ].join("\n");
}

async function run(driver, body, arg) {
    const result = await driver.executeAsyncScript(
        asyncScript(body),
        arg === undefined ? null : JSON.stringify(arg)
    );

    if (result.error) {
        throw new Error(result.error);
    }

    return JSON.parse(result.json);
}

/** Runs `fn(browser, arg)` in the extension page the driver is currently looking at. */
function evaluateInPage(driver, fn, arg) {
    return run(driver, [
        "const scope = window.wrappedJSObject || window;",
        "return (" + fn + ")(scope.browser, arg);"
    ].join("\n"), arg);
}

/**
 * Runs `fn(backgroundWindow, arg)` in the event page, starting it if it is suspended.
 *
 * runtime.getBackgroundPage() is the firefox event page's answer to evaluating in a
 * chromium service worker: it hands back the background's own window, so appGlobal and the
 * top-level functions are reachable exactly as they are in e2e/fixtures/extension.js.
 * Chrome dropped it in MV3, firefox did not. Note that it *starts* a suspended event page,
 * which is a feature everywhere except sidebar-cold-start.spec.js.
 */
function evaluateInBackground(driver, fn, arg) {
    return run(driver, [
        "const scope = window.wrappedJSObject || window;",
        "return Promise.resolve(scope.browser.runtime.getBackgroundPage()).then(background => {",
        "    if (!background) {",
        "        throw new Error('runtime.getBackgroundPage() returned nothing');",
        "    }",
        "    return (" + fn + ")(background, arg);",
        "});"
    ].join("\n"), arg);
}

/**
 * Runs `fn(arg)` in the browser chrome, with the privileges that come with it.
 *
 * No waiver here: the sandbox has the system principal and the chrome window as its
 * prototype, so Services, ChromeUtils, WebExtensionPolicy and window.windowUtils are all
 * in scope already. Switches back to content whatever happens -- the context is session
 * state, and leaving it on chrome would break every later page evaluate.
 */
async function evaluateInChrome(driver, fn, arg) {
    await driver.setContext(firefox.Context.CHROME);

    try {
        return await run(driver, "return (" + fn + ")(arg);", arg);
    } finally {
        await driver.setContext(firefox.Context.CONTENT);
    }
}

module.exports = {
    ADDON_ID,
    EXTENSION_UUID,
    WIDGET_ID,
    extensionUrl,
    profilePrefs,
    createDriver,
    evaluateInPage,
    evaluateInBackground,
    evaluateInChrome
};
