/** Canned Feedly API payloads shared by the unit suites. */

const SUBSCRIPTIONS = [
    {
        id: "feed/http://blog-a.com/rss",
        title: "Blog A (renamed by user)",
        categories: [{ id: "user/u1/category/Tech", label: "Tech" }]
    },
    {
        id: "feed/http://blog-b.com/rss",
        title: "Blog B",
        categories: [{ id: "user/u1/category/News", label: "News" }]
    }
];

/** Builds a single Feedly stream item, overridable field by field. */
function item(overrides = {}) {
    return {
        id: "item-1",
        title: "A post title",
        origin: {
            htmlUrl: "https://blog-a.com/blog",
            streamId: "feed/http://blog-a.com/rss",
            title: "Blog A original title"
        },
        crawled: Date.UTC(2024, 0, 15, 12, 0, 0),
        engagement: 10,
        engagementRate: 1.5,
        alternate: [{ href: "https://blog-a.com/posts/1" }],
        categories: [{ id: "user/u1/category/Tech", label: "Tech" }],
        summary: { content: "<p>Summary text</p>", direction: "ltr" },
        ...overrides
    };
}

/** Wraps items in the stream contents envelope. */
function stream(items) {
    return { items };
}

export { SUBSCRIPTIONS, item, stream };
