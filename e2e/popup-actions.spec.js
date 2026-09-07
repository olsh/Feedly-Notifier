const { test, expect } = require("./fixtures/extension");
const { item, savedItem, SUBSCRIPTIONS, GLOBAL_ALL, GLOBAL_SAVED } = require("./fixtures/feed-items");

test.describe("popup actions", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
    });

    test("marks a single article as read and drops it from the list", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);
        await signIn();

        const page = await popupPage();
        await expect(page.locator("#feed .item")).toHaveCount(2);

        await page.locator("#feed .item").first().locator(".mark-read").click();

        await expect(page.locator("#feed .item")).toHaveCount(1);
        const marked = mockApi.requestsTo("/v3/markers", "POST");
        expect(marked).toHaveLength(1);
        expect(marked[0].body).toMatchObject({
            action: "markAsRead",
            type: "entries",
            entryIds: ["a"]
        });
    });

    test("marks everything as read", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b"), item("c")]);
        await signIn();

        const page = await popupPage();
        await page.locator("#mark-all-read").click();

        await expect.poll(() => mockApi.requestsTo("/v3/markers", "POST").length).toBeGreaterThan(0);
        expect(mockApi.requestsTo("/v3/markers", "POST")[0].body.entryIds).toEqual(["a", "b", "c"]);
    });

    test("sends the access token with every api call", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        await popupPage();

        await expect.poll(() => mockApi.requestsFor("/contents").length).toBeGreaterThan(0);
        expect(mockApi.requestsFor("/contents")[0].authorization).toBe("OAuth e2e-access-token");
    });

    test("refetches the stream when the refresh button is clicked", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await popupPage();
        await expect(page.locator("#feed .item")).toHaveCount(1);

        // The feed changes behind the popup's back, as it would in real use.
        mockApi.setStream(GLOBAL_ALL, [item("x"), item("y")]);
        await page.locator("#update-feeds").click();

        await expect(page.locator("#feed .item")).toHaveCount(2);
        await expect(page.locator("#feed .item .title").first()).toHaveText("Article x");
    });

    test("opens every article in a background tab", async ({ context, mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b")]);
        await signIn({ markReadOnClick: false });

        const page = await popupPage();
        await expect(page.locator("#feed .item")).toHaveCount(2);

        // The article hosts do not resolve under the hermetic resolver rules,
        // so assert on the tabs that were opened rather than on what loaded.
        const opened = [];
        context.on("page", newPage => opened.push(newPage.url()));

        await page.locator("#open-all-news").click();

        await expect.poll(() => opened.length).toBe(2);
        expect(opened.sort()).toEqual([
            "http://example-blog.com/posts/a",
            "http://example-blog.com/posts/b"
        ]);
    });

    test.describe("saved feeds", () => {
        test("switches to the saved tab and renders saved articles", async ({ mockApi, signIn, popupPage }) => {
            mockApi.setStream(GLOBAL_ALL, [item("unread")]);
            mockApi.setStream(GLOBAL_SAVED, [savedItem("kept")]);
            await signIn({ abilitySaveFeeds: true });

            const page = await popupPage();
            await expect(page.locator("#feed .item")).toHaveCount(1);

            await page.locator("#tabs-checkbox").check();

            await expect(page.locator("#feed-saved")).toBeVisible();
            await expect(page.locator("#feed-saved .item")).toHaveCount(1);
            await expect(page.locator("#feed-saved .item .title")).toHaveText("Article kept");
        });

        test("saves an article from the unread list", async ({ mockApi, signIn, popupPage }) => {
            mockApi.setStream(GLOBAL_ALL, [item("a")]);
            await signIn({ abilitySaveFeeds: true });

            const page = await popupPage();
            await page.locator("#feed .item .save-feed").first().click();

            await expect.poll(() => mockApi.requestsFor("/v3/tags").length).toBeGreaterThan(0);
            const tagged = mockApi.requestsFor("/v3/tags")[0];
            expect(tagged.method).toBe("PUT");
            expect(tagged.body).toMatchObject({ entryIds: ["a"] });
        });
    });

    test.describe("themes", () => {
        test("applies the dark theme", async ({ mockApi, signIn, popupPage }) => {
            mockApi.setStream(GLOBAL_ALL, [item("a")]);
            await signIn({ theme: "dark" });

            const page = await popupPage();

            await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
        });

        test("applies the nord theme", async ({ mockApi, signIn, popupPage }) => {
            mockApi.setStream(GLOBAL_ALL, [item("a")]);
            await signIn({ theme: "nord" });

            const page = await popupPage();

            await expect(page.locator("body")).toHaveAttribute("data-theme", "nord");
        });

        test("leaves the body unmarked for the light theme", async ({ mockApi, signIn, popupPage }) => {
            mockApi.setStream(GLOBAL_ALL, [item("a")]);
            await signIn({ theme: "light" });

            const page = await popupPage();
            await expect(page.locator("#feed .item")).toHaveCount(1);

            expect(await page.locator("body").getAttribute("data-theme")).toBeNull();
        });
    });
});
