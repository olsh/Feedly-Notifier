const { test, expect } = require("./fixtures/extension");
const { SUBSCRIPTIONS, GLOBAL_ALL } = require("./fixtures/feed-items");

/**
 * Badge behaviour is pure background: no page involved, which makes these the
 * fastest true integration tests in the suite.
 */
test.describe("toolbar badge", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, []);
    });

    /** Waits for the badge to settle on a value. */
    async function expectBadge(serviceWorker, expected) {
        await expect.poll(
            () => serviceWorker.evaluate(() => chrome.action.getBadgeText({})),
            { message: `badge never became ${JSON.stringify(expected)}` }
        ).toBe(expected);
    }

    test("shows the unread count from the api", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });

        await signIn();

        await expectBadge(serviceWorker, "42");
    });

    test("abbreviates counts above 999", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 12345 });

        await signIn();

        await expectBadge(serviceWorker, "12k+");
    });

    test("stays empty when there is nothing unread", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 0 });

        await signIn();

        await expectBadge(serviceWorker, "");
    });

    test("stays empty when the counter is switched off", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 99 });

        await signIn({ showCounter: false });

        await expectBadge(serviceWorker, "");
    });

    test("ignores counts for streams the user is not looking at", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({
            [GLOBAL_ALL]: 7,
            "feed/http://example-blog.com/rss": 1000
        });

        await signIn();

        await expectBadge(serviceWorker, "7");
    });

    test("recovers by refreshing the token after a 401", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 5 });
        mockApi.failNext("markers/counts", 401);

        await signIn();

        // The wrapper refreshes the token and retries the original request.
        await expect
            .poll(() => mockApi.requestsTo("/v3/auth/token", "POST").length)
            .toBeGreaterThan(0);
        await expectBadge(serviceWorker, "5");
    });
});
