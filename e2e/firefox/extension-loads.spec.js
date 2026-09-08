const { test, expect, RETRY, POLL } = require("../fixtures/firefox-extension");
const { item, SUBSCRIPTIONS, GLOBAL_ALL } = require("../fixtures/feed-items");

/**
 * The smoke test for the firefox harness. If this passes, the temporary add-on installs
 * under the id the manifest declares, the pinned moz-extension origin is the one firefox
 * actually used, injected scripts can reach the WebExtension apis, the event page boots
 * from background.scripts, and the proxy is genuinely intercepting its own fetches.
 */
test.describe("firefox extension loading", () => {
    test("installs under the id the manifest declares", async ({ extension, controlPage }) => {
        //createDriver already refuses to hand back a session otherwise, so this is really
        //an assertion about the manifest: a temporary add-on only keeps a stable id
        //because browser_specific_settings.gecko.id gives it one.
        const runtimeId = await controlPage.evaluate(browser => browser.runtime.id);

        expect(runtimeId).toBe(extension.id);
    });

    /*
     * moz-extension:// origins are randomised per profile, so every url in this suite
     * depends on the uuid pin in e2e/fixtures/firefox-driver.js holding. If it ever stops
     * being honoured, this is what says so -- and it is also the fallback: read the real
     * hostname here instead of pinning it.
     */
    test("uses the pinned moz-extension origin", async ({ extension, browserChrome }) => {
        const hostname = await browserChrome.evaluate(addonId =>
            WebExtensionPolicy.getByID(addonId).mozExtensionHostname, extension.id);

        expect(hostname).toBe(extension.uuid);
    });

    test("declares an event page rather than a service worker", async ({ controlPage, extension }) => {
        const manifest = await controlPage.evaluate(browser => browser.runtime.getManifest());

        expect(manifest.manifest_version).toBe(3);
        expect(manifest.name).toBe("Feedly Notifier");
        /* Firefox has never supported extension service workers. The order is load-bearing:
           core.js builds a FeedlyApiClient while loading, and background.js calls into
           core.js while it is still evaluating. getManifest() resolves the paths against
           the extension root, so this is the declared list with the origin in front. */
        expect(manifest.background.scripts).toEqual([
            "scripts/browser-polyfill.min.js",
            "scripts/feedly.api.js",
            "scripts/core.js",
            "scripts/background.js"
        ].map(extension.url));
        //Normalized to null rather than dropped: firefox knows the key, it just has no
        //implementation behind it.
        expect(manifest.background.service_worker).toBeFalsy();

        // The sidebar is firefox's side panel, and both point at the same marked page.
        expect(manifest.sidebar_action.default_panel).toBe(extension.url("popup.html?panel=1"));
        expect(manifest.side_panel).toBeUndefined();
        expect(manifest.permissions).not.toContain("sidePanel");
    });

    test("loads the core scripts into the event page", async ({ background }) => {
        const globals = await background.evaluate(bg => ({
            hasAppGlobal: typeof bg.appGlobal === "object",
            hasGetFeeds: typeof bg.getFeeds === "function",
            hasApiClient: Boolean(bg.appGlobal && bg.appGlobal.feedlyApiClient)
        }));

        expect(globals).toEqual({ hasAppGlobal: true, hasGetFeeds: true, hasApiClient: true });
    });

    /*
     * The load-bearing assertion for the firefox harness, and the counterpart of the
     * --host-resolver-rules one in e2e/extension-loads.spec.js: interception is done with
     * profile proxy prefs, below the extension, so it catches the event page's own fetches
     * rather than only what a content page asks for.
     */
    test("routes the event page's api calls to the mock server", async ({ background, mockApi }) => {
        const body = await background.evaluate(bg =>
            bg.fetch("http://cloud.feedly.com/v3/profile").then(response => response.json()));

        expect(body).toMatchObject({ id: "e2e-user" });
        expect(mockApi.requestsFor("/v3/profile")).toHaveLength(1);
    });

    test("starts signed out", async ({ background }) => {
        const isLoggedIn = await background.evaluate(bg => bg.appGlobal.isLoggedIn);

        expect(isLoggedIn).toBe(false);
    });

    test("routes messages to the event page", async ({ background }) => {
        //The public path into the background, and the one the popup and options pages use.
        const state = await background.send({ type: "getState" });

        expect(state).toMatchObject({ isLoggedIn: false });
        /* The reply is structured-cloned, which drops the accessors appGlobal.options
           defines, so the backing field is what survives the trip. */
        expect(state.options).toMatchObject({ _updateInterval: 10, accessToken: "" });
    });

    test("fetches feeds through the mock once signed in", async ({ mockApi, signIn }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);

        await signIn();

        await expect(async () => {
            expect(mockApi.requestsFor("/contents").length).toBeGreaterThan(0);
        }).toPass(RETRY);
    });

    /*
     * Hermeticity: every host resolves to the proxy, and the proxy is the mock, so a host
     * nobody mocked answers 404 rather than reaching the real internet.
     * network.proxy.failover_direct is off precisely so a refused connection cannot fall
     * back to a direct one.
     */
    test("cannot reach a host the mock does not serve", async ({ background, mockApi }) => {
        const status = await background.evaluate(bg =>
            bg.fetch("http://example-blog.com/posts/a").then(response => response.status));

        expect(status).toBe(404);
        await expect.poll(() => mockApi.requestsFor("/posts/a").length, POLL).toBe(1);
    });
});
