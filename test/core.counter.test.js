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

    /*
     * Issue #102: with resetCounterOnClick the badge counts only what arrived since the
     * last reset, so it cannot say whether anything is unread. The icon follows the total
     * that is passed alongside it.
     */
    it("colours the icon from the total rather than from the badge number", () => {
        appGlobal.options.grayIconColorIfNoUnread = true;

        ctx.setBadgeCounter(0, 12);

        expect(browser._calls.setBadgeText).toEqual([""]);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.default]);
        expect(appGlobal.lastKnownUnreadCount).toBe(12);
    });

    it("greys the icon once the total reaches zero, whatever the badge says", () => {
        appGlobal.options.grayIconColorIfNoUnread = true;

        ctx.setBadgeCounter(3, 0);

        expect(browser._calls.setBadgeText).toEqual(["3"]);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.inactive]);
    });

    /* Greying on a total nobody has counted is the bug, so an unknown one leaves the icon
       showing whatever it was last told. */
    it("leaves the icon alone when nothing at all is known", () => {
        appGlobal.options.grayIconColorIfNoUnread = true;

        ctx.setBadgeCounter(0, null);

        expect(browser._calls.setBadgeText).toEqual([""]);
        expect(browser._calls.setIcon).toEqual([]);
    });

    /* A badge number is a lower bound on the total: it cannot say how much is unread, but
       it does prove that something is. */
    it("keeps the icon active on the badge number alone when the total is unknown", () => {
        appGlobal.options.grayIconColorIfNoUnread = true;

        ctx.setBadgeCounter(5, null);

        expect(browser._calls.setBadgeText).toEqual(["5"]);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.default]);
    });

    /* markAsRead decrements the remembered total as an exact count, so a lower bound must
       never be remembered as one. */
    it("remembers nothing when the total is unknown", () => {
        ctx.setBadgeCounter(5, null);

        expect(appGlobal.lastKnownUnreadCount).toBeNull();
    });

    /* The worker is recycled between the cycle that counts and the click that acts on the
       count, so it cannot live in memory alone. */
    it("persists the total it was given", async () => {
        ctx.setBadgeCounter(3, 40);

        expect(appGlobal.lastKnownUnreadCount).toBe(40);
        const stored = await browser.storage.local.get("lastKnownUnreadCount");
        expect(stored.lastKnownUnreadCount).toBe(40);
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
     * category, so core.js subtracts the surplus (core.js:745-760).
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
     * KNOWN BEHAVIOUR (core.js:735-763): with filters enabled the summing loop
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

    const RESET_TIME = 1700000000000;

    /*
     * Answers markers/counts with `total`, or with `newer` when the request carries
     * newerThan, and records the parameters of every call so the request economy is
     * assertable.
     */
    function stubCounts({ total, newer, failTotal }) {
        const requested = [];
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method, settings) => {
                const parameters = settings?.parameters;
                requested.push(parameters);
                if (!parameters?.newerThan) {
                    if (failTotal) {
                        throw { status: 500 };
                    }
                    return { unreadcounts: [{ id: "user/u1/category/global.all", count: total }] };
                }
                return { unreadcounts: [{ id: "user/u1/category/global.all", count: newer }] };
            }
        };
        return requested;
    }

    /** The configuration issue #102 is about: both options on, with a reset recorded. */
    async function enableResetAndGreying() {
        appGlobal.options.resetCounterOnClick = true;
        appGlobal.options.grayIconColorIfNoUnread = true;
        await browser.storage.local.set({ lastCounterResetTime: RESET_TIME });
    }

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

    /*
     * Issue #102: the reset empties the badge, not the account. A second markers/counts
     * request without newerThan is what tells the icon that articles are still unread.
     */
    it("keeps the icon active when nothing is new but articles remain unread", async () => {
        await enableResetAndGreying();
        const requested = stubCounts({ total: 12, newer: 0 });

        await ctx.updateCounter();

        expect(requested).toEqual([{ newerThan: RESET_TIME }, undefined]);
        expect(browser._calls.setBadgeText.at(-1)).toBe("");
        expect(browser._calls.setIcon.at(-1)).toEqual(appGlobal.icons.default);
        expect(appGlobal.lastKnownUnreadCount).toBe(12);
    });

    it("greys the icon when the account really has nothing unread", async () => {
        await enableResetAndGreying();
        stubCounts({ total: 0, newer: 0 });

        await ctx.updateCounter();

        expect(browser._calls.setIcon.at(-1)).toEqual(appGlobal.icons.inactive);
    });

    /* Anything new is already proof that something is unread, so the total is not worth
       a request. */
    it("spends no second request while something new has arrived", async () => {
        await enableResetAndGreying();
        const requested = stubCounts({ total: 12, newer: 4 });

        await ctx.updateCounter();

        expect(requested).toEqual([{ newerThan: RESET_TIME }]);
        expect(browser._calls.setBadgeText.at(-1)).toBe("4");
        expect(browser._calls.setIcon.at(-1)).toEqual(appGlobal.icons.default);
    });

    /*
     * A narrowed count is a lower bound, not a total. Remembering it as one would have
     * markAsRead decrement it to zero and grey the icon over the articles that were
     * already unread before the reset -- issue #102 again, by a different route.
     */
    it("does not remember a narrowed count as the total", async () => {
        await enableResetAndGreying();
        stubCounts({ total: 42, newer: 3 });

        await ctx.updateCounter();

        expect(browser._calls.setBadgeText.at(-1)).toBe("3");
        expect(appGlobal.lastKnownUnreadCount).toBeNull();
    });

    it("keeps the icon active when only the newly arrived articles are read", async () => {
        await enableResetAndGreying();
        // 42 unread overall, 3 of which arrived since the reset.
        stubCounts({ total: 42, newer: 3 });
        await ctx.updateCounter();

        appGlobal.cachedFeeds = [{ id: "a" }, { id: "b" }, { id: "c" }];
        appGlobal.feedlyApiClient = { accessToken: "token", request: async () => ({}) };
        await ctx.markAsRead(["a", "b", "c"]);

        expect(browser._calls.setBadgeText.at(-1)).toBe("");
        expect(browser._calls.setIcon).not.toContain(appGlobal.icons.inactive);
    });

    it("spends no second request when the icon never greys", async () => {
        appGlobal.options.resetCounterOnClick = true;
        await browser.storage.local.set({ lastCounterResetTime: RESET_TIME });
        const requested = stubCounts({ total: 12, newer: 0 });

        await ctx.updateCounter();

        expect(requested).toEqual([{ newerThan: RESET_TIME }]);
        expect(browser._calls.setIcon.at(-1)).toEqual(appGlobal.icons.default);
    });

    /* The badge has just been counted correctly, so a failed total must not reach
       updateCounter's catch and throw it away, nor grey the icon over articles that are
       probably still unread. The previous total goes back to unknown rather than being
       kept: it is a cycle old, and markAsRead would decrement it as though it were not. */
    it("leaves the icon alone when the total request fails", async () => {
        await enableResetAndGreying();
        ctx.setBadgeCounter(9);
        const iconCallsBefore = browser._calls.setIcon.length;
        stubCounts({ newer: 0, failTotal: true });

        await ctx.updateCounter();

        expect(browser._calls.setBadgeText.at(-1)).toBe("");
        expect(browser._calls.setIcon.length).toBe(iconCallsBefore);
        expect(appGlobal.lastKnownUnreadCount).toBeNull();
    });

    /* A 429 on the second request still has to record the cooldown, and still must not
       reach updateCounter's catch. */
    it("records the cooldown when the total request is rate limited", async () => {
        await enableResetAndGreying();
        ctx.setBadgeCounter(9);
        const iconCallsBefore = browser._calls.setIcon.length;
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method, settings) => {
                if (settings?.parameters?.newerThan) {
                    return { unreadcounts: [{ id: "user/u1/category/global.all", count: 0 }] };
                }
                throw {
                    status: 429,
                    headers: { get: (name) => (name === "Retry-After" ? "600" : null) }
                };
            }
        };

        await ctx.updateCounter();

        expect(appGlobal.rateLimitedUntil).toBeGreaterThan(Date.now());
        expect(browser._calls.setIcon.length).toBe(iconCallsBefore);
    });
});

