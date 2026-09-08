const { test, expect, RETRY } = require("../fixtures/firefox-extension");
const { item, SUBSCRIPTIONS, GLOBAL_ALL } = require("../fixtures/feed-items");

/**
 * The event page doing its job on firefox: reading the seeded token, calling the api with
 * it, and putting the answer on the toolbar. Nothing here is firefox-specific in intent --
 * it is the same ground e2e/badge-counter.spec.js covers on chromium -- but on this side
 * the whole path runs in an event page loaded from background.scripts rather than in a
 * service worker, which is exactly what has never had end-to-end coverage.
 */
test.describe("firefox sign-in", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, []);
    });

    /* From an extension page rather than the background: browser.action is available in
       both, and this one does not wake the event page to ask. */
    function badgeText(controlPage) {
        return controlPage.evaluate(browser => browser.action.getBadgeText({}));
    }

    test("calls the api with the seeded token", async ({ mockApi, signIn }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);

        await signIn();

        await expect(async () => {
            expect(mockApi.requestsFor("/contents").length).toBeGreaterThan(0);
        }).toPass(RETRY);

        // Every call the extension makes carries the token, not just the first.
        const authorizations = new Set(mockApi.requests.map(request => request.authorization));
        expect([...authorizations]).toEqual(["OAuth e2e-access-token"]);
    });

    test("shows the unread count on the toolbar", async ({ mockApi, signIn, controlPage }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });

        await signIn();

        await expect(async () => {
            expect(await badgeText(controlPage)).toBe("42");
        }).toPass(RETRY);
    });

    test("leaves the badge empty when the counter is switched off", async ({ mockApi, signIn, controlPage }) => {
        mockApi.setUnreadCounts({ [GLOBAL_ALL]: 42 });

        await signIn({ showCounter: false });

        await expect(async () => {
            expect(await badgeText(controlPage)).toBe("");
        }).toPass(RETRY);
    });

    test("reports itself signed in to the pages", async ({ signIn, background }) => {
        await signIn();

        //What popup.js and options.js ask for on load, so it is what they will see.
        const state = await background.send({ type: "getState" });

        expect(state.isLoggedIn).toBe(true);
        expect(state.options).toMatchObject({ accessToken: "e2e-access-token" });
    });
});
