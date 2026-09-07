import { describe, it, expect } from "vitest";

import { loadBackground } from "./helpers/load-core.js";

/**
 * The side panel is what Microsoft Edge lists in its sidebar (issue #297), so the
 * extension has to register it whether or not the user wants the toolbar icon to open
 * it. `enabled: false` is how an extension removes itself from the browser's sidebar
 * UI -- it is not a way to say "configured but unused".
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

        /* Firefox has sidebar_action instead, and core.js is shared with that build. */
        it("does nothing on a browser with no side panel API", async () => {
            const { browser, ready } = loadBackground({
                sidePanel: false,
                storage: { sync: { enableSidePanel: true } }
            });

            await ready();

            expect(browser._calls.setPopup).toContain("popup.html");
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
