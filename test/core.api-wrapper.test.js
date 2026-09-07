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

/**
 * Builds an API client whose outcomes are keyed by method name rather than by call
 * order, which is what concurrent callers need.
 */
function routedClient(routes) {
    const calls = [];
    return {
        calls,
        accessToken: "token",
        request: async (method) => {
            calls.push({ method });
            const outcomes = routes[method];
            if (!outcomes || outcomes.length === 0) {
                throw new Error(`Unexpected request: ${method}`);
            }
            const outcome = outcomes.shift();
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

    /*
     * A whole update cycle fails with 401 together when the token expires. One
     * auth/token request per in-flight call is what turned an expired token into the
     * request storm behind issue #368.
     */
    it("shares one token refresh between concurrent callers", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        const client = routedClient({
            "markers/counts": [{ reject: { status: 401 } }, { resolve: { unreadcounts: [] } }],
            "subscriptions": [{ reject: { status: 401 } }, { resolve: [] }],
            "profile": [{ reject: { status: 401 } }, { resolve: { id: "u1" } }],
            "auth/token": [{ resolve: { access_token: "fresh", id: "user-1" } }]
        });
        appGlobal.feedlyApiClient = client;

        await Promise.all([
            ctx.apiRequestWrapper("markers/counts"),
            ctx.apiRequestWrapper("subscriptions"),
            ctx.apiRequestWrapper("profile")
        ]);

        expect(client.calls.filter(call => call.method === "auth/token")).toHaveLength(1);
        expect(appGlobal.options.accessToken).toBe("fresh");
    });

    it("refreshes again for a later request once the first refresh settled", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        const client = routedClient({
            "profile": [{ reject: { status: 401 } }, { resolve: { id: "u1" } }],
            "auth/token": [
                { resolve: { access_token: "fresh", id: "u1" } },
                { resolve: { access_token: "fresher", id: "u1" } }
            ]
        });
        appGlobal.feedlyApiClient = client;

        await ctx.apiRequestWrapper("profile");
        await ctx.refreshAccessToken();

        expect(client.calls.filter(call => call.method === "auth/token")).toHaveLength(2);
    });

    /* A token can expire while the account is already close to its quota. */
    it("starts the cooldown when the retry after a refresh is rate limited", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        appGlobal.feedlyApiClient = routedClient({
            "markers/counts": [
                { reject: { status: 401 } },
                { reject: { status: 429, headers: { get: () => "600" } } }
            ],
            "auth/token": [{ resolve: { access_token: "fresh", id: "u1" } }]
        });

        await expect(ctx.apiRequestWrapper("markers/counts")).rejects.toHaveProperty("status", 429);

        expect(appGlobal.rateLimitedUntil).toBeGreaterThan(Date.now());
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

    /*
     * A refresh token feedly has permanently rejected cannot recover on its own. Left in
     * storage it kept the scheduler awake, spending requests that could only fail --
     * which is what exhausted the quota in issue #368. Deleting the tokens by hand was
     * the workaround users found; this is that workaround, automated.
     */
    it.each([400, 401, 403])("clears the stored tokens when the refresh is rejected with %i", async (status) => {
        await browser.storage.sync.set({ accessToken: "stale", refreshToken: "revoked" });
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "revoked";
        appGlobal.feedlyApiClient = scriptedClient([{ reject: { status } }]);

        await expect(ctx.refreshAccessToken()).rejects.toHaveProperty("status", status);

        expect(appGlobal.isLoggedIn).toBe(false);
        expect(browser._calls.setIcon).toEqual([appGlobal.icons.inactive]);
        expect(appGlobal.options.accessToken).toBe("");
        expect(appGlobal.options.refreshToken).toBe("");

        const sync = await browser.storage.sync.get(null);
        expect(sync).toMatchObject({ accessToken: "", refreshToken: "" });
        const local = await browser.storage.local.get(["accessToken", "refreshToken"]);
        expect(local).toMatchObject({ accessToken: "", refreshToken: "" });
    });

    it.each([429, 500, 503])("keeps the session and the tokens on a %i", async (status) => {
        appGlobal.options.refreshToken = "refresh";
        appGlobal.feedlyApiClient = scriptedClient([{ reject: { status } }]);

        await expect(ctx.refreshAccessToken()).rejects.toHaveProperty("status", status);

        expect(browser._calls.setIcon).toEqual([]);
        expect(appGlobal.options.refreshToken).toBe("refresh");
    });

    /* Storing `undefined` over the token would make a one-off glitch permanent. */
    it("rejects a grant that carries no token, without signing out", async () => {
        appGlobal.options.accessToken = "stale";
        appGlobal.options.refreshToken = "refresh";
        appGlobal.feedlyApiClient = scriptedClient([{ resolve: { id: "u1" } }]);

        await expect(ctx.refreshAccessToken()).rejects.toMatchObject({
            message: "The refresh response contained no access token"
        });

        expect(appGlobal.options.accessToken).toBe("stale");
        expect(appGlobal.options.refreshToken).toBe("refresh");
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
