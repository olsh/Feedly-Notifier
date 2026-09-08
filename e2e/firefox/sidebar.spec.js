const { test, expect, RETRY } = require("../fixtures/firefox-extension");
const { SUBSCRIPTIONS, GLOBAL_ALL } = require("../fixtures/feed-items");

/**
 * The firefox half of issue #297. Chromium's side panel is registered through an api and
 * e2e/side-panel.spec.js can assert the registration; firefox's sidebar is declared in the
 * manifest and there is nothing to register, so the only thing worth asserting is the
 * behaviour itself -- the toolbar icon opening and closing it.
 */
test.describe("firefox sidebar", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, []);
    });

    /* What the toolbar icon will do, as core.js recorded it. The event page has to answer
       that question before it has awaited anything, so the answer is mirrored into
       localStorage -- the one thing an event page can read synchronously. Same origin as
       the control page, so it is readable from there without waking anything. */
    function iconOpensSidebar(controlPage) {
        return controlPage.evaluate(() => localStorage.getItem("iconOpensSidebar"));
    }

    function popupPath(controlPage) {
        return controlPage.evaluate(browser => browser.action.getPopup({}));
    }

    test("leaves the toolbar icon on the popup by default", async ({ signIn, controlPage }) => {
        await signIn();

        await expect(async () => {
            expect(await iconOpensSidebar(controlPage)).toBe("0");
        }).toPass(RETRY);
        expect(await popupPath(controlPage)).toContain("popup.html");
    });

    test("hands the toolbar icon to the sidebar when the option is on", async ({ signIn, controlPage }) => {
        await signIn({ enableSidePanel: true });

        /* Both halves matter: the popup has to go, or it would take precedence over the
           sidebar and the icon would never reach action.onClicked at all. */
        await expect(async () => {
            expect(await popupPath(controlPage)).toBe("");
            expect(await iconOpensSidebar(controlPage)).toBe("1");
        }).toPass(RETRY);
    });

    test("opens the sidebar from the toolbar icon, and closes it again", async ({
        signIn, controlPage, browserChrome, sidebarIsOpen
    }) => {
        await signIn({ enableSidePanel: true });

        await expect(async () => {
            expect(await popupPath(controlPage)).toBe("");
        }).toPass(RETRY);

        await browserChrome.pinToolbarButton();
        expect(await sidebarIsOpen()).toBe(false);

        await browserChrome.clickToolbarButton();

        /* openSidePanel() fires sidebarAction.toggle() without awaiting it -- awaiting
           would move the call out of the user gesture firefox requires -- so the sidebar
           opens a beat after the click returns. */
        await expect.poll(sidebarIsOpen, RETRY).toBe(true);

        /* Toggle rather than open: with the popup gone the icon is the only way in, so the
           second click has to close what the first one opened. */
        await browserChrome.clickToolbarButton();
        await expect.poll(sidebarIsOpen, RETRY).toBe(false);
    });

    /*
     * The negative case, and the reason iconOpensSidebar has to be right: with the option
     * off the same click must fall through to handleActionClick and open feedly instead.
     * openSiteOnIconClick is what drops the popup here -- without it the icon opens the
     * popup and never reaches action.onClicked at all.
     */
    test("opens feedly from the toolbar icon when the option is off", async ({
        signIn, controlPage, browserChrome, sidebarIsOpen
    }) => {
        await signIn({ openSiteOnIconClick: true });

        await expect(async () => {
            expect(await popupPath(controlPage)).toBe("");
            expect(await iconOpensSidebar(controlPage)).toBe("0");
        }).toPass(RETRY);

        await browserChrome.pinToolbarButton();
        await browserChrome.clickToolbarButton();

        await expect.poll(() => controlPage.evaluate(browser =>
            browser.tabs.query({}).then(tabs => tabs.map(tab => tab.url))), RETRY)
            .toContain("https://feedly.com/");
        expect(await sidebarIsOpen()).toBe(false);
    });
});
