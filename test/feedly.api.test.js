import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadApiClient } from "./helpers/load-core.js";

/** Builds a fetch stub that records its calls and returns a canned response. */
function fetchStub({ status = 200, body = {}, json } = {}) {
    const calls = [];
    const stub = async (url, parameters) => {
        calls.push({ url, parameters });
        return {
            status,
            json: json || (async () => body)
        };
    };
    stub.calls = calls;
    return stub;
}

describe("FeedlyApiClient", () => {
    describe("getMethodUrl", () => {
        it("returns an empty string when no method is given", () => {
            const { FeedlyApiClient } = loadApiClient();

            expect(new FeedlyApiClient().getMethodUrl()).toBe("");
        });

        it("builds an absolute v3 url carrying the extension version", () => {
            const { FeedlyApiClient } = loadApiClient({ version: "3.2.0" });

            expect(new FeedlyApiClient().getMethodUrl("markers/counts"))
                .toBe("https://cloud.feedly.com/v3/markers/counts?av=c3.2.0");
        });

        it("appends every parameter, keeping the trailing separator before av", () => {
            const { FeedlyApiClient } = loadApiClient({ version: "3.2.0" });

            expect(new FeedlyApiClient().getMethodUrl("streams/contents", { count: 20, ranked: "newest" }))
                .toBe("https://cloud.feedly.com/v3/streams/contents?count=20&ranked=newest&av=c3.2.0");
        });

        // KNOWN BEHAVIOUR: parameters are interpolated raw (feedly.api.js:19).
        // Callers encode ids themselves before passing them in.
        it("does not url-encode parameter values", () => {
            const { FeedlyApiClient } = loadApiClient({ version: "3.2.0" });

            expect(new FeedlyApiClient().getMethodUrl("search", { q: "a&b=c" }))
                .toBe("https://cloud.feedly.com/v3/search?q=a&b=c&av=c3.2.0");
        });

        /*
         * The `av` prefix is set inside `// @if BROWSER=...` blocks. Those are
         * comments, so this assertion only means anything because the loader
         * preprocesses the source the way the Grunt build does -- on raw src/
         * all three branches run and firefox always wins.
         */
        it.each([
            ["chrome", "c"],
            ["opera", "o"],
            ["firefox", "f"]
        ])("uses the %s analytics prefix '%s'", (targetBrowser, prefix) => {
            const { FeedlyApiClient } = loadApiClient({ targetBrowser, version: "3.2.0" });

            expect(new FeedlyApiClient().getMethodUrl("profile"))
                .toBe(`https://cloud.feedly.com/v3/profile?av=${prefix}3.2.0`);
        });
    });

    describe("request", () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("appends a cache-busting timestamp to GET requests", async () => {
            const fetch = fetchStub();
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await new FeedlyApiClient("token").request("markers/counts", {});

            expect(fetch.calls[0].url).toContain(`&ck=${Date.now()}`);
        });

        it("does not cache-bust non-GET requests", async () => {
            const fetch = fetchStub();
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await new FeedlyApiClient("token").request("markers", { method: "POST" });

            expect(fetch.calls[0].url).not.toContain("ck=");
            expect(fetch.calls[0].parameters.method).toBe("POST");
        });

        it("sends the access token as an OAuth header", async () => {
            const fetch = fetchStub();
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await new FeedlyApiClient("secret-token").request("profile", {});

            expect(fetch.calls[0].parameters.headers.Authorization).toBe("OAuth secret-token");
        });

        it("omits the header when there is no token", async () => {
            const fetch = fetchStub();
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await new FeedlyApiClient().request("profile", {});

            expect(fetch.calls[0].parameters.headers).toEqual({});
        });

        // The token-refresh call must not present the expired token.
        it("omits the header when authentication is explicitly skipped", async () => {
            const fetch = fetchStub();
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await new FeedlyApiClient("expired").request("auth/token", {
                method: "POST",
                skipAuthentication: true
            });

            expect(fetch.calls[0].parameters.headers).toEqual({});
        });

        it("serialises the body as JSON", async () => {
            const fetch = fetchStub();
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await new FeedlyApiClient("token").request("markers", {
                method: "POST",
                body: { action: "markAsRead", entryIds: ["a", "b"] }
            });

            expect(fetch.calls[0].parameters.body)
                .toBe("{\"action\":\"markAsRead\",\"entryIds\":[\"a\",\"b\"]}");
        });

        it("resolves with the parsed body on 200", async () => {
            const fetch = fetchStub({ body: { id: "user-1" } });
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await expect(new FeedlyApiClient("token").request("profile", {}))
                .resolves.toEqual({ id: "user-1" });
        });

        it("resolves with an empty object when a 200 body is not JSON", async () => {
            const fetch = fetchStub({
                json: async () => {
                    throw new SyntaxError("Unexpected token");
                }
            });
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await expect(new FeedlyApiClient("token").request("markers", { method: "POST" }))
                .resolves.toEqual({});
        });

        /*
         * Rejecting with the raw response rather than an Error is load-bearing:
         * apiRequestWrapper and refreshAccessToken both branch on `.status`.
         */
        it.each([401, 403, 500])("rejects with the raw response object on %i", async (status) => {
            const fetch = fetchStub({ status });
            const { FeedlyApiClient } = loadApiClient({ fetch });

            await expect(new FeedlyApiClient("token").request("profile", {}))
                .rejects.toHaveProperty("status", status);
        });
    });
});
