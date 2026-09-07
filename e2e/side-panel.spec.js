const { test, expect } = require("./fixtures/extension");
const { item, SUBSCRIPTIONS, GLOBAL_ALL } = require("./fixtures/feed-items");

/**
 * The side panel is what Microsoft Edge lists in its sidebar (issue #297). Playwright
 * cannot drive the browser's sidebar UI, so these tests assert the state that UI reads:
 * the panel's registration, and the page it loads behaving as a panel.
 */
test.describe("side panel", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
    });

    /** What the browser reads to decide whether to offer the extension in its sidebar. */
    function panelOptions(serviceWorker) {
        return serviceWorker.evaluate(() => chrome.sidePanel.getOptions({}));
    }

    /*
     * getOptions() answers with the manifest's own defaults until the worker overrides
     * them, so reading it straight away would pass whatever the worker went on to do.
     * ensureInitialized() is the worker's memoised boot promise: awaiting it puts the
     * read after configureSidePanel(), which is the call under test.
     */
    function settled(serviceWorker) {
        return serviceWorker.evaluate(() => globalThis.ensureInitialized());
    }

    test("declares the panel in the manifest", async ({ serviceWorker }) => {
        const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());

        expect(manifest.permissions).toContain("sidePanel");
        expect(manifest.side_panel.default_path).toBe("popup.html?panel=1");
        // sidePanel.open() is Chrome 116+, and the worker calls it unguarded.
        expect(manifest.minimum_chrome_version).toBe("116");
    });

    /*
     * The regression test for #297: the extension used to disable its own panel
     * whenever the option was off, which is how an extension removes itself from the
     * browser's sidebar. Nothing here touches the options page.
     */
    test("offers the panel out of the box", async ({ serviceWorker }) => {
        await settled(serviceWorker);

        expect(await panelOptions(serviceWorker)).toEqual({
            enabled: true,
            path: "popup.html?panel=1"
        });
    });

    test("still offers the panel once signed in", async ({ signIn, serviceWorker }) => {
        await signIn();
        await settled(serviceWorker);

        expect(await panelOptions(serviceWorker)).toMatchObject({ enabled: true });
    });

    test("leaves the toolbar icon on the popup by default", async ({ signIn, serviceWorker }) => {
        await signIn();
        await settled(serviceWorker);

        const popup = await serviceWorker.evaluate(() => chrome.action.getPopup({}));
        expect(popup).toContain("popup.html");
    });

    test("hands the toolbar icon to the panel when the option is on", async ({ signIn, optionsPage, serviceWorker }) => {
        await signIn();
        const page = await optionsPage();

        await page.locator("#enableSidePanel").check();
        await page.locator("#save").click();

        /* Saving reaches the worker through storage.onChanged, which re-runs the boot
           work outside the promise settled() waits on, so poll for it to land. A popup
           would take precedence over the panel, so it has to be dropped. */
        await expect
            .poll(() => serviceWorker.evaluate(() => chrome.action.getPopup({})))
            .toBe("");

        // Handing the icon over must not cost the browser's own sidebar entry.
        expect(await panelOptions(serviceWorker)).toMatchObject({ enabled: true });
    });

    test("renders the feeds in the panel layout", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);
        await signIn();

        const page = await popupPage("?panel=1");

        await expect(page.locator("#feed .item")).toHaveCount(2);

        // The browser sizes the panel, so the popup's fixed width has to give way to it.
        const layout = await page.evaluate(() => ({
            body: document.body.style.width,
            content: document.getElementById("popup-content").style.width
        }));
        expect(layout).toEqual({ body: "100%", content: "100%" });
    });

    /*
     * The point of the request was an extension pinned open, which only works if it
     * follows the worker's scheduled updates instead of the state it was opened in.
     */
    test("picks up new articles while it stays open", async ({ mockApi, signIn, popupPage, serviceWorker }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await popupPage("?panel=1");
        await expect(page.locator("#feed .item")).toHaveCount(1);

        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b"), item("c")]);
        await serviceWorker.evaluate(() => globalThis.updateFeeds());

        await expect(page.locator("#feed .item")).toHaveCount(3);
    });

    test("leaves the popup alone when the worker updates", async ({ mockApi, signIn, popupPage, serviceWorker }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await popupPage();
        await expect(page.locator("#feed .item")).toHaveCount(1);

        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);
        await serviceWorker.evaluate(() => globalThis.updateFeeds());

        // Re-rendering under the user's cursor would be worse than a stale list.
        await expect(page.locator("#feed .item")).toHaveCount(1);
    });
});
