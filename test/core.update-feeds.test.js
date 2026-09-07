import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

/** A minimal Feedly item; only the fields updateFeeds sorts and dedups on. */
function entry(id, { crawled = 0, engagementRate = 0, title = id } = {}) {
    return {
        id,
        title,
        crawled,
        engagementRate,
        origin: { htmlUrl: "https://blog.com", streamId: "feed/blog", title: "Blog" },
        alternate: [{ href: `https://blog.com/${id}` }],
        categories: []
    };
}

describe("updateFeeds", () => {
    let ctx;
    let browser;
    let appGlobal;
    let requestedMethods;

    /**
     * Stubs the API so each stream id returns its own set of items.
     * @param {object} streams - map of stream id to item array.
     */
    function stubStreams(streams) {
        requestedMethods = [];
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                requestedMethods.push(method);
                if (method === "subscriptions") {
                    return [];
                }
                const streamId = decodeURIComponent(method.replace(/^streams\//, "").replace(/\/contents$/, ""));
                return { items: streams[streamId] || [] };
            }
        };
    }

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.feedlyUserId = "u1";
    });

    it("caches the parsed feeds from the global stream", async () => {
        stubStreams({ "user/u1/category/global.all": [entry("a"), entry("b")] });

        await ctx.updateFeeds(true);

        expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["a", "b"]);
    });

    it("persists the cache to local storage", async () => {
        stubStreams({ "user/u1/category/global.all": [entry("a")] });

        await ctx.updateFeeds(true);

        const stored = await browser.storage.local.get("cachedFeeds");
        expect(stored.cachedFeeds).toHaveLength(1);
    });

    it("requests one stream per filter when filtering is enabled", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["cat/A", "cat/B"];
        stubStreams({ "cat/A": [entry("a")], "cat/B": [entry("b")] });

        await ctx.updateFeeds(true);

        expect(requestedMethods).toContain("streams/cat%2FA/contents");
        expect(requestedMethods).toContain("streams/cat%2FB/contents");
        expect(appGlobal.cachedFeeds.map(feed => feed.id).sort()).toEqual(["a", "b"]);
    });

    it("falls back to the global stream when filtering is on but no filter is chosen", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = [];
        stubStreams({ "user/u1/category/global.all": [entry("a")] });

        await ctx.updateFeeds(true);

        expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["a"]);
    });

    /*
     * The dedup filter drops an entry when a later copy exists, so the *last*
     * occurrence survives (core.js:815-822). Which stream's copy wins matters,
     * because the metadata can differ between them.
     */
    it("keeps the last copy of an item present in several streams", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["cat/A", "cat/B"];
        appGlobal.options.sortBy = "engagement";
        stubStreams({
            "cat/A": [entry("dupe", { title: "from A" })],
            "cat/B": [entry("dupe", { title: "from B" })]
        });

        await ctx.updateFeeds(true);

        expect(appGlobal.cachedFeeds).toHaveLength(1);
        expect(appGlobal.cachedFeeds[0].title).toBe("from B");
    });

    describe("sorting", () => {
        const older = Date.UTC(2024, 0, 1);
        const newer = Date.UTC(2024, 6, 1);

        it("puts the newest first by default", async () => {
            appGlobal.options.sortBy = "newest";
            stubStreams({
                "user/u1/category/global.all": [
                    entry("old", { crawled: older }),
                    entry("new", { crawled: newer })
                ]
            });

            await ctx.updateFeeds(true);

            expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["new", "old"]);
        });

        it("puts the oldest first when asked", async () => {
            appGlobal.options.sortBy = "oldest";
            stubStreams({
                "user/u1/category/global.all": [
                    entry("new", { crawled: newer }),
                    entry("old", { crawled: older })
                ]
            });

            await ctx.updateFeeds(true);

            expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["old", "new"]);
        });

        it("falls back to engagement rate for any other sort order", async () => {
            appGlobal.options.sortBy = "engagement";
            stubStreams({
                "user/u1/category/global.all": [
                    entry("low", { engagementRate: 0.5 }),
                    entry("high", { engagementRate: 9.5 }),
                    entry("mid", { engagementRate: 3 })
                ]
            });

            await ctx.updateFeeds(true);

            expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["high", "mid", "low"]);
        });
    });

    it("truncates the cache to the configured maximum after sorting", async () => {
        appGlobal.options.maxNumberOfFeeds = 2;
        appGlobal.options.sortBy = "newest";
        stubStreams({
            "user/u1/category/global.all": [
                entry("a", { crawled: 1 }),
                entry("b", { crawled: 3 }),
                entry("c", { crawled: 2 })
            ]
        });

        await ctx.updateFeeds(true);

        expect(appGlobal.cachedFeeds.map(feed => feed.id)).toEqual(["b", "c"]);
    });

    it("restores the previous cache when a stream request fails", async () => {
        appGlobal.cachedFeeds = [{ id: "previously-cached" }];
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                throw { status: 500 };
            }
        };

        await ctx.updateFeeds(true);

        expect(appGlobal.cachedFeeds).toEqual([{ id: "previously-cached" }]);
        expect(await browser.storage.local.get("cachedFeeds")).toEqual({});
    });

    it("shows no notifications during a silent update", async () => {
        appGlobal.options.showDesktopNotifications = true;
        stubStreams({ "user/u1/category/global.all": [entry("a")] });

        await ctx.updateFeeds(true);

        expect(browser._calls.notificationsCreated).toEqual([]);
    });

    it("notifies about new feeds during a normal update", async () => {
        appGlobal.options.showDesktopNotifications = true;
        appGlobal.options.maxNotificationsCount = 5;
        stubStreams({
            "user/u1/category/global.all": [entry("a", { crawled: Date.now() })]
        });

        await ctx.updateFeeds(false);

        expect(browser._calls.notificationsCreated).toHaveLength(1);
    });
});

