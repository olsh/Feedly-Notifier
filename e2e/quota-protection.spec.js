const { test, expect, RETRY } = require("./fixtures/extension");
const { SUBSCRIPTIONS, GLOBAL_ALL } = require("./fixtures/feed-items");

/**
 * Regression cover for issue #368, where the extension exhausted the account's feedly
 * api quota and feedly started answering 429 (HAP429) for the website too.
 *
 * Both scenarios drive the update cycle explicitly rather than waiting for the alarm:
 * the update interval has a ten minute floor, so an alarm would never fire inside a
 * test. `updateCounter` and `updateFeeds` are top level declarations in the worker, so
 * they are reachable on its global.
 */
test.describe("api quota protection", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, []);
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 7 });
    });

    function runUpdateCycle(serviceWorker) {
        return serviceWorker.evaluate(async () => {
            await globalThis.updateCounter();
            await globalThis.updateFeeds();
        });
    }

    test("stops calling the api once feedly reports the quota is spent", async ({ mockApi, signIn, serviceWorker }) => {
        await signIn();

        // Let the sign-in poll finish, so its requests are not counted as the cooldown's.
        await expect(async () => {
            expect(mockApi.requestsFor("/v3/markers/counts").length).toBeGreaterThan(0);
        }).toPass(RETRY);

        mockApi.failAlways("markers/counts", 429, { "Retry-After": "600" });
        await runUpdateCycle(serviceWorker);

        await expect(async () => {
            expect(await serviceWorker.evaluate(() => globalThis.appGlobal.rateLimitedUntil))
                .toBeGreaterThan(Date.now());
        }).toPass(RETRY);

        const afterCooldown = mockApi.requests.length;

        await runUpdateCycle(serviceWorker);
        await runUpdateCycle(serviceWorker);
        await runUpdateCycle(serviceWorker);

        expect(mockApi.requests.length).toBe(afterCooldown);
    });

    test("keeps the last known badge count through a rate limit", async ({ mockApi, signIn, serviceWorker }) => {
        await signIn();

        await expect(async () => {
            expect(await serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe("7");
        }).toPass(RETRY);

        mockApi.failAlways("markers/counts", 429, { "Retry-After": "600" });
        await runUpdateCycle(serviceWorker);

        expect(await serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe("7");
    });

    /*
     * The headline regression. A refresh token feedly has permanently rejected used to
     * leave the extension retrying on every alarm forever, which is what spent the quota.
     * Users escaped it by deleting the tokens by hand; the extension now does it itself.
     */
    test("signs out when feedly permanently rejects the refresh token", async ({ mockApi, signIn, serviceWorker }) => {
        await signIn();

        mockApi.failAlways("markers/counts", 401);
        mockApi.failAlways("streams", 401);
        mockApi.failAlways("auth/token", 400);

        await runUpdateCycle(serviceWorker);

        await expect(async () => {
            const stored = await serviceWorker.evaluate(() => chrome.storage.sync.get(["accessToken", "refreshToken"]));
            expect(stored).toMatchObject({ accessToken: "", refreshToken: "" });
        }).toPass(RETRY);

        // The schedule has to be gone too, otherwise the alarms keep spending requests.
        await expect(async () => {
            const alarms = await serviceWorker.evaluate(() => chrome.alarms.getAll());
            expect(alarms.map(alarm => alarm.name)).not.toContain("updateCounter");
            expect(alarms.map(alarm => alarm.name)).not.toContain("updateFeeds");
        }).toPass(RETRY);

        const afterSignOut = mockApi.requests.length;
        await runUpdateCycle(serviceWorker);

        expect(mockApi.requests.length).toBe(afterSignOut);
    });

    /*
     * updateFeeds asks for one stream per filtered category in parallel, so an expired
     * token fails all of them at once. Each failure used to ask for its own new token.
     */
    test("asks for a new token only once when a whole cycle expires together", async ({ mockApi, signIn, serviceWorker }) => {
        await signIn({ filters: ["cat-a", "cat-b", "cat-c"], isFiltersEnabled: true });

        await expect(async () => {
            expect(mockApi.requestsFor("/v3/streams").length).toBeGreaterThanOrEqual(3);
        }).toPass(RETRY);

        mockApi.failTimes("streams", 401, 3);

        const before = mockApi.requestsTo("/v3/auth/token", "POST").length;
        await serviceWorker.evaluate(() => globalThis.updateFeeds());

        expect(mockApi.requestsTo("/v3/auth/token", "POST").length - before).toBe(1);
        // All three retried and succeeded, so the cycle still did its job.
        expect(mockApi.requestsFor("/v3/streams").length).toBeGreaterThanOrEqual(9);
    });
});
