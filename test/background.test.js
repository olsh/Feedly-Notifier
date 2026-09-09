import { describe, it, expect, beforeEach } from "vitest";

import { loadBackground } from "./helpers/load-core.js";

/**
 * background.js is the MV3 background entry point: it stitches the core scripts
 * together and exposes them to the popup and options pages through a single
 * runtime.onMessage router. Chromium runs it as a service worker, firefox as an
 * event page -- see the firefox suite at the end of this file.
 */
describe("background message router", () => {
    let browser;
    let appGlobal;
    let onMessage;

    beforeEach(async () => {
        let ready;
        ({ browser, appGlobal, onMessage, ready } = loadBackground({
            storage: { sync: { accessToken: "token", feedlyUserId: "u1" } }
        }));
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => (method === "subscriptions" ? [] : { items: [], unreadcounts: [] })
        };
        // Let the eager boot settle so it cannot overwrite seeded caches.
        await ready();
    });

    it("registers exactly one message listener", () => {
        expect(browser._events["runtime.onMessage"]).toHaveLength(1);
    });

    it("returns the current state", async () => {
        const state = await onMessage({ type: "getState" });

        expect(state).toMatchObject({ isLoggedIn: true });
        expect(state.options).toBeDefined();
        expect(state.environment).toBeDefined();
    });

    it("returns the options on their own", async () => {
        const result = await onMessage({ type: "getOptions" });

        expect(result.options.maxNumberOfFeeds).toBe(20);
    });

    /* appGlobal.options carries updateInterval, popupWidth and expandedPopupWidth as accessor
       properties. runtime.sendMessage clones the payload, and firefox clones through an Xray
       wrapper that shows own data properties only, so handing out appGlobal.options itself
       dropped all three -- the popup got _popupWidth but not popupWidth, and applied no width
       at all. Both routes have to hand over resolved values. */
    it.each(["getState", "getOptions"])("resolves the computed options for %s", async (type) => {
        const { options } = await onMessage({ type });

        for (const name of ["updateInterval", "popupWidth", "expandedPopupWidth"]) {
            const descriptor = Object.getOwnPropertyDescriptor(options, name);

            expect(descriptor).toBeDefined();
            expect(descriptor.get).toBeUndefined();
            expect(typeof descriptor.value).toBe("number");
        }
    });

    it("clamps the popup widths it hands out", async () => {
        appGlobal.options.popupWidth = 100;
        appGlobal.options.expandedPopupWidth = 5000;

        const { options } = await onMessage({ type: "getState" });

        expect(options.popupWidth).toBe(380);
        expect(options.expandedPopupWidth).toBe(800);
    });

    it("rejects an unknown message type", async () => {
        await expect(onMessage({ type: "nonsense" })).resolves.toEqual({
            error: "Unknown message type"
        });
    });

    it("rejects a message with no type at all", async () => {
        await expect(onMessage({})).resolves.toEqual({ error: "Unknown message type" });
        await expect(onMessage(null)).resolves.toEqual({ error: "Unknown message type" });
    });

    it("serves cached feeds", async () => {
        appGlobal.cachedFeeds = [{ id: "a" }];

        const result = await onMessage({ type: "getFeeds" });

        expect(result.feeds).toEqual([{ id: "a" }]);
        expect(result.isLoggedIn).toBe(true);
    });

    it("serves cached saved feeds", async () => {
        appGlobal.cachedSavedFeeds = [{ id: "saved" }];

        const result = await onMessage({ type: "getSavedFeeds" });

        expect(result.feeds).toEqual([{ id: "saved" }]);
    });

    it("maps a successful mark-as-read to an ok result", async () => {
        appGlobal.cachedFeeds = [{ id: "a" }];

        await expect(onMessage({ type: "markAsRead", feedIds: ["a"] }))
            .resolves.toEqual({ ok: true });
    });

    it("defaults a mark-as-read with no ids to an empty list", async () => {
        await expect(onMessage({ type: "markAsRead" })).resolves.toEqual({ ok: true });
    });

    it("reports a failed mark-as-read", async () => {
        appGlobal.feedlyApiClient.request = async () => {
            throw { status: 500 };
        };

        await expect(onMessage({ type: "markAsRead", feedIds: ["a"] }))
            .resolves.toEqual({ ok: false });
    });

    it("toggles a saved feed", async () => {
        await expect(onMessage({ type: "toggleSavedFeed", feedIds: ["a"], save: true }))
            .resolves.toEqual({ ok: true });
    });

    it("round-trips the feed tab id", async () => {
        await onMessage({ type: "setFeedTabId", tabId: 99 });

        await expect(onMessage({ type: "getFeedTabId" })).resolves.toEqual({ feedTabId: 99 });
        expect(appGlobal.feedTabId).toBe(99);
    });

    it("reports no feed tab when none was set", async () => {
        await expect(onMessage({ type: "getFeedTabId" })).resolves.toEqual({ feedTabId: null });
    });

    it("persists the feed tab id to session storage", async () => {
        await onMessage({ type: "setFeedTabId", tabId: 7 });

        expect(await browser.storage.session.get("_feedTabId")).toEqual({ _feedTabId: 7 });
    });

    it("opens the feedly tab", async () => {
        await expect(onMessage({ type: "openFeedlyTab" })).resolves.toEqual({ ok: true });

        expect(browser._calls.tabsCreated).toHaveLength(1);
    });

    it("resets the counter", async () => {
        await expect(onMessage({ type: "resetCounter" })).resolves.toEqual({ ok: true });
    });

    it("turns an unexpected failure into a generic error", async () => {
        // getFeeds with a broken cache throws inside the router.
        appGlobal.cachedFeeds = null;

        await expect(onMessage({ type: "getFeeds" })).resolves.toEqual({ error: "Internal error" });
    });
});

