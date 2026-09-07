import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

/**
 * Builds an API client stub driven by a queue of scripted outcomes.
 * Each outcome is either `{ resolve }` or `{ reject }`.
 */
function scriptedClient(outcomes) {
    const calls = [];
    return {
        calls,
        accessToken: "token",
        request: async (method, settings) => {
            calls.push({ method, settings });
            const outcome = outcomes.shift();
            if (!outcome) {
                throw new Error(`Unexpected extra request: ${method}`);
            }
            if (outcome.reject) {
                throw outcome.reject;
            }
            return outcome.resolve;
        }
    };
}

describe("apiRequestWrapper", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
        appGlobal.options.feedlyUserId = "u1";
    });

    it("rejects and goes inactive when there is no access token", async () => {
        await expect(ctx.apiRequestWrapper("profile")).rejects.toMatchObject({
            message: "No access token available"
        });

        expect(appGlobal.isLoggedIn).toBe(false);
        expect(browser._calls.setBadgeText).toEqual([""]);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.inactive]);
        expect(browser._calls.alarmsCleared).toEqual(["updateCounter", "updateFeeds"]);
    });

    it("marks the session active on a successful request", async () => {
        appGlobal.options.accessToken = "token";
        appGlobal.feedlyApiClient = scriptedClient([{ resolve: { id: "user-1" } }]);

        await expect(ctx.apiRequestWrapper("profile")).resolves.toEqual({ id: "user-1" });

        expect(appGlobal.isLoggedIn).toBe(true);
        expect(browser._calls.setBadgeBackgroundColor).toEqual(["#CF0016"]);
    });

    it("refreshes the token and retries once after a 401", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        const client = scriptedClient([
            { reject: { status: 401 } },
            { resolve: { access_token: "fresh", id: "user-1" } },
            { resolve: { unreadcounts: [] } }
        ]);
        appGlobal.feedlyApiClient = client;

        await expect(ctx.apiRequestWrapper("markers/counts")).resolves.toEqual({ unreadcounts: [] });

        expect(client.calls.map(call => call.method))
            .toEqual(["markers/counts", "auth/token", "markers/counts"]);
        expect(appGlobal.options.accessToken).toBe("fresh");
        expect(client.accessToken).toBe("fresh");
    });

    it("persists the refreshed token", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        appGlobal.feedlyApiClient = scriptedClient([
            { reject: { status: 401 } },
            { resolve: { access_token: "fresh", id: "user-9" } },
            { resolve: {} }
        ]);

        await ctx.apiRequestWrapper("markers/counts");

        const stored = await browser.storage.sync.get(null);
        expect(stored.accessToken).toBe("fresh");
        expect(stored.feedlyUserId).toBe("user-9");
    });

    // The retry deliberately bypasses the wrapper, so it cannot loop.
    it("does not refresh twice when the retry also fails", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        const client = scriptedClient([
            { reject: { status: 401 } },
            { resolve: { access_token: "fresh", id: "user-1" } },
            { reject: { status: 401 } }
        ]);
        appGlobal.feedlyApiClient = client;

        await expect(ctx.apiRequestWrapper("markers/counts")).rejects.toHaveProperty("status", 401);

        expect(client.calls.filter(call => call.method === "auth/token")).toHaveLength(1);
    });

    it("propagates non-401 failures without refreshing", async () => {
        appGlobal.options.accessToken = "token";
        appGlobal.options.refreshToken = "refresh";
        const client = scriptedClient([{ reject: { status: 500 } }]);
        appGlobal.feedlyApiClient = client;

        await expect(ctx.apiRequestWrapper("profile")).rejects.toHaveProperty("status", 500);

        expect(client.calls).toHaveLength(1);
    });
});

describe("refreshAccessToken", () => {
    let ctx;
    let browser;
    let appGlobal;

    beforeEach(() => {
        ({ ctx, browser, appGlobal } = loadCore());
    });

    it("goes inactive and throws when there is no refresh token", async () => {
        await expect(ctx.refreshAccessToken()).rejects.toMatchObject({
            message: "No refresh token available"
        });

        expect(appGlobal.isLoggedIn).toBe(false);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.inactive]);
    });

    it("goes inactive when the refresh token is rejected", async () => {
        appGlobal.options.refreshToken = "revoked";
        appGlobal.feedlyApiClient = scriptedClient([{ reject: { status: 403 } }]);

        await expect(ctx.refreshAccessToken()).rejects.toHaveProperty("status", 403);

        expect(appGlobal.isLoggedIn).toBe(false);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.inactive]);
    });

    it("keeps the session alive on other failures", async () => {
        appGlobal.options.refreshToken = "refresh";
        appGlobal.feedlyApiClient = scriptedClient([{ reject: { status: 500 } }]);

        await expect(ctx.refreshAccessToken()).rejects.toHaveProperty("status", 500);

        expect(browser._calls.setIcon).toEqual([]);
    });

    it("sends the refresh grant without the stale authorization header", async () => {
        appGlobal.options.refreshToken = "refresh";
        const client = scriptedClient([{ resolve: { access_token: "fresh", id: "u1" } }]);
        appGlobal.feedlyApiClient = client;

        await ctx.refreshAccessToken();

        expect(client.calls[0].settings).toMatchObject({
            method: "POST",
            skipAuthentication: true
        });
        expect(client.calls[0].settings.parameters).toMatchObject({
            refresh_token: "refresh",
            grant_type: "refresh_token"
        });
    });
});
