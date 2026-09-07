import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

describe("setBadgeCounter", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
    });

    it.each([
        [0, ""],
        [1, "1"],
        [42, "42"],
        [999, "999"],
        [1000, "1k+"],
        [1999, "1k+"],
        [12345, "12k+"],
        [999999, "999k+"]
    ])("renders an unread count of %i as %j", (count, expected) => {
        ctx.setBadgeCounter(count);

        expect(browser._calls.setBadgeText).toEqual([expected]);
    });

    it("clears the badge entirely when the counter is switched off", () => {
        appGlobal.options.showCounter = false;

        ctx.setBadgeCounter(1234);

        expect(browser._calls.setBadgeText).toEqual([""]);
    });

    it("greys the icon when there is nothing unread and the option is on", () => {
        appGlobal.options.grayIconColorIfNoUnread = true;

        ctx.setBadgeCounter(0);

        expect(browser._calls.setIcon).toEqual([appGlobal.icons.inactive]);
    });

    it("keeps the default icon when there is something unread", () => {
        appGlobal.options.grayIconColorIfNoUnread = true;

        ctx.setBadgeCounter(3);

        expect(browser._calls.setIcon).toEqual([appGlobal.icons.default]);
    });

    it("keeps the default icon at zero when greying is off", () => {
        ctx.setBadgeCounter(0);

        expect(browser._calls.setIcon).toEqual([appGlobal.icons.default]);
    });
});

describe("makeMarkersRequest", () => {
    let ctx;
    let browser;
    let appGlobal;

    /** Stubs the API client with canned marker counts and subscriptions. */
    function stubApi({ unreadcounts = [], subscriptions = [] }) {
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                if (method === "subscriptions") {
                    return subscriptions;
                }
                return { unreadcounts };
            }
        };
    }

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.feedlyUserId = "u1";
    });

    it("uses the global count when no filters are enabled", async () => {
        stubApi({
            unreadcounts: [
                { id: "user/u1/category/global.all", count: 17 },
                { id: "feed/other", count: 99 }
            ]
        });

        await ctx.makeMarkersRequest();

        expect(browser._calls.setBadgeText).toEqual(["17"]);
    });

    it("shows nothing when the global count is absent", async () => {
        stubApi({ unreadcounts: [{ id: "feed/other", count: 99 }] });

        await ctx.makeMarkersRequest();

        expect(browser._calls.setBadgeText).toEqual([""]);
    });

    it("sums only the selected categories when filters are enabled", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["user/u1/category/Tech", "user/u1/category/News"];
        stubApi({
            unreadcounts: [
                { id: "user/u1/category/Tech", count: 10 },
                { id: "user/u1/category/News", count: 5 },
                { id: "user/u1/category/Ignored", count: 100 }
            ]
        });

        await ctx.makeMarkersRequest();

        expect(browser._calls.setBadgeText).toEqual(["15"]);
    });

    /*
     * A feed belonging to several selected categories is counted once per
     * category, so core.js subtracts the surplus (core.js:599-614).
     */
    it("subtracts a feed counted twice across two selected categories", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["user/u1/category/Tech", "user/u1/category/News"];
        stubApi({
            unreadcounts: [
                { id: "user/u1/category/Tech", count: 10 },
                { id: "user/u1/category/News", count: 5 },
                { id: "feed/dupe", count: 3 }
            ],
            subscriptions: [{
                id: "feed/dupe",
                categories: [
                    { id: "user/u1/category/Tech" },
                    { id: "user/u1/category/News" }
                ]
            }]
        });

        await ctx.makeMarkersRequest();

        // 15 raw, minus the one surplus copy of the 3 unread items.
        expect(browser._calls.setBadgeText).toEqual(["12"]);
    });

    it("subtracts twice for a feed spanning three selected categories", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["cat/A", "cat/B", "cat/C"];
        stubApi({
            unreadcounts: [
                { id: "cat/A", count: 6 },
                { id: "cat/B", count: 6 },
                { id: "cat/C", count: 6 },
                { id: "feed/dupe", count: 6 }
            ],
            subscriptions: [{
                id: "feed/dupe",
                categories: [{ id: "cat/A" }, { id: "cat/B" }, { id: "cat/C" }]
            }]
        });

        await ctx.makeMarkersRequest();

        // 18 raw, minus two surplus copies of 6.
        expect(browser._calls.setBadgeText).toEqual(["6"]);
    });

    it("does not subtract for a feed in only one selected category", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["cat/A"];
        stubApi({
            unreadcounts: [{ id: "cat/A", count: 8 }, { id: "feed/single", count: 8 }],
            subscriptions: [{ id: "feed/single", categories: [{ id: "cat/A" }, { id: "cat/Unselected" }] }]
        });

        await ctx.makeMarkersRequest();

        expect(browser._calls.setBadgeText).toEqual(["8"]);
    });

    /*
     * KNOWN BEHAVIOUR (core.js:589-617): with filters enabled the summing loop
     * sits inside the same try block as, and after, `await
     * getUserSubscriptions()`. A failed subscription lookup therefore skips the
     * sum entirely and the badge clears rather than falling back to the
     * un-deduplicated total.
     */
    it("clears the badge when the subscription lookup fails", async () => {
        appGlobal.options.isFiltersEnabled = true;
        appGlobal.options.filters = ["cat/A"];
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                if (method === "subscriptions") {
                    throw new Error("network down");
                }
                return { unreadcounts: [{ id: "cat/A", count: 4 }] };
            }
        };

        await ctx.makeMarkersRequest();

        expect(browser._calls.setBadgeText).toEqual([""]);
    });
});

describe("updateCounter", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.feedlyUserId = "u1";
        appGlobal.options.accessToken = "token";
    });

    it("requests counts newer than the last reset when that option is on", async () => {
        const requested = [];
        appGlobal.options.resetCounterOnClick = true;
        await browser.storage.local.set({ lastCounterResetTime: 1700000000000 });
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method, settings) => {
                requested.push(settings.parameters);
                return { unreadcounts: [] };
            }
        };

        await ctx.updateCounter();

        expect(requested[0]).toEqual({ newerThan: 1700000000000 });
    });

    it("resets the stored reset time when the option is off", async () => {
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => ({ unreadcounts: [] })
        };

        await ctx.updateCounter();

        expect((await browser.storage.local.get("lastCounterResetTime")).lastCounterResetTime).toBe(0);
    });

    it("clears the badge when the request fails", async () => {
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                throw { status: 500 };
            }
        };

        await ctx.updateCounter();

        expect(browser._calls.setBadgeText).toContain("");
    });
});

describe("resetCounter", () => {
    it("blanks the badge and records the reset time", async () => {
        const { ctx, browser } = loadCore();

        await ctx.resetCounter();

        expect(browser._calls.setBadgeText).toEqual([""]);
        const stored = await browser.storage.local.get("lastCounterResetTime");
        expect(stored.lastCounterResetTime).toBeGreaterThan(0);
    });
});
