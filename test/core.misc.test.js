import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

describe("filterByNewFeeds", () => {
    let ctx;
    let browser;

    beforeEach(() => {
        ({ ctx, browser } = loadCore());
    });

    const feed = (id, date) => ({ id, date: new Date(date) });

    it("returns everything when nothing has been seen yet", async () => {
        const feeds = [feed("a", "2024-01-01"), feed("b", "2024-02-01")];

        await expect(ctx.filterByNewFeeds(feeds)).resolves.toHaveLength(2);
    });

    it("returns only feeds newer than the last seen time", async () => {
        await browser.storage.local.set({ lastFeedTimeTicks: new Date("2024-01-15").getTime() });
        const feeds = [feed("old", "2024-01-01"), feed("new", "2024-02-01")];

        const result = await ctx.filterByNewFeeds(feeds);

        expect(result.map(item => item.id)).toEqual(["new"]);
    });

    it("treats a feed exactly at the boundary as already seen", async () => {
        const boundary = new Date("2024-01-15").getTime();
        await browser.storage.local.set({ lastFeedTimeTicks: boundary });

        await expect(ctx.filterByNewFeeds([feed("edge", boundary)])).resolves.toEqual([]);
    });

    it("advances the stored marker to the newest feed seen", async () => {
        const newest = new Date("2024-03-01").getTime();
        await ctx.filterByNewFeeds([feed("a", "2024-01-01"), feed("b", newest)]);

        const stored = await browser.storage.local.get("lastFeedTimeTicks");
        expect(stored.lastFeedTimeTicks).toBe(newest);
    });

    it("leaves the marker alone when nothing is new", async () => {
        const marker = new Date("2024-06-01").getTime();
        await browser.storage.local.set({ lastFeedTimeTicks: marker });

        await ctx.filterByNewFeeds([feed("old", "2024-01-01")]);

        expect((await browser.storage.local.get("lastFeedTimeTicks")).lastFeedTimeTicks).toBe(marker);
    });

    /*
     * KNOWN BUG: parseFeeds emits `date` as a Date, but updateFeeds writes the
     * cache straight into storage where it is JSON-serialised to a string. After
     * a service-worker restart the comparison at core.js:648 is string vs Date,
     * which is always false, so notifications go silent until the next fetch.
     */
    it("treats feeds whose date came back from storage as a string as not new", async () => {
        await browser.storage.local.set({ lastFeedTimeTicks: new Date("2020-01-01").getTime() });
        const revived = [{ id: "revived", date: new Date("2024-01-01").toISOString() }];

        await expect(ctx.filterByNewFeeds(revived)).resolves.toEqual([]);
    });
});

describe("removeFeedFromCache", () => {
    it("removes the matching feed from both caches", () => {
        const { ctx, appGlobal } = loadCore();
        appGlobal.cachedFeeds = [{ id: "a" }, { id: "b" }];

        ctx.removeFeedFromCache("a");

        expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["b"]);
    });

    it("leaves the cache untouched for an unknown id", () => {
        const { ctx, appGlobal } = loadCore();
        appGlobal.cachedFeeds = [{ id: "a" }];

        ctx.removeFeedFromCache("missing");

        expect(appGlobal.cachedFeeds).toHaveLength(1);
    });
});

describe("getUserSubscriptions", () => {
    let ctx;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, appGlobal } = loadCore());
        appGlobal.options.accessToken = "token";
    });

    it("requests the subscriptions only once and reuses the promise", async () => {
        let requests = 0;
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                requests++;
                return [{ id: "feed/a" }];
            }
        };

        await Promise.all([ctx.getUserSubscriptions(), ctx.getUserSubscriptions()]);
        await ctx.getUserSubscriptions();

        expect(requests).toBe(1);
    });

    it("refetches when the cache is explicitly invalidated", async () => {
        let requests = 0;
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                requests++;
                return [];
            }
        };

        await ctx.getUserSubscriptions();
        await ctx.getUserSubscriptions(true);

        expect(requests).toBe(2);
    });

    it("clears the memoised promise after a failure so the next call retries", async () => {
        let requests = 0;
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                requests++;
                if (requests === 1) {
                    throw { status: 500 };
                }
                return [{ id: "feed/a" }];
            }
        };

        await expect(ctx.getUserSubscriptions()).rejects.toHaveProperty("status", 500);
        await expect(ctx.getUserSubscriptions()).resolves.toEqual([{ id: "feed/a" }]);
        expect(requests).toBe(2);
    });
});

