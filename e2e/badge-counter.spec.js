const { test, expect, RETRY } = require("./fixtures/extension");
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

    /** Reads the toolbar badge out of the background worker. */
    function badgeText(serviceWorker) {
        return serviceWorker.evaluate(() => chrome.action.getBadgeText({}));
    }

    test("shows the unread count from the api", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });

        await signIn();

        await expect(async () => {
            expect(await badgeText(serviceWorker)).toBe("42");
        }).toPass(RETRY);
    });

    test("abbreviates counts above 999", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 12345 });

        await signIn();

        await expect(async () => {
            expect(await badgeText(serviceWorker)).toBe("12k+");
        }).toPass(RETRY);
    });

    test("stays empty when there is nothing unread", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 0 });

        await signIn();

        await expect(async () => {
            expect(await badgeText(serviceWorker)).toBe("");
        }).toPass(RETRY);
    });

    test("stays empty when the counter is switched off", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 99 });

        await signIn({ showCounter: false });

        await expect(async () => {
            expect(await badgeText(serviceWorker)).toBe("");
        }).toPass(RETRY);
    });

    test("ignores counts for streams the user is not looking at", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({
            [GLOBAL_ALL]: 7,
            "feed/http://example-blog.com/rss": 1000
        });

        await signIn();

        await expect(async () => {
            expect(await badgeText(serviceWorker)).toBe("7");
        }).toPass(RETRY);
    });

    /*
     * Issue #102. With "reset counter on click" the badge counts only what has arrived
     * since the reset, so it cannot say whether anything is unread -- the icon has to
     * follow the total instead.
     *
     * chrome.action has no getIcon, so setIcon is recorded from inside the worker. The
     * patch and the cycle it observes share one evaluate() on purpose: the serviceWorker
     * fixture re-acquires the worker on every call, so a patch left behind across calls
     * would be silently dropped when MV3 recycles it.
     */
    function resetThenUpdate(serviceWorker) {
        return serviceWorker.evaluate(async () => {
            const paths = [];
            const setIcon = chrome.action.setIcon.bind(chrome.action);
            chrome.action.setIcon = (details) => {
                paths.push(details.path["19"]);
                return setIcon(details);
            };
            try {
                await globalThis.resetCounter();
                await globalThis.updateCounter();
            } finally {
                chrome.action.setIcon = setIcon;
            }
            return {
                paths,
                badge: await chrome.action.getBadgeText({}),
                unreadCount: globalThis.appGlobal.lastKnownUnreadCount
            };
        });
    }

    const RESET_OPTIONS = { resetCounterOnClick: true, grayIconColorIfNoUnread: true };

    /*
     * Waits for the update cycle sign-in kicks off, so the requests it spends are not
     * counted as the ones under test. The count is null until a cycle has finished, which
     * makes it a reliable sentinel even when the badge stays empty throughout.
     */
    async function signInAndSettle(signIn, serviceWorker, options) {
        await signIn(options);
        await expect.poll(
            () => serviceWorker.evaluate(() => globalThis.appGlobal.lastKnownUnreadCount),
            { message: "the extension never finished an update cycle" }
        ).not.toBeNull();
    }

    /** How many markers/counts requests `run` spends. */
    async function countsSpentBy(mockApi, run) {
        const before = mockApi.requestsTo("/v3/markers/counts").length;
        await run();
        return mockApi.requestsTo("/v3/markers/counts").length - before;
    }

    test("keeps the icon active after a reset while articles are still unread", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });
        mockApi.setUnreadCountsSinceReset({ [GLOBAL_ALL]: 0 });

        await signInAndSettle(signIn, serviceWorker, RESET_OPTIONS);
        const { paths, badge, unreadCount } = await resetThenUpdate(serviceWorker);

        expect(badge).toBe("");
        expect(paths.at(-1)).toBe("/images/icon.png");
        expect(unreadCount).toBe(42);
    });

    test("greys the icon once everything really has been read", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 0 });
        mockApi.setUnreadCountsSinceReset({ [GLOBAL_ALL]: 0 });

        await signInAndSettle(signIn, serviceWorker, RESET_OPTIONS);
        const { paths, unreadCount } = await resetThenUpdate(serviceWorker);

        expect(paths.at(-1)).toBe("/images/icon_inactive.png");
        expect(unreadCount).toBe(0);
    });

    test("counts only what arrived since the reset on the badge", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });
        mockApi.setUnreadCountsSinceReset({ [GLOBAL_ALL]: 3 });

        await signInAndSettle(signIn, serviceWorker, RESET_OPTIONS);
        const { paths, badge } = await resetThenUpdate(serviceWorker);

        expect(badge).toBe("3");
        expect(paths.at(-1)).toBe("/images/icon.png");
    });

    /*
     * The second request is the whole cost of this fix, so pin both halves of the guard:
     * it is spent only when the badge is empty because of a reset and the icon colour
     * actually depends on the answer.
     */
    test("asks feedly for the total when the icon depends on it", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });
        mockApi.setUnreadCountsSinceReset({ [GLOBAL_ALL]: 0 });

        await signInAndSettle(signIn, serviceWorker, RESET_OPTIONS);
        const spent = await countsSpentBy(mockApi, () => resetThenUpdate(serviceWorker));

        expect(spent).toBe(2);
        // The narrowed request comes first, the one that answers for the icon last.
        const counts = mockApi.requestsTo("/v3/markers/counts");
        expect(counts.at(-2).query.newerThan).toBeDefined();
        expect(counts.at(-1).query.newerThan).toBeUndefined();
    });

    test("spends no second request when the icon never greys", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });
        mockApi.setUnreadCountsSinceReset({ [GLOBAL_ALL]: 0 });

        await signInAndSettle(signIn, serviceWorker, { resetCounterOnClick: true });
        const spent = await countsSpentBy(mockApi, () => resetThenUpdate(serviceWorker));

        expect(spent).toBe(1);
    });

    test("spends no second request while something new has arrived", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });
        mockApi.setUnreadCountsSinceReset({ [GLOBAL_ALL]: 3 });

        await signInAndSettle(signIn, serviceWorker, RESET_OPTIONS);
        const spent = await countsSpentBy(mockApi, () => resetThenUpdate(serviceWorker));

        expect(spent).toBe(1);
    });

    test("recovers by refreshing the token after a 401", async ({ mockApi, signIn, serviceWorker }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 5 });
        mockApi.failNext("markers/counts", 401);

        await signIn();

        // The wrapper refreshes the token and retries the original request.
        await expect(async () => {
            expect(mockApi.requestsTo("/v3/auth/token", "POST").length).toBeGreaterThan(0);
            expect(await badgeText(serviceWorker)).toBe("5");
        }).toPass(RETRY);
    });
});
