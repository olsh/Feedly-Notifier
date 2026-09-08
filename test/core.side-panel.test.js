import { describe, it, expect } from "vitest";

import { loadBackground, createLocalStorageStub } from "./helpers/load-core.js";

/**
 * The side panel is what Microsoft Edge lists in its sidebar (issue #297), so the
 * extension has to register it whether or not the user wants the toolbar icon to open
 * it. `enabled: false` is how an extension removes itself from the browser's sidebar
 * UI -- it is not a way to say "configured but unused".
 *
 * Firefox reaches the same option through a different API, sidebarAction, and the suite
 * for that is at the end of this file.
 */
describe("side panel", () => {
    describe("registration", () => {
        it("registers the panel even though the option is off by default", async () => {
            const { browser, ready } = loadBackground();

            await ready();

            expect(browser._calls.sidePanelOptions).toContainEqual({
                enabled: true,
                path: "popup.html?panel=1"
            });
        });

        it("registers the panel with the option on", async () => {
            const { browser, ready } = loadBackground({
                storage: { sync: { enableSidePanel: true } }
            });

            await ready();

            expect(browser._calls.sidePanelOptions).toContainEqual({
                enabled: true,
                path: "popup.html?panel=1"
            });
        });

        it("never disables the panel", async () => {
            const { browser, ready } = loadBackground();

            await ready();

            const disabling = browser._calls.sidePanelOptions.filter(call => call.enabled === false);
            expect(disabling).toEqual([]);
        });

        it("registers the path the manifest declares", async () => {
            const { browser, ready } = loadBackground();

            await ready();

            // The manifest is what the browser reads before the worker has ever run;
            // this call is what it reads afterwards. They have to agree.
            expect(browser._calls.sidePanelOptions[0].path).toBe("popup.html?panel=1");
        });
    });

    describe("toolbar icon behaviour", () => {
        it("leaves the icon on the popup by default", async () => {
            const { browser, ready } = loadBackground();

            await ready();

            expect(browser._calls.sidePanelBehavior).toContainEqual({ openPanelOnActionClick: false });
            expect(browser._calls.setPopup).toContain("popup.html");
            expect(browser._calls.setPopup).not.toContain("");
        });

        it("hands the icon to the panel when the option is on", async () => {
            const { browser, ready } = loadBackground({
                storage: { sync: { enableSidePanel: true } }
            });

            await ready();

            expect(browser._calls.sidePanelBehavior).toContainEqual({ openPanelOnActionClick: true });
            expect(browser._calls.setPopup).toContain("");
        });

        /* An icon that opens neither the panel nor the popup would leave the extension
           with no UI at all, so a browser that refuses the API keeps the popup. */
        it("keeps the popup when the browser refuses to configure the panel", async () => {
            const { browser, ready } = loadBackground({
                sidePanelSetOptionsFails: true,
                storage: { sync: { enableSidePanel: true } }
            });

            await ready();

            expect(browser._calls.setPopup).toContain("popup.html");
        });

        it("keeps the popup when the browser refuses the panel behaviour", async () => {
            const { browser, ready } = loadBackground({
                sidePanelSetBehaviorFails: true,
                storage: { sync: { enableSidePanel: true } }
            });

            await ready();

            expect(browser._calls.setPopup).toContain("popup.html");
        });

        /* Opera is handed the manifest keys but ships neither implementation, and core.js
           is shared with that build, so the option has nothing to act on and the icon has
           to keep the popup. */
        it("does nothing on a browser with neither implementation", async () => {
            const { browser, ready } = loadBackground({
                targetBrowser: "opera",
                storage: { sync: { enableSidePanel: true } }
            });

            await ready();

            expect(browser._calls.setPopup).toContain("popup.html");
            expect(browser._calls.sidePanelOptions).toEqual([]);
            expect(browser._calls.sidebarToggled).toEqual([]);
        });
    });

    describe("opening from the action click", () => {
        it("opens the panel for the clicked tab", async () => {
            const { browser, ready } = loadBackground({
                storage: { sync: { enableSidePanel: true, accessToken: "token" } }
            });
            await ready();

            await browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });

            expect(browser._calls.sidePanelOpened).toContainEqual({ tabId: 7 });
            // Opening the panel replaces opening the website, not doubles up with it.
            expect(browser._calls.tabsCreated).toEqual([]);
        });

        it("falls back to the window when the click carries no tab id", async () => {
            const { browser, ready } = loadBackground({
                storage: { sync: { enableSidePanel: true, accessToken: "token" } }
            });
            await ready();

            await browser._events["action.onClicked"][0]({ windowId: 3 });

            expect(browser._calls.sidePanelOpened).toContainEqual({ windowId: 3 });
        });

        it("leaves the click alone when the option is off", async () => {
            const { browser, ready } = loadBackground({
                storage: { sync: { accessToken: "token" } }
            });
            await ready();

            await browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });

            expect(browser._calls.sidePanelOpened).toEqual([]);
        });
    });
});

