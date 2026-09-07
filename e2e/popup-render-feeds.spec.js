const { test, expect } = require("./fixtures/extension");
const { item, SUBSCRIPTIONS, GLOBAL_ALL } = require("./fixtures/feed-items");

test.describe("popup feed rendering", () => {
    test.beforeEach(async ({ mockApi }) => {
        mockApi.subscriptions = SUBSCRIPTIONS;
    });

    test("shows the login prompt when signed out", async ({ popupPage }) => {
        const page = await popupPage();

        await expect(page.locator("#login")).toBeVisible();
        await expect(page.locator("#login-btn")).toHaveText("Login");
        await expect(page.locator("#feed")).toBeHidden();
    });

    test("renders one row per unread article", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a"), item("b"), item("c")]);
        await signIn();

        const page = await popupPage();

        await expect(page.locator("#feed .item")).toHaveCount(3);
        await expect(page.locator("#login")).toBeHidden();
    });

    test("shows the article title, blog name and link", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a", { title: "A Very Specific Headline" })]);
        await signIn();

        const page = await popupPage();
        const article = page.locator("#feed .item").first();

        await expect(article.locator(".title")).toHaveText("A Very Specific Headline");
        await expect(article.locator(".blog-title a")).toHaveText("Example Blog,");
        await expect(article.locator(".title"))
            .toHaveAttribute("data-link", "http://example-blog.com/posts/a");
    });

    test("prefers the user's own subscription title", async ({ mockApi, signIn, popupPage }) => {
        mockApi.subscriptions = [{
            id: "feed/http://example-blog.com/rss",
            title: "My Renamed Feed",
            categories: []
        }];
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn();

        const page = await popupPage();

        await expect(page.locator("#feed .item .blog-title a")).toHaveText("My Renamed Feed,");
    });

    test("shows the empty state when there is nothing unread", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, []);
        await signIn();

        const page = await popupPage();

        await expect(page.locator("#feed-empty")).toBeVisible();
        await expect(page.locator("#feed .item")).toHaveCount(0);
    });

    test("renders the engagement badge for popular articles", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [
            item("hot", { engagement: 7500 }),
            item("quiet", { engagement: 0 })
        ]);
        await signIn();

        const page = await popupPage();

        const hot = page.locator("#feed .item").filter({ hasText: "Article hot" });
        await expect(hot.locator(".engagement")).toHaveText("7K");
        await expect(hot.locator(".engagement")).toHaveClass(/hot/);
        await expect(page.locator("#feed .item").filter({ hasText: "Article quiet" }).locator(".engagement"))
            .toHaveCount(0);
    });

    test("expands an article body on demand", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [
            item("a", { summary: { content: "<p>The full body text</p>", direction: "ltr" } })
        ]);
        await signIn();

        const page = await popupPage();
        const article = page.locator("#feed .item").first();
        await expect(article.locator(".content")).toBeHidden();

        await article.locator(".show-content").click();

        await expect(article.locator(".content")).toBeVisible();
        await expect(article.locator(".content")).toContainText("The full body text");
    });

    test("renders category chips when the option is on", async ({ mockApi, signIn, popupPage }) => {
        mockApi.setStream(GLOBAL_ALL, [item("a")]);
        await signIn({ showCategories: true });

        const page = await popupPage();

        await expect(page.locator("#feed .categories")).toBeVisible();
        await expect(page.locator("#feed .categories span")).toContainText(["All", "Tech"]);
    });
});
