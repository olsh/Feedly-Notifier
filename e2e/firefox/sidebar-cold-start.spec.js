const { test, expect, RETRY } = require("../fixtures/firefox-extension");
const { SUBSCRIPTIONS, GLOBAL_ALL } = require("../fixtures/feed-items");

/**
 * The regression the localStorage mirror in core.js exists for, and the one thing in the
 * firefox build that no unit test can prove.
 *
 * Firefox suspends the event page when it goes idle, and the click that wakes it is
 * delivered before browser.storage has answered -- storage is asynchronous and an event
 * page has nothing synchronous to read it from. So action.onClicked has to decide what the
 * icon does before it awaits anything: appGlobal.optionsLoaded is false on a fresh boot,
 * and iconOpensSidebar() reads the answer the last initialize() mirrored into localStorage.
 * Without that, the guard would see the in-memory default, fall through to
 * handleActionClick, and lose the user gesture to its first await -- so the first click
 * after every suspension would do nothing at all.
 *
 * The whole value of this test is that it cannot pass vacuously, so it proves three things
 * rather than one: that the event page really went down, that the click is what brought it
 * back, and that what came back was a fresh global rather than the one that never died.
 */
test.describe("firefox sidebar cold start", () => {
    test("opens the sidebar on the first click after the event page is suspended", async ({
        mockApi, signIn, controlPage, background, browserChrome, sidebarIsOpen
    }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, []);

        await signIn({ enableSidePanel: true });

        /* Both of these are what the click will read. The popup has to be gone, or it takes
           precedence and action.onClicked never fires; the mirror has to say "1", or the
           woken event page falls through to handleActionClick. */
        await expect(async () => {
            expect(await controlPage.evaluate(browser => browser.action.getPopup({}))).toBe("");
            expect(await controlPage.evaluate(() => localStorage.getItem("iconOpensSidebar"))).toBe("1");
        }).toPass(RETRY);

        await browserChrome.pinToolbarButton();

        //Survives only as long as the global the event page is running in.
        await background.evaluate(bg => {
            bg.__coldStartMarker = true;
            return true;
        });

        await browserChrome.terminateBackground();
        await expect.poll(browserChrome.backgroundState, RETRY).toBe("stopped");

        /*
         * Nothing may touch storage, close a tab or reach for getBackgroundPage() between
         * here and the click: core.js keeps persistent storage, tabs and webRequest
         * listeners, and any of them would wake the event page and make this test a lie.
         * backgroundState is read in the parent process, so asking does not wake anything.
         */
        await browserChrome.clickToolbarButton();

        // The click is what woke it, rather than something later in this test.
        await expect.poll(browserChrome.backgroundState, RETRY).not.toBe("stopped");

        // And the click still did its job on the way through.
        await expect.poll(sidebarIsOpen, RETRY).toBe(true);

        //Proof the terminate above was not a no-op: a reused global would still have it.
        const marker = await background.evaluate(bg => bg.__coldStartMarker === undefined);
        expect(marker, "the event page was never actually restarted").toBe(true);
    });
});
