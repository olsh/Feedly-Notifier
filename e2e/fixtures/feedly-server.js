const http = require("node:http");

/**
 * A stand-in for the Feedly v3 API.
 *
 * The extension's own requests come from its MV3 service worker, and Playwright
 * cannot intercept those with `context.route()` -- service-worker traffic is
 * invisible to it, and the documented workaround (`serviceWorkers: "block"`)
 * would disable the extension entirely. So the browser is launched with
 * `--host-resolver-rules` pointing cloud.feedly.com at this server instead, and
 * the built extension has its API scheme rewritten from https to http. The
 * shipped `*://*.feedly.com/*` host permission already covers http, so the
 * manifest is used exactly as released.
 */
class FeedlyMockServer {
    server = null;
    port = null;
    /** Every request the extension made, for assertions. */
    requests = [];

    constructor() {
        this.reset();
    }

    /** Restores the default payloads and clears recorded traffic. */
    reset() {
        this.requests = [];
        this.tunnels = [];
        this.failures = new Map();
        this.userId = "e2e-user";
        this.accessToken = "e2e-access-token";
        this.profile = { id: this.userId, email: "e2e@example.com", fullName: "E2E User" };
        this.subscriptions = [];
        this.categories = [];
        this.unreadCounts = [];
        this.unreadCountsSinceReset = null;
        /** Stream id (decoded) to the items it should return. */
        this.streams = new Map();
    }

    /** Makes the next request to a matching path fail with `status`. */
    failNext(pathFragment, status, headers) {
        this.failures.set(pathFragment, { status, headers, remaining: 1 });
    }

    /** Makes the next `times` requests to a matching path fail with `status`. */
    failTimes(pathFragment, status, times, headers) {
        this.failures.set(pathFragment, { status, headers, remaining: times });
    }

    /**
     * Makes every request to a matching path fail until `reset()`. Needed to model a
     * quota that stays exhausted, or a refresh token feedly keeps rejecting.
     */
    failAlways(pathFragment, status, headers) {
        this.failures.set(pathFragment, { status, headers, remaining: Infinity });
    }

    setStream(streamId, items) {
        this.streams.set(streamId, items);
    }

    setUnreadCounts(counts) {
        this.unreadCounts = Object.entries(counts).map(([id, count]) => ({ id, count }));
    }

    /**
     * Counts to answer a `markers/counts?newerThan=...` with, which is how the extension
     * asks for what has arrived since the counter was last reset. Left unset, a narrowed
     * request gets the totals back, exactly as before.
     */
    setUnreadCountsSinceReset(counts) {
        this.unreadCountsSinceReset = Object.entries(counts).map(([id, count]) => ({ id, count }));
    }

    /**
     * Requests recorded so far whose path contains `fragment`.
     * Substring matching, so "/v3/markers" also matches "/v3/markers/counts";
     * use `requestsTo` when the distinction matters.
     */
    requestsFor(fragment) {
        return this.requests.filter(request => request.path.includes(fragment));
    }

    /** Requests recorded so far for exactly this path, optionally by method. */
    requestsTo(path, method) {
        return this.requests.filter(request =>
            request.path === path && (!method || request.method === method));
    }

    async start() {
        this.server = http.createServer((request, response) => this.handle(request, response));
        this.server.on("connect", (request, socket) => this.refuseTunnel(request, socket));
        await new Promise(resolve => this.server.listen(0, "127.0.0.1", resolve));
        this.port = this.server.address().port;
        return this.port;
    }