describe("markAsRead", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.accessToken = "token";
        appGlobal.cachedFeeds = [{ id: "a" }, { id: "b" }, { id: "c" }];
    });

    it("posts the ids and drops them from the cache", async () => {
        const calls = [];
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method, settings) => {
                calls.push({ method, settings });
                return {};
            }
        };

        await expect(ctx.markAsRead(["a", "b"])).resolves.toBe(true);

        expect(calls[0].method).toBe("markers");
        expect(calls[0].settings.method).toBe("POST");
        expect(calls[0].settings.body).toEqual({
            action: "markAsRead",
            type: "entries",
            entryIds: ["a", "b"]
        });
        expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["c"]);
    });

    it("decrements the badge by the number marked", async () => {
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };
        ctx.setBadgeCounter(10);

        await ctx.markAsRead(["a", "b"]);

        expect(browser._calls.setBadgeText.at(-1)).toBe("8");
    });

    /*
     * KNOWN BUG (core.js:1107): the badge text is read back and coerced with `+`.
     * Above 999 it reads "1k+", which coerces to NaN, so the decrement is
     * silently skipped and the badge keeps its stale value.
     */
    it("fails to decrement an abbreviated badge above 999", async () => {
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };
        ctx.setBadgeCounter(1500);

        await ctx.markAsRead(["a"]);

        expect(browser._calls.setBadgeText.at(-1)).toBe("1k+");
    });

    /*
     * Issue #102: after a counter reset the badge is blank, so there is no number to
     * decrement -- but reading the last unread article still has to gray the icon.
     */
    it("greys the icon when the last unread article is read after a reset", async () => {
        appGlobal.options.grayIconColorIfNoUnread = true;
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };
        // The badge is blank after a reset while one article is still unread.
        ctx.setBadgeCounter(0, 1);
        const iconCallsBefore = browser._calls.setIcon.length;

        await ctx.markAsRead(["a"]);

        expect(browser._calls.setIcon.slice(iconCallsBefore)).toEqual([appGlobal.icons.inactive]);
    });

    it("keeps the icon active while unread articles remain after a reset", async () => {
        appGlobal.options.grayIconColorIfNoUnread = true;
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };
        ctx.setBadgeCounter(0, 5);

        await ctx.markAsRead(["a"]);

        expect(browser._calls.setIcon.at(-1)).toEqual(appGlobal.icons.default);
        expect(appGlobal.lastKnownUnreadCount).toBe(4);
    });

    it("never drives the remembered total below zero", async () => {
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };
        ctx.setBadgeCounter(0, 1);

        await ctx.markAsRead(["a", "b", "c"]);

        expect(appGlobal.lastKnownUnreadCount).toBe(0);
    });

    /* A worker that has never counted must not grey the icon on the guess that zero
       articles are left. */
    it("leaves the icon alone when no total has been counted yet", async () => {
        appGlobal.options.grayIconColorIfNoUnread = true;
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };

        await ctx.markAsRead(["a"]);

        expect(browser._calls.setIcon).toEqual([]);
    });

    it("reports failure and keeps the cache when the request fails", async () => {
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                throw { status: 500 };
            }
        };

        await expect(ctx.markAsRead(["a"])).resolves.toBe(false);
        expect(appGlobal.cachedFeeds).toHaveLength(3);
    });
});

