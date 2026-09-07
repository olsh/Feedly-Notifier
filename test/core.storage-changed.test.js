import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

/**
 * Every access token refresh writes the token back to storage. Reacting to that write by
 * reinitialising restarted the scheduler and fired another update -- once per refresh,
 * and a whole update cycle can refresh at once. That feedback loop is the largest of the
 * amplifiers behind issue #368.
 *
 * initialize() always calls setPopup, so setPopup is the signal that it ran.
 */

/** A client that records what was asked for and answers with empty payloads. */
function recordingClient() {
    const calls = [];
    return {
        calls,
        accessToken: "token",
        request: async (method) => {
            calls.push(method);
            return { unreadcounts: [], items: [], id: "u1" };
        }
    };
}

describe("storage change handling", () => {
    let ctx;
    let browser;
    let appGlobal;
    let client;

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore({
            storage: { sync: { accessToken: "token", updateInterval: 10 } }
        }));
        client = recordingClient();
        appGlobal.feedlyApiClient = client;
    });

    async function change(items, changes) {
        await browser.storage.sync.set(items);
        await browser.storage.onChanged.trigger(changes || items);
    }

    function reinitialised() {
        return browser._calls.setPopup.length > 0;
    }

    it("ignores a feed cache write", async () => {
        await browser.storage.onChanged.trigger({ cachedFeeds: { newValue: [] } });

        expect(reinitialised()).toBe(false);
        // readOptions did not run either, so the seeded option is still unread.
        expect(appGlobal.options.accessToken).toBe("");
    });

    it("ignores the rate limit deadline it writes itself", async () => {
        await browser.storage.onChanged.trigger({ rateLimitedUntil: { newValue: 123 } });

        expect(reinitialised()).toBe(false);
    });

    it("re-reads the options for a non critical option without restarting", async () => {
        await ctx.readOptions();

        await change({ theme: "dark" });

        expect(appGlobal.options.theme).toBe("dark");
        expect(reinitialised()).toBe(false);
    });

    it("restarts the schedule when the update interval really changes", async () => {
        await change({ updateInterval: 45 });

        expect(reinitialised()).toBe(true);
        expect(browser._calls.alarmsCreated[0].info).toEqual({ periodInMinutes: 45 });
    });

    /*
     * startSchedule decides whether to create the updateFeeds alarm from both of these,
     * so a change to either has to rebuild it.
     */
    it.each(["showDesktopNotifications", "playSound"])("restarts the schedule when %s changes", async (optionName) => {
        await ctx.readOptions();

        await change({ [optionName]: false });

        expect(reinitialised()).toBe(true);
    });

    it("does not restart when an option is rewritten with the same value", async () => {
        await ctx.readOptions();

        await change({ updateInterval: 10, showCounter: true });

        expect(reinitialised()).toBe(false);
    });

    /* The filters are an array, so identity comparison would report a change every time. */
    it("treats an equal filters array as unchanged", async () => {
        await browser.storage.sync.set({ filters: ["a", "b"] });
        await ctx.readOptions();

        await change({ filters: ["a", "b"] });

        expect(reinitialised()).toBe(false);
    });

    it("adopts a refreshed access token without restarting the schedule", async () => {
        await ctx.readOptions();

        await change({ accessToken: "fresh" });

        expect(reinitialised()).toBe(false);
        expect(browser._calls.alarmsCreated).toEqual([]);
        expect(client.calls).toEqual([]);
        expect(appGlobal.feedlyApiClient.accessToken).toBe("fresh");
    });

    it("starts the schedule when a token first appears", async () => {
        await browser.storage.sync.set({ accessToken: "" });
        await ctx.readOptions();

        await change({ accessToken: "token" });

        expect(reinitialised()).toBe(true);
        expect(browser._calls.alarmsCreated.map(alarm => alarm.name))
            .toEqual(["updateCounter", "updateFeeds"]);
    });

    it("goes quiet when the token is cleared", async () => {
        await ctx.readOptions();

        await change({ accessToken: "" });

        expect(reinitialised()).toBe(true);
        expect(browser._calls.alarmsCreated).toEqual([]);
        expect(client.calls).toEqual([]);
    });

    /*
     * Signing out writes both storage areas one after the other. Deciding from the
     * reported change rather than the resolved options would act on the first write while
     * the area the options are read from still held a live token.
     */
    it("does not restart for a write to the area the options are not read from", async () => {
        await ctx.readOptions();

        await browser.storage.local.set({ accessToken: "" });
        await browser.storage.onChanged.trigger({ accessToken: { oldValue: "token", newValue: "" } });

        expect(reinitialised()).toBe(false);
        expect(appGlobal.options.accessToken).toBe("token");
    });
});
