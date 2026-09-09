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
    /* Long enough that a popup sizing itself to its content is unmistakably wider than one
       held at the configured width. */
    const LONG_TITLE = "An article headline long enough that an unpinned popup would stretch well past the width the user configured";

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

    /* Opens one of the two documents and waits for it to have rendered. Every step here crosses
       geckodriver rather than a devtools socket, and the event page answers slower than a service
       worker, so the render is polled for rather than checked once. */
    async function openRendered(openExtensionPage, url, expected = 1) {
        const page = await openExtensionPage(url);

        await expect(async () => {
            expect(await page.count("#feed .item")).toBe(expected);
        }).toPass(RETRY);

        return page;
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

        const page = await openRendered(openExtensionPage, "popup.html", 3);

        const titles = await page.evaluate(() =>
            [...document.querySelectorAll("#feed .title")].map(node => node.textContent.trim()));
        expect(titles).toEqual(["Article a", "Article b", "Article c"]);
    });

    test("keeps the popup layout without the panel marker", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await openRendered(openExtensionPage, "popup.html");

        expect(await layout(page)).toEqual({ body: "", content: "" });
    });

    /* The width that setPopupWidth() pins onto #feed. #popup-body shrink-wraps, so that pin is
       the only thing between the popup and the width of its longest article title -- and firefox
       is where it came undone. getState used to hand the popup appGlobal.options itself, whose
       popupWidth is an accessor property, and the clone behind runtime.sendMessage shows own data
       properties only. The popup read undefined, jQuery took .width(undefined) for a getter and
       wrote nothing, and a filled popup grew to roughly twice the width of an empty one. */
    test("pins the popup to the configured width", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a", { title: LONG_TITLE })]);
        await signIn({ popupWidth: 420 });

        const page = await openRendered(openExtensionPage, "popup.html");

        const measured = await page.evaluate(() => ({
            feed: document.getElementById("feed").style.width,
            body: Math.round(document.body.getBoundingClientRect().width)
        }));

        expect(measured.feed).toBe("420px");
        // Unpinned, the shrink-wrapped body follows the title instead and runs far past this.
        expect(measured.body).toBeLessThan(500);
    });

    test("takes the sidebar layout with the panel marker", async ({ mockApi, signIn, openExtensionPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await openRendered(openExtensionPage, "popup.html?panel=1");

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
        const popup = await openRendered(openExtensionPage, "popup.html");

        expect(await panel.evaluate(() => document.body.style.width)).toBe("100%");
        expect(await popup.evaluate(() => document.body.style.width)).toBe("");
    });
});
