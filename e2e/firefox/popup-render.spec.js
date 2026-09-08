const { test, expect, RETRY } = require("../fixtures/firefox-extension");
const { item, SUBSCRIPTIONS, GLOBAL_ALL } = require("../fixtures/feed-items");

/**
 * The popup on firefox, and the ?panel=1 marker that tells it whether it is the toolbar
 * popup or the sidebar document.
 *
 * The marker is per document rather than per window on purpose (issue #297, fixed in #386):
 * sidebarAction.isOpen, which popup.js used to ask, only reports whether *a* sidebar is
 * open somewhere in the window, so with one open the toolbar popup laid itself out as a
 * sidebar too. Firefox is the only browser where that could ever have happened, which
 * makes this the one place it can be tested for real.
 */
test.describe("firefox popup", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
    });

    /* The widths applySidebarLayout() sets. The popup relies on fixed dimensions; a
       sidebar the user can drag wider needs percentages, or the inline-flex body in
       style.css shrink-wraps to its 380px minimum. */
    function layout(page) {
        return page.evaluate(() => ({
            body: document.body.style.width,
            content: document.getElementById("popup-content").style.width
        }));
    }

    test("shows the login prompt when signed out", async ({ mockApi, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, []);

        const page = await openExtensionPage("popup.html");

        await expect(async () => {
            expect(await page.visible("#login")).toBe(true);
        }).toPass(RETRY);
        expect(await page.count("#feed .item")).toBe(0);
    });

    test("renders one item per article", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b"), item("c")]);
        await signIn();

        const page = await openExtensionPage("popup.html");

        await expect(async () => {
            expect(await page.count("#feed .item")).toBe(3);
        }).toPass(RETRY);

        const titles = await page.evaluate(() =>
            [...document.querySelectorAll("#feed .title")].map(node => node.textContent.trim()));
        expect(titles).toEqual(["Article a", "Article b", "Article c"]);
    });

    test("keeps the popup layout without the panel marker", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await openExtensionPage("popup.html");

        await expect(async () => {
            expect(await page.count("#feed .item")).toBe(1);
        }).toPass(RETRY);
        expect(await layout(page)).toEqual({ body: "", content: "" });
    });

    test("takes the sidebar layout with the panel marker", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await openExtensionPage("popup.html?panel=1");

        await expect(async () => {
            expect(await page.count("#feed .item")).toBe(1);
        }).toPass(RETRY);
        // The browser sizes the sidebar, so the popup's fixed width has to give way to it.
        expect(await layout(page)).toEqual({ body: "100%", content: "100%" });
    });

    /*
     * Both documents open at once is the case that used to break: the sidebar is what the
     * marker describes, and the popup alongside it must be unaffected by its existence.
     */
    test("lays the two out independently when both are open", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const panel = await openExtensionPage("popup.html?panel=1");
        const popup = await openExtensionPage("popup.html");

        await expect(async () => {
            expect(await popup.count("#feed .item")).toBe(1);
        }).toPass(RETRY);

        expect(await panel.evaluate(() => document.body.style.width)).toBe("100%");
        expect(await popup.evaluate(() => document.body.style.width)).toBe("");
    });
});