describe("toggleSavedFeed", () => {
    let ctx;
    let appGlobal;
    let calls;

    beforeEach(() => {
        ({ ctx, appGlobal } = loadCore());
        appGlobal.options.accessToken = "token";
        appGlobal.options.feedlyUserId = "u1";
        appGlobal.cachedFeeds = [{ id: "a", isSaved: false }];
        calls = [];
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method, settings) => {
                calls.push({ method, settings });
                return {};
            }
        };
    });

    it("puts the entry into the saved tag and flags the cache", async () => {
        await expect(ctx.toggleSavedFeed(["a"], true)).resolves.toBe(true);

        expect(calls[0].method).toBe("tags/user%2Fu1%2Ftag%2Fglobal.saved");
        expect(calls[0].settings.method).toBe("PUT");
        expect(appGlobal.cachedFeeds[0].isSaved).toBe(true);
    });

    it("deletes the entry from the saved tag when unsaving", async () => {
        appGlobal.cachedFeeds = [{ id: "a", isSaved: true }];

        await ctx.toggleSavedFeed(["a"], false);

        expect(calls[0].method).toBe("tags/user%2Fu1%2Ftag%2Fglobal.saved/a");
        expect(calls[0].settings.method).toBe("DELETE");
        expect(appGlobal.cachedFeeds[0].isSaved).toBe(false);
    });

    it("reports failure and leaves the cache alone when the request fails", async () => {
        appGlobal.feedlyApiClient.request = async () => {
            throw { status: 500 };
        };

        await expect(ctx.toggleSavedFeed(["a"], true)).resolves.toBe(false);
        expect(appGlobal.cachedFeeds[0].isSaved).toBe(false);
    });
});

describe("scheduling", () => {
    it("creates both alarms and clears them again", () => {
        const { ctx, browser, appGlobal } = loadCore();
        appGlobal.options.accessToken = "token";

        ctx.startSchedule(15, true);

        expect(browser._calls.alarmsCreated.map(alarm => alarm.name))
            .toEqual(["updateCounter", "updateFeeds"]);
        expect(browser._calls.alarmsCreated[0].info).toEqual({ periodInMinutes: 15 });

        ctx.stopSchedule();

        expect(browser._calls.alarmsCleared.slice(-2)).toEqual(["updateCounter", "updateFeeds"]);
        expect(appGlobal.options.showCounter).toBe(true);
    });

    it("skips the counter alarm when the badge is disabled", () => {
        const { ctx, browser, appGlobal } = loadCore();
        appGlobal.options.accessToken = "token";
        appGlobal.options.showCounter = false;

        ctx.startSchedule(10, true);

        expect(browser._calls.alarmsCreated.map(alarm => alarm.name)).toEqual(["updateFeeds"]);
    });

    /*
     * Signed out, every scheduled request would fail, and each failure wakes the worker
     * again. That idle churn is part of what exhausted the api quota in issue #368.
     */
    it("arms no alarms without an access token", () => {
        const { ctx, browser } = loadCore();

        ctx.startSchedule(10, true);

        expect(browser._calls.alarmsCreated).toEqual([]);
        expect(browser._calls.alarmsCleared).toEqual(["updateCounter", "updateFeeds"]);
    });

    // A worker waking for an alarm must not recreate the alarms it woke for.
    it("leaves existing alarms alone when told not to recreate them", () => {
        const { ctx, browser } = loadCore();

        ctx.startSchedule(10, false);

        expect(browser._calls.alarmsCreated).toEqual([]);
        expect(browser._calls.alarmsCleared).toEqual([]);
    });
});

describe("login status", () => {
    it("clears the cache and stops the schedule when going inactive", () => {
        const { ctx, browser, appGlobal } = loadCore();
        appGlobal.cachedFeeds = [{ id: "a" }];
        appGlobal.isLoggedIn = true;

        ctx.setInactiveStatus();

        expect(appGlobal.cachedFeeds).toEqual([]);
        expect(appGlobal.isLoggedIn).toBe(false);
        expect(browser._calls.setBadgeText).toEqual([""]);
        expect(browser._calls.alarmsCleared).toEqual(["updateCounter", "updateFeeds"]);
    });
});
