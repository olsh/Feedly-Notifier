import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

/**
 * The feedly website posts to /v3/markers once per article, and it marks them as the
 * user scrolls, so a page of reading used to cost a full update per article. These
 * tests pin the throttle and the own-request filter that issue #368 needed.
 *
 * updateCounter and updateFeeds are replaced on the context rather than stubbed at the
 * api client: they are top level function declarations, so they live on the vm global
 * and the listener resolves them there at call time.
 */

const EXTENSION_ORIGIN = "chrome-extension://feedly-notifier-test/";
const WINDOW_MS = 20000;

function websiteEvent(overrides) {
    return Object.assign({
        method: "POST",
        url: "https://cloud.feedly.com/v3/markers",
        tabId: 7,
        initiator: "https://feedly.com"
    }, overrides);
}

describe("feedly website listener", () => {
    let ctx;
    let browser;
    let appGlobal;
    let updates;

    beforeEach(() => {
        // The sandbox captures setTimeout when the context is built, so the fake timers
        // have to be installed before loadCore.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));

        ({ ctx, browser, appGlobal } = loadCore({ storage: { sync: { accessToken: "token" } } }));

        updates = [];
        ctx.updateCounter = () => updates.push("counter");
        ctx.updateFeeds = () => updates.push("feeds");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function fire(details) {
        await browser.webRequest.onCompleted.trigger(websiteEvent(details));
        // ensureOptionsLoaded awaits storage before the updates run.
        await vi.advanceTimersByTimeAsync(0);
    }

    it("updates immediately for the first website request", async () => {
        await fire();

        expect(updates).toEqual(["counter", "feeds"]);
    });

    it("collapses a burst into one leading and one trailing update", async () => {
        for (let i = 0; i < 10; i++) {
            await fire();
        }

        expect(updates).toEqual(["counter", "feeds"]);

        await vi.advanceTimersByTimeAsync(WINDOW_MS);

        expect(updates).toEqual(["counter", "feeds", "counter", "feeds"]);
    });

    it("opens a new window once the current one has elapsed", async () => {
        await fire();

        // A lone event has nothing to coalesce, so no trailing update is armed.
        await vi.advanceTimersByTimeAsync(WINDOW_MS);
        expect(updates).toHaveLength(2);

        await fire();

        expect(updates).toHaveLength(4);
    });

    it("ignores the extension's own request reported by initiator", async () => {
        await fire({ initiator: EXTENSION_ORIGIN.replace(/\/$/, ""), tabId: -1 });

        expect(updates).toEqual([]);
    });

    it("ignores the extension's own request reported by originUrl", async () => {
        await fire({ initiator: undefined, originUrl: EXTENSION_ORIGIN + "scripts/background.js", tabId: -1 });

        expect(updates).toEqual([]);
    });

    /*
     * The feedly website is a progressive web app, so its own service worker posts
     * without a tab. Filtering on tabId would have silently disabled the listener for
     * exactly the users who reported the bug.
     */
    it("still updates for a website request made without a tab", async () => {
        await fire({ tabId: -1 });

        expect(updates).toEqual(["counter", "feeds"]);
    });

    it("ignores requests that do not change anything", async () => {
        await fire({ method: "GET" });

        expect(updates).toEqual([]);
    });

    it("keeps the subscriptions cache when entries are marked as read", async () => {
        appGlobal.getUserSubscriptionsPromise = Promise.resolve([]);

        await fire();

        expect(appGlobal.getUserSubscriptionsPromise).not.toBeNull();
    });

    it("drops the subscriptions cache when the subscriptions change", async () => {
        appGlobal.getUserSubscriptionsPromise = Promise.resolve([]);

        await fire({ url: "https://cloud.feedly.com/v3/subscriptions" });

        expect(appGlobal.getUserSubscriptionsPromise).toBeNull();
    });
});

describe("saved feeds listener", () => {
    let ctx;
    let browser;
    let saved;

    beforeEach(() => {
        ({ ctx, browser } = loadCore({ storage: { sync: { accessToken: "token" } } }));
        saved = 0;
        // The real one is async, and the listener attaches a catch to what it returns.
        ctx.updateSavedFeeds = async () => { saved++; };
        ctx.updateCounter = () => {};
        ctx.updateFeeds = () => {};
    });

    it("updates when the website saves a feed", async () => {
        await browser.webRequest.onCompleted.trigger(websiteEvent({
            method: "PUT",
            url: "https://cloud.feedly.com/v3/tags/user%2F1%2Ftag%2Fglobal.saved"
        }));

        expect(saved).toBe(1);
    });

    it("ignores the extension's own save", async () => {
        await browser.webRequest.onCompleted.trigger(websiteEvent({
            method: "PUT",
            url: "https://cloud.feedly.com/v3/tags/user%2F1%2Ftag%2Fglobal.saved",
            initiator: EXTENSION_ORIGIN.replace(/\/$/, ""),
            tabId: -1
        }));

        expect(saved).toBe(0);
    });
});
