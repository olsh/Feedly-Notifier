const { test, expect } = require("./fixtures/extension");
const { SUBSCRIPTIONS, GLOBAL_ALL, USER_ID } = require("./fixtures/feed-items");

test.describe("options page", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
        mockApi.setStream(GLOBAL_ALL, []);
        mockApi.categories = [
            { id: `user/${USER_ID}/category/Tech`, label: "Tech" },
            { id: `user/${USER_ID}/category/News`, label: "News" }
        ];
    });

    test("shows the signed-in profile", async ({ signIn, optionsPage }) => {
        await signIn();

        const page = await optionsPage();

        await expect(page.locator("#userInfo")).toBeVisible();
        await expect(page.locator("#userInfo span[data-value-name='email']"))
            .toHaveText("e2e@example.com");
    });

    test("hides the profile when signed out", async ({ optionsPage }) => {
        const page = await optionsPage();

        await expect(page.locator("#userInfo")).toBeHidden();
    });

    test("round-trips changed settings through storage", async ({ signIn, optionsPage, serviceWorker }) => {
        await signIn();
        const page = await optionsPage();

        await page.locator("#updateInterval").fill("45");
        await page.locator("#maxNumberOfFeeds").fill("75");
        await page.locator("#sortBy").selectOption("oldest");
        await page.locator("#theme").selectOption("dark");
        await page.locator("#markReadOnClick").uncheck();
        await page.locator("#save").click();

        // The values must survive a full reload of the page.
        await page.reload();
        await expect(page.locator("#updateInterval")).toHaveValue("45");
        await expect(page.locator("#maxNumberOfFeeds")).toHaveValue("75");
        await expect(page.locator("#sortBy")).toHaveValue("oldest");
        await expect(page.locator("#theme")).toHaveValue("dark");
        await expect(page.locator("#markReadOnClick")).not.toBeChecked();

        // And the background must have picked them up as well.
        await expect
            .poll(() => serviceWorker.evaluate(() => globalThis.appGlobal.options.maxNumberOfFeeds))
            .toBe(75);
    });

    test("confirms the save with an alert", async ({ signIn, context, extensionId }) => {
        await signIn();
        const page = await context.newPage();
        const dialogs = [];
        page.on("dialog", dialog => {
            dialogs.push(dialog.message());
            dialog.accept();
        });
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        await page.locator("#save").click();

        await expect(async () => {
            expect(dialogs).toHaveLength(1);
        }).toPass();
    });

    test("applies the new update interval to the background alarms", async ({ signIn, optionsPage, serviceWorker }) => {
        await signIn();
        const page = await optionsPage();

        await page.locator("#updateInterval").fill("60");
        await page.locator("#save").click();

        await expect(async () => {
            const period = await serviceWorker.evaluate(async () => {
                const alarm = await chrome.alarms.get("updateFeeds");
                return alarm ? alarm.periodInMinutes : null;
            });
            expect(period).toBe(60);
        }).toPass();
    });

    test("clamps an update interval below the minimum", async ({ signIn, optionsPage, serviceWorker }) => {
        await signIn();
        const page = await optionsPage();

        // The control has min=10, so bypass it the way stale storage would.
        await page.locator("#updateInterval").evaluate(input => input.removeAttribute("min"));
        await page.locator("#updateInterval").fill("2");
        await page.locator("#save").click();

        await expect(async () => {
            const interval = await serviceWorker.evaluate(() => globalThis.appGlobal.options.updateInterval);
            expect(interval).toBe(10);
        }).toPass();
    });

    test("lists the user's categories as filter options", async ({ signIn, optionsPage }) => {
        await signIn();

        const page = await optionsPage();

        const labels = page.locator("#categories label");
        await expect(labels).toContainText(["Tech", "News", "Global Favorites", "Global Uncategorized"]);
    });

    test("moves settings to local storage when syncing is disabled", async ({ signIn, optionsPage, serviceWorker }) => {
        await signIn();
        const page = await optionsPage();

        await page.locator("#disableOptionsSync").check();
        await page.locator("#maxNumberOfFeeds").fill("33");
        await page.locator("#save").click();

        await expect(async () => {
            const stored = await serviceWorker.evaluate(
                async () => (await chrome.storage.local.get("maxNumberOfFeeds")).maxNumberOfFeeds
            );
            expect(stored).toBe(33);
        }).toPass();
    });

    test("signs the user out", async ({ signIn, optionsPage, serviceWorker }) => {
        await signIn();
        const page = await optionsPage();
        await expect(page.locator("#userInfo")).toBeVisible();

        await page.locator("#logout").click();

        await expect
            .poll(() => serviceWorker.evaluate(() => globalThis.appGlobal.options.accessToken))
            .toBe("");
        await expect(page.locator("#userInfo")).toBeHidden();
    });
});
