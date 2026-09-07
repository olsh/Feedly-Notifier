import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

/**
 * Feedly answers 429 (HAP429) once the account has spent its api quota, and the quota is
 * per account, so the feedly website starts failing too -- which is what issue #368
 * reported. Polling through the ban only prolongs it.
 */

const NOW = new Date("2026-09-07T12:00:00Z").getTime();
const MINUTE = 60 * 1000;

/** A client that rejects with a 429 carrying the given headers. */
function rateLimitedClient(headers) {
    const calls = [];
    return {
        calls,
        accessToken: "token",
        request: async (method) => {
            calls.push(method);
            throw {
                status: 429,
                headers: {
                    get: (name) => (headers && headers[name] !== undefined ? headers[name] : null)
                }
            };
        }
    };
}

describe("rate limit cooldown", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.accessToken = "token";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function trip(headers) {
        appGlobal.feedlyApiClient = rateLimitedClient(headers);
        await expect(ctx.apiRequestWrapper("markers/counts")).rejects.toHaveProperty("status", 429);
        return appGlobal.feedlyApiClient;
    }

    it("takes the cooldown from X-RateLimit-Reset", async () => {
        await trip({ "X-RateLimit-Reset": "1800" });

        expect(appGlobal.rateLimitedUntil).toBe(NOW + 30 * MINUTE);
    });

    it("falls back to Retry-After in seconds", async () => {
        await trip({ "Retry-After": "600" });

        expect(appGlobal.rateLimitedUntil).toBe(NOW + 10 * MINUTE);
    });

    it("accepts an http date in Retry-After", async () => {
        await trip({ "Retry-After": new Date(NOW + 20 * MINUTE).toUTCString() });

        expect(appGlobal.rateLimitedUntil).toBe(NOW + 20 * MINUTE);
    });

    it("defaults to fifteen minutes when the response says nothing", async () => {
        await trip();

        expect(appGlobal.rateLimitedUntil).toBe(NOW + 15 * MINUTE);
    });

    it("defaults when the header cannot be parsed", async () => {
        await trip({ "Retry-After": "soon" });

        expect(appGlobal.rateLimitedUntil).toBe(NOW + 15 * MINUTE);
    });

    /* A tiny value would restore the request storm the cooldown exists to stop. */
    it("never waits less than a minute", async () => {
        await trip({ "Retry-After": "1" });

        expect(appGlobal.rateLimitedUntil).toBe(NOW + MINUTE);
    });

    /* A bogus value must not mute the extension for days. */
    it("never waits more than an hour", async () => {
        await trip({ "X-RateLimit-Reset": "999999" });

        expect(appGlobal.rateLimitedUntil).toBe(NOW + 60 * MINUTE);
    });

    it("persists the deadline so a fresh worker honours it", async () => {
        await trip({ "Retry-After": "600" });

        const stored = await browser.storage.local.get("rateLimitedUntil");
        expect(stored.rateLimitedUntil).toBe(NOW + 10 * MINUTE);
    });

    it("skips further requests while the cooldown is active", async () => {
        const client = await trip({ "Retry-After": "600" });
        expect(client.calls).toHaveLength(1);

        await expect(ctx.apiRequestWrapper("subscriptions")).rejects.toHaveProperty("status", 429);
        await expect(ctx.apiRequestWrapper("profile")).rejects.toHaveProperty("status", 429);

        expect(client.calls).toHaveLength(1);
    });

    it("resumes once the deadline has passed", async () => {
        await trip({ "Retry-After": "600" });

        vi.setSystemTime(NOW + 11 * MINUTE);
        const calls = [];
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                calls.push(method);
                return { id: "user-1" };
            }
        };

        await expect(ctx.apiRequestWrapper("profile")).resolves.toEqual({ id: "user-1" });
        expect(calls).toEqual(["profile"]);
    });

    /* A rate limited refresh is temporary, signing the user out would be wrong. */
    it("never mistakes a 429 for an expired token", async () => {
        appGlobal.options.refreshToken = "refresh";
        const client = await trip({ "Retry-After": "600" });

        expect(client.calls).toEqual(["markers/counts"]);
        expect(appGlobal.options.refreshToken).toBe("refresh");
        expect(appGlobal.options.accessToken).toBe("token");
    });

    it("does not sign out when the refresh itself is rate limited", async () => {
        appGlobal.options.refreshToken = "refresh";
        appGlobal.feedlyApiClient = rateLimitedClient({ "Retry-After": "600" });

        await expect(ctx.refreshAccessToken()).rejects.toHaveProperty("status", 429);

        expect(appGlobal.options.refreshToken).toBe("refresh");
        expect(appGlobal.rateLimitedUntil).toBe(NOW + 10 * MINUTE);
    });
});

describe("signing out", () => {
    /*
     * Nothing else resets the memo, so signing in as a different account in the same
     * worker would label their articles with the previous account's subscription titles.
     */
    it("drops the cached subscriptions", async () => {
        const { ctx, appGlobal } = loadCore();
        appGlobal.options.accessToken = "token";
        appGlobal.getUserSubscriptionsPromise = Promise.resolve([]);

        await ctx.clearStoredTokens();

        expect(appGlobal.getUserSubscriptionsPromise).toBeNull();
    });
});

describe("rate limited update cycle", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.accessToken = "token";
        appGlobal.options.feedlyUserId = "u1";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /*
     * The count is unknown during a cooldown, and blanking the badge would throw the last
     * good value away for the whole of it.
     */
    it("keeps the badge when feedly rate limits the counter", async () => {
        appGlobal.feedlyApiClient = rateLimitedClient({ "Retry-After": "600" });

        await ctx.updateCounter();

        expect(browser._calls.setBadgeText).toEqual([]);
    });

    it("still clears the badge on an ordinary failure", async () => {
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async () => {
                throw { status: 500 };
            }
        };

        await ctx.updateCounter();

        expect(browser._calls.setBadgeText).toContain("");
    });

    it("makes no requests at all while the cooldown is active", async () => {
        const calls = [];
        appGlobal.rateLimitedUntil = NOW + 10 * MINUTE;
        appGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                calls.push(method);
                return {};
            }
        };

        await ctx.updateCounter();
        await ctx.updateFeeds();
        await ctx.updateSavedFeeds();

        expect(calls).toEqual([]);
    });

    it("restores the cooldown from storage when the worker wakes", async () => {
        const { ctx: freshCtx, appGlobal: freshGlobal } = loadCore({
            storage: {
                sync: { accessToken: "token" },
                local: { rateLimitedUntil: NOW + 10 * MINUTE }
            }
        });

        await freshCtx.readOptions();

        expect(freshGlobal.rateLimitedUntil).toBe(NOW + 10 * MINUTE);

        const calls = [];
        freshGlobal.feedlyApiClient = {
            accessToken: "token",
            request: async (method) => {
                calls.push(method);
                return {};
            }
        };

        await expect(freshCtx.apiRequestWrapper("profile")).rejects.toHaveProperty("status", 429);
        expect(calls).toEqual([]);
    });
});
