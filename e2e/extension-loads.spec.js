const { test, expect } = require("./fixtures/extension");
const { item, SUBSCRIPTIONS, GLOBAL_ALL } = require("./fixtures/feed-items");

/**
 * The smoke test for the whole harness. If this passes, the extension loads,
 * the service worker runs, and the mock API is genuinely intercepting the
 * worker's own fetches.
 */
test.describe("extension loading", () => {
    test("registers a service worker with a valid MV3 manifest", async ({ serviceWorker, extensionId }) => {
        expect(extensionId).toMatch(/^[a-z]{32}$/);

        const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());

        expect(manifest.manifest_version).toBe(3);
        expect(manifest.name).toBe("Feedly Notifier");
        expect(manifest.background.service_worker).toBe("scripts/background.js");
    });

    test("loads the core scripts into the worker", async ({ serviceWorker }) => {
        const globals = await serviceWorker.evaluate(() => ({
            hasAppGlobal: typeof globalThis.appGlobal === "object",
            hasGetFeeds: typeof globalThis.getFeeds === "function",
            hasApiClient: Boolean(globalThis.appGlobal && globalThis.appGlobal.feedlyApiClient)
        }));

        expect(globals).toEqual({ hasAppGlobal: true, hasGetFeeds: true, hasApiClient: true });
    });

    /*
     * The load-bearing assertion for the e2e design: Playwright cannot route
     * service-worker traffic, so interception is done at the network layer with
     * --host-resolver-rules. This proves it reaches the worker's own fetches.
     */
    test("routes the worker's api calls to the mock server", async ({ serviceWorker, mockApi }) => {
        const body = await serviceWorker.evaluate(async () => {
            const response = await fetch("http://cloud.feedly.com/v3/profile");
            return response.json();
        });

        expect(body).toMatchObject({ id: "e2e-user" });
        expect(mockApi.requestsFor("/v3/profile")).toHaveLength(1);
    });

    test("starts signed out", async ({ serviceWorker }) => {
        const isLoggedIn = await serviceWorker.evaluate(() => globalThis.appGlobal.isLoggedIn);

        expect(isLoggedIn).toBe(false);
    });

    test("fetches feeds through the mock once signed in", async ({ mockApi, signIn }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);

        await signIn();

        await expect.poll(() => mockApi.requestsFor("/contents").length).toBeGreaterThan(0);
    });

    test("opens the popup without console errors", async ({ popupPage, mockApi }) => {
        mockApi.setStream(GLOBAL_ALL, []);
        const errors = [];

        const page = await popupPage();
        page.on("pageerror", error => errors.push(error.message));
        await page.waitForLoadState("domcontentloaded");

        expect(errors).toEqual([]);
    });
});