describe("getFeeds", () => {
    let ctx;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, appGlobal } = loadCore());
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => ({ items: [] })
        };
    });

    it("serves a warm cache without hitting the network", async () => {
        let requests = 0;
        appGlobal.cachedFeeds = [{ id: "cached" }];
        appGlobal.feedlyApiClient.request = async () => {
            requests++;
            return { items: [] };
        };

        const result = await ctx.getFeeds(false);

        expect(result.feeds).toEqual([{ id: "cached" }]);
        expect(requests).toBe(0);
    });

    it("returns a copy so callers cannot mutate the cache", async () => {
        appGlobal.cachedFeeds = [{ id: "cached" }];

        const result = await ctx.getFeeds(false);
        result.feeds.push({ id: "injected" });

        expect(appGlobal.cachedFeeds).toHaveLength(1);
    });

    it("refetches when an update is forced", async () => {
        let requests = 0;
        appGlobal.cachedFeeds = [{ id: "cached" }];
        appGlobal.feedlyApiClient.request = async () => {
            requests++;
            return { items: [] };
        };

        await ctx.getFeeds(true);

        expect(requests).toBeGreaterThan(0);
    });
});

/**
 * A sidebar or side panel stays open for hours, so the worker tells it when the cache
 * moved on (issue #297). Only when the articles actually changed: getFeeds() updates
 * whenever the cache is empty, so an unconditional message would have a panel with
 * nothing unread triggering an update on every round.
 */
describe("feedsUpdated broadcast", () => {
    let ctx;
    let browser;
    let appGlobal;

    /** Every message the worker broadcast, ignoring anything else it sent. */
    function broadcasts() {
        return browser._calls.messagesSent.filter(message => message.type === "feedsUpdated");
    }

    function stubGlobalStream(items) {
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                if (method === "subscriptions") {
                    return [];
                }
                return { items };
            }
        };
    }

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.feedlyUserId = "u1";
    });

    it("announces articles arriving", async () => {
        stubGlobalStream([entry("a")]);

        await ctx.updateFeeds(true);

        expect(broadcasts()).toHaveLength(1);
    });

    it("stays quiet when the same articles come back", async () => {
        stubGlobalStream([entry("a")]);
        await ctx.updateFeeds(true);
        browser._calls.messagesSent.length = 0;

        await ctx.updateFeeds(true);

        expect(broadcasts()).toEqual([]);
    });

    /* The loop this guards against: an empty cache makes getFeeds() update, so a message
       on every update would have the panel asking for another one straight away. */
    it("stays quiet when there was nothing unread and still is not", async () => {
        stubGlobalStream([]);

        await ctx.updateFeeds(true);

        expect(broadcasts()).toEqual([]);
    });

    it("announces the last article being read", async () => {
        stubGlobalStream([entry("a")]);
        await ctx.updateFeeds(true);
        browser._calls.messagesSent.length = 0;
        stubGlobalStream([]);

        await ctx.updateFeeds(true);

        expect(broadcasts()).toHaveLength(1);
    });

    it("stays quiet when the update fails", async () => {
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                throw new Error("network down");
            }
        };

        await ctx.updateFeeds(true);

        expect(broadcasts()).toEqual([]);
    });

    it("announces saved articles changing", async () => {
        stubGlobalStream([entry("saved")]);

        await ctx.updateSavedFeeds();

        expect(broadcasts()).toHaveLength(1);
    });

    it("stays quiet when the saved articles are unchanged", async () => {
        stubGlobalStream([entry("saved")]);
        await ctx.updateSavedFeeds();
        browser._calls.messagesSent.length = 0;

        await ctx.updateSavedFeeds();

        expect(broadcasts()).toEqual([]);
    });
});