describe("lastKnownUnreadCount", () => {
    /* The icon's count has to survive the worker being recycled, the same way the rate
       limit cooldown does. */
    it("comes back from storage when the worker wakes", async () => {
        const { ctx, appGlobal } = loadCore({
            storage: {
                sync: { accessToken: "token" },
                local: { lastKnownUnreadCount: 12 }
            }
        });

        await ctx.readOptions();

        expect(appGlobal.lastKnownUnreadCount).toBe(12);
    });

    it("stays unknown when nothing has been counted yet", async () => {
        const { ctx, appGlobal } = loadCore({ storage: { sync: { accessToken: "token" } } });

        await ctx.readOptions();

        expect(appGlobal.lastKnownUnreadCount).toBeNull();
    });

    it("is zeroed on sign out", () => {
        const { ctx, appGlobal } = loadCore();
        ctx.setBadgeCounter(12);

        ctx.setInactiveStatus();

        expect(appGlobal.lastKnownUnreadCount).toBe(0);
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

    /*
     * Issue #102: the reset is what the popup sends while showing a list of unread
     * articles, so greying the icon there is wrong by construction. It also runs on the
     * click that woke the worker, where no total has been counted yet -- so it must not
     * touch the icon at all.
     */
    it("does not touch the icon", async () => {
        const { ctx, browser, appGlobal } = loadCore();
        appGlobal.options.grayIconColorIfNoUnread = true;

        await ctx.resetCounter();

        expect(browser._calls.setBadgeText).toEqual([""]);
        expect(browser._calls.setIcon).toEqual([]);
    });
});