    /**
     * Refuses an https CONNECT, and records that it was attempted.
     *
     * Firefox reaches for remote settings and content signatures over https while it
     * starts and again while it shuts down, and the manual proxy the firefox suite uses
     * (e2e/fixtures/firefox-driver.js) routes those here along with everything else. An
     * http server with no connect listener drops the socket without answering, which
     * firefox counts as network activity still in flight -- so its shutdown waits on
     * them, and driver.quit() costs ~18s per session on windows instead of ~0.4s.
     *
     * Answering makes them fail fast without loosening hermeticity: nothing is tunnelled
     * anywhere, the connection is refused. The attempts are kept out of `requests`,
     * which specs count and read authorization headers off, and land in `tunnels`.
     */
    refuseTunnel(request, socket) {
        this.tunnels.push(request.url);
        //The peer resets the socket as it goes; there is nothing to do about it.
        socket.on("error", () => {});
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    }

    async stop() {
        if (this.server) {
            await new Promise(resolve => this.server.close(resolve));
            this.server = null;
        }
    }

    handle(request, response) {
        // Base for parsing only. Plain HTTP is deliberate: this mock stands in
        // for the API over the loopback interface, avoiding a self-signed
        // certificate. It never carries real traffic.
        const url = new URL(request.url, "http://cloud.feedly.com"); // NOSONAR
        const chunks = [];

        request.on("data", chunk => chunks.push(chunk));
        request.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf8");
            this.requests.push({
                method: request.method,
                path: url.pathname,
                query: Object.fromEntries(url.searchParams),
                body: rawBody ? safeParse(rawBody) : null,
                authorization: request.headers.authorization || null
            });

            // Extension fetches are same-origin from the worker, but a preflight
            // can still appear; answer it permissively.
            if (request.method === "OPTIONS") {
                return this.send(response, 200, "", {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
                });
            }

            for (const [fragment, failure] of this.failures) {
                if (url.pathname.includes(fragment)) {
                    failure.remaining--;
                    if (failure.remaining <= 0) {
                        this.failures.delete(fragment);
                    }
                    return this.send(response, failure.status,
                        { errorMessage: "forced failure" }, failure.headers || {});
                }
            }

            this.route(url, request, response);
        });
    }

    route(url, request, response) {
        const path = url.pathname.replace(/^\/v3\//, "");

        // Both the initial code exchange and the refresh grant land here.
        if (path === "auth/token") {
            this.accessToken = "e2e-refreshed-token";
            return this.send(response, 200, {
                access_token: this.accessToken,
                refresh_token: "e2e-refresh-token",
                id: this.userId,
                expires_in: 3600
            });
        }

        if (path === "profile") {
            return this.send(response, 200, this.profile);
        }

        if (path === "subscriptions") {
            return this.send(response, 200, this.subscriptions);
        }

        if (path === "categories") {
            return this.send(response, 200, this.categories);
        }

        if (path === "markers/counts") {
            const counts = url.searchParams.has("newerThan") && this.unreadCountsSinceReset
                ? this.unreadCountsSinceReset
                : this.unreadCounts;
            return this.send(response, 200, { unreadcounts: counts });
        }

        // Marking as read, and saving or unsaving an entry.
        if (path === "markers" || path.startsWith("tags/")) {
            return this.send(response, 200, {});
        }

        const streamMatch = /^streams\/(.+)\/contents$/.exec(path);
        if (streamMatch) {
            const streamId = decodeURIComponent(streamMatch[1]);
            return this.send(response, 200, { id: streamId, items: this.streams.get(streamId) || [] });
        }

        this.send(response, 404, { errorMessage: `Unmocked path: ${path}` });
    }

    send(response, status, body, headers = {}) {
        const payload = typeof body === "string" ? body : JSON.stringify(body);
        response.writeHead(status, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            ...headers
        });
        response.end(payload);
    }
}

function safeParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * The `mockApi` playwright fixture, shared by both harnesses so they cannot drift.
 * Deliberately not importing playwright: a fixture body is a plain function, and this
 * file is the one part of the suite that knows nothing about the browser driving it.
 */
const mockApiFixture = async ({}, use) => {
    const server = new FeedlyMockServer();
    await server.start();
    await use(server);
    await server.stop();
};

module.exports = { FeedlyMockServer, mockApiFixture };