/**
 * Firefox has no sidePanel API. The manifest's sidebar_action is the whole registration,
 * so there is nothing to configure at runtime -- only the toolbar icon to wire up, which
 * is where the interesting part is: the click that wakes a suspended event page arrives
 * before storage has answered.
 */
describe("firefox sidebar", () => {
    const firefox = (sync) => ({ targetBrowser: "firefox", storage: { sync } });

    it("registers nothing, because the manifest already did", async () => {
        const { browser, ready } = loadBackground(firefox({ enableSidePanel: true }));

        await ready();

        expect(browser._calls.sidePanelOptions).toEqual([]);
        expect(browser._calls.sidePanelBehavior).toEqual([]);
    });

    it("hands the icon to the sidebar when the option is on", async () => {
        const { browser, ready } = loadBackground(firefox({ enableSidePanel: true }));

        await ready();

        expect(browser._calls.setPopup).toContain("");
    });

    it("leaves the icon on the popup by default", async () => {
        const { browser, ready } = loadBackground(firefox({}));

        await ready();

        expect(browser._calls.setPopup).toContain("popup.html");
    });

    it("toggles rather than opens, so the icon closes it again", async () => {
        const { browser, ready } = loadBackground(firefox({ enableSidePanel: true, accessToken: "token" }));
        await ready();

        await browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });

        expect(browser._calls.sidebarToggled).toHaveLength(1);
        // Toggling replaces opening the website, not doubles up with it.
        expect(browser._calls.tabsCreated).toEqual([]);
    });

    /* sidebarAction.toggle() takes no arguments: it acts on the window that was clicked. */
    it("needs no tab", async () => {
        const { browser, ready } = loadBackground(firefox({ enableSidePanel: true, accessToken: "token" }));
        await ready();

        await browser._events["action.onClicked"][0]({});

        expect(browser._calls.sidebarToggled).toHaveLength(1);
    });

    it("leaves the click alone when the option is off", async () => {
        const { browser, ready } = loadBackground(firefox({ accessToken: "token" }));
        await ready();

        await browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });

        expect(browser._calls.sidebarToggled).toEqual([]);
    });

    /* A refused toggle is the end of it. Opening feedly.com instead is a stranger answer
       to "show me the sidebar" than doing nothing at all. */
    it("swallows a refused toggle rather than opening the website instead", async () => {
        const { browser, ready } = loadBackground({
            ...firefox({ enableSidePanel: true, accessToken: "token" }),
            sidebarToggleFails: true
        });
        await ready();

        await browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(browser._calls.tabsCreated).toEqual([]);
    });

    /*
     * The reason any of this is more than a one-line guard. Firefox suspends the event
     * page after ~30 seconds idle and delivers the waking click before storage has
     * answered, so the decision has to come from localStorage or not at all -- an await
     * here spends the user gesture toggle() requires and the click does nothing whatever.
     *
     * Nothing may be awaited between the second loadBackground and the click: an await is
     * exactly what would let the mock's storage promises resolve and hide the bug.
     */
    describe("after a suspension", () => {
        it("still toggles on the first click", async () => {
            const profile = {
                ...firefox({ enableSidePanel: true, accessToken: "token" }),
                localStorage: createLocalStorageStub()
            };
            await loadBackground(profile).ready();

            // A new event page for the same profile: storage survives, memory does not.
            const woken = loadBackground(profile);
            woken.browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });

            expect(woken.browser._calls.sidebarToggled).toHaveLength(1);
        });

        /* Why the answer is recorded rather than assumed: with no popup the click reaches
           the listener whichever of the two options cleared it. */
        it("leaves the click alone when the icon opens the website", async () => {
            const profile = {
                ...firefox({ openSiteOnIconClick: true, accessToken: "token" }),
                localStorage: createLocalStorageStub()
            };
            await loadBackground(profile).ready();

            const woken = loadBackground(profile);
            woken.browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });

            expect(woken.browser._calls.sidebarToggled).toEqual([]);
        });

        /* The one hole left, pinned so it stays a known cost rather than a surprise:
           before a profile's first initialize there is nothing recorded to read, and the
           gesture is gone by the time the options arrive. It is self-healing -- this very
           wake records the answer for the next one. */
        it("cannot know before its first initialize", async () => {
            const { browser, ready } = loadBackground({
                ...firefox({ enableSidePanel: true, accessToken: "token" }),
                localStorage: createLocalStorageStub()
            });

            browser._events["action.onClicked"][0]({ id: 7, windowId: 3 });
            expect(browser._calls.sidebarToggled).toEqual([]);

            await ready();
            expect(browser._calls.setPopup).toContain("");
        });
    });
});