describe("service worker startup", () => {
    it("restores the feed tab id from session storage after a restart", async () => {
        const { appGlobal, ready } = loadBackground({
            storage: { session: { _feedTabId: 42 } }
        });

        await ready();

        expect(appGlobal.feedTabId).toBe(42);
    });

    it("initialises only once no matter how many messages arrive", async () => {
        let platformInfoCalls = 0;
        const { browser, onMessage, ready } = loadBackground({
            storage: { sync: { accessToken: "token" } }
        });
        browser.runtime.getPlatformInfo = async () => {
            platformInfoCalls++;
            return { os: "win" };
        };
        await ready();
        const afterBoot = platformInfoCalls;

        await Promise.all([
            onMessage({ type: "getOptions" }),
            onMessage({ type: "getOptions" }),
            onMessage({ type: "getOptions" })
        ]);

        // ensureInitialized memoises, so no message re-runs initialisation.
        expect(platformInfoCalls).toBe(afterBoot);
    });

    it("sets the popup page during initialisation", async () => {
        const { browser, ready } = loadBackground();

        await ready();

        expect(browser._calls.setPopup).toContain("popup.html");
    });

    it("clears the popup when opening the site on click", async () => {
        const { browser, ready } = loadBackground({
            storage: { sync: { openSiteOnIconClick: true } }
        });

        await ready();

        expect(browser._calls.setPopup).toContain("");
    });
});

/*
 * Firefox's MV3 background is an event page, not a service worker: there is no
 * importScripts, so manifest.json lists the same files as classic scripts loaded
 * ahead of background.js, and loadBackground follows that list. The router itself
 * is browser-agnostic, so this only has to prove the page boots at all -- if the
 * list or its order were wrong, readOptions would not be defined by the time
 * background.js reaches it and nothing below would run.
 */
describe("firefox event page", () => {
    it("boots from the manifest's background.scripts", async () => {
        const { browser, appGlobal, onMessage, ready } = loadBackground({
            targetBrowser: "firefox",
            storage: { sync: { accessToken: "token", feedlyUserId: "u1" } }
        });
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => (method === "subscriptions" ? [] : { items: [], unreadcounts: [] })
        };
        await ready();

        expect(browser._events["runtime.onMessage"]).toHaveLength(1);
        await expect(onMessage({ type: "getState" })).resolves.toMatchObject({ isLoggedIn: true });
    });

    /* No sidePanel API, but a sidebar the toolbar icon can toggle, so the popup gives way
       to it exactly as it does on chromium. The behaviour itself belongs to
       test/core.side-panel.test.js; this only proves the event page reaches it. */
    it("gives the icon to the sidebar instead of the popup", async () => {
        const { browser, ready } = loadBackground({
            targetBrowser: "firefox",
            storage: { sync: { enableSidePanel: true } }
        });

        await ready();

        expect(browser._calls.setPopup).toContain("");
        expect(browser._calls.sidePanelOptions).toEqual([]);
    });
});
