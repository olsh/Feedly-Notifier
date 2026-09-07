import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";
import { SUBSCRIPTIONS, item, stream } from "./fixtures/feedly-responses.js";

/**
 * parseFeeds() turns a raw Feedly stream response into the view model the popup
 * renders. It is the densest branch cluster in the codebase, so it gets the
 * most coverage.
 */
describe("parseFeeds", () => {
    let ctx;
    let appGlobal;

    beforeEach(() => {
        // A fresh vm context per test is the only way to reset appGlobal and the
        // other module-level state these scripts keep.
        ({ ctx, appGlobal } = loadCore());
        appGlobal.options.accessToken = "test-token";
        appGlobal.feedlyApiClient = {
            accessToken: "test-token",
            request: async (method) => (method === "subscriptions" ? SUBSCRIPTIONS : {})
        };
    });

    const parse = (items) => ctx.parseFeeds(stream(items));

    it("prefers the subscription title over the origin title", async () => {
        const [feed] = await parse([item()]);

        expect(feed.blog).toBe("Blog A (renamed by user)");
    });

    it("falls back to the origin title when the stream is not subscribed", async () => {
        const [feed] = await parse([item({
            origin: { htmlUrl: "https://other.com", streamId: "feed/unknown", title: "Origin Title" }
        })]);

        expect(feed.blog).toBe("Origin Title");
    });

    it("reduces the blog url to its origin", async () => {
        const [feed] = await parse([item()]);

        expect(feed.blogUrl).toBe("https://blog-a.com");
    });

    it("falls back to '#' when the origin url cannot be parsed", async () => {
        const [feed] = await parse([item({ origin: { htmlUrl: "not-a-url", streamId: "x" } })]);

        expect(feed.blogUrl).toBe("#");
    });

    it("prefers the alternate link over the blog url for the item url", async () => {
        const [feed] = await parse([item()]);

        expect(feed.url).toBe("https://blog-a.com/posts/1");
    });

    it("falls back to the blog url when there is no alternate link", async () => {
        const [feed] = await parse([item({ alternate: undefined })]);

        expect(feed.url).toBe("https://blog-a.com");
    });

    describe("title handling", () => {
        it("derives a title from the summary when the item has none", async () => {
            const [feed] = await parse([item({
                title: null,
                summary: { content: "<p>Derived <b>title</b> text</p>" }
            })]);

            expect(feed.title).toBe("Derived title text");
        });

        it("truncates a derived title at 100 characters", async () => {
            const longText = "x".repeat(150);
            const [feed] = await parse([item({ title: null, summary: { content: "<p>" + longText + "</p>" } })]);

            expect(feed.title).toBe("x".repeat(100) + "...");
            expect(feed.title).toHaveLength(103);
        });

        it("does not truncate a derived title of exactly 100 characters", async () => {
            const exactText = "y".repeat(100);
            const [feed] = await parse([item({ title: null, summary: { content: exactText } })]);

            expect(feed.title).toBe(exactText);
        });

        it("uses '[no title]' when there is neither a title nor a summary", async () => {
            const [feed] = await parse([item({ title: null, summary: undefined })]);

            expect(feed.title).toBe("[no title]");
        });

        it("strips the wrapping div from an rtl title and flags the direction", async () => {
            const [feed] = await parse([item({
                title: "<div style=\"direction:rtl\">Shalom</div>"
            })]);

            expect(feed.title).toBe("Shalom");
            expect(feed.titleDirection).toBe("rtl");
        });

        it("leaves ltr titles undirected", async () => {
            const [feed] = await parse([item()]);

            expect(feed.titleDirection).toBeUndefined();
        });
    });

    describe("content selection", () => {
        it("uses the summary by default", async () => {
            const [feed] = await parse([item({
                content: { content: "<p>Full content</p>", direction: "ltr" }
            })]);

            expect(feed.content).toBe("<p>Summary text</p>");
        });

        it("uses the full content when showFullFeedContent is on", async () => {
            appGlobal.options.showFullFeedContent = true;
            const [feed] = await parse([item({
                content: { content: "<p>Full content</p>", direction: "rtl" }
            })]);

            expect(feed.content).toBe("<p>Full content</p>");
            expect(feed.contentDirection).toBe("rtl");
        });

        it("falls back to the summary when full content is requested but absent", async () => {
            appGlobal.options.showFullFeedContent = true;
            const [feed] = await parse([item({ content: undefined })]);

            expect(feed.content).toBe("<p>Summary text</p>");
        });
    });

    describe("saved state", () => {
        it("marks an item saved when it carries the global.saved tag", async () => {
            const [feed] = await parse([item({ tags: [{ id: "user/u1/tag/global.saved" }] })]);

            expect(feed.isSaved).toBe(true);
        });

        it("leaves isSaved unset for other tags", async () => {
            const [feed] = await parse([item({ tags: [{ id: "user/u1/tag/reading-list" }] })]);

            expect(feed.isSaved).toBeUndefined();
        });
    });

    describe("engagement", () => {
        it.each([
            { engagement: 999, expected: 999, postfix: "", hot: false, onFire: false },
            // The abbreviation threshold is exclusive, so 1000 stays unabbreviated.
            { engagement: 1000, expected: 1000, postfix: "", hot: false, onFire: false },
            { engagement: 1001, expected: 1, postfix: "K", hot: false, onFire: false },
            { engagement: 4999, expected: 4, postfix: "K", hot: false, onFire: false },
            { engagement: 5000, expected: 5, postfix: "K", hot: true, onFire: false },
            { engagement: 99999, expected: 99, postfix: "K", hot: true, onFire: false },
            { engagement: 100000, expected: 100, postfix: "K", hot: false, onFire: true }
        ])("formats an engagement of $engagement", async ({ engagement, expected, postfix, hot, onFire }) => {
            const [feed] = await parse([item({ engagement })]);

            expect(feed.engagement).toBe(expected);
            expect(feed.engagementPostfix).toBe(postfix);
            expect(feed.isEngagementHot).toBe(hot);
            expect(feed.isEngagementOnFire).toBe(onFire);
        });

        it("shows the engagement badge only for a positive count", async () => {
            const [zero] = await parse([item({ engagement: 0 })]);
            const [some] = await parse([item({ engagement: 1 })]);

            expect(zero.showEngagement).toBe(false);
            expect(some.showEngagement).toBe(true);
        });

        it("defaults a missing engagement rate to zero", async () => {
            const [feed] = await parse([item({ engagementRate: undefined })]);

            expect(feed.engagementRate).toBe(0);
        });
    });

    describe("dates, categories and thumbnails", () => {
        it("exposes the crawl time as both a Date and an ISO string", async () => {
            const crawled = Date.UTC(2024, 0, 15, 12, 0, 0);
            const [feed] = await parse([item({ crawled })]);

            expect(feed.date).toBeInstanceOf(Date);
            expect(feed.date.getTime()).toBe(crawled);
            expect(feed.isoDate).toBe("2024-01-15T12:00:00.000Z");
        });

        it("leaves the date empty when the item was never crawled", async () => {
            const [feed] = await parse([item({ crawled: undefined })]);

            expect(feed.isoDate).toBe("");
            expect(feed.date).toBe("");
        });

        it("encodes category ids for use in selectors", async () => {
            const [feed] = await parse([item({
                categories: [{ id: "user/u1/category/A B", label: "A B" }]
            })]);

            expect(feed.categories).toEqual([
                { id: "user/u1/category/A B", encodedId: "user/u1/category/A%20B", label: "A B" }
            ]);
        });

        it("returns an empty category list when the item has none", async () => {
            const [feed] = await parse([item({ categories: undefined })]);

            expect(feed.categories).toEqual([]);
        });

        it("picks the first thumbnail, or null when there is none", async () => {
            const [withThumb] = await parse([item({ thumbnail: [{ url: "https://img/1.png" }] })]);
            const [without] = await parse([item({ thumbnail: [] })]);

            expect(withThumb.thumbnail).toBe("https://img/1.png");
            expect(without.thumbnail).toBeNull();
        });
    });

    it("maps every item in the response", async () => {
        const feeds = await parse([item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]);

        expect(feeds.map(feed => feed.id)).toEqual(["a", "b", "c"]);
    });
});
