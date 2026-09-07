/** Builders for the Feedly payloads the mock server serves. */

const USER_ID = "e2e-user";
const GLOBAL_ALL = `user/${USER_ID}/category/global.all`;
const GLOBAL_SAVED = `user/${USER_ID}/tag/global.saved`;

/** One entry in a stream response. */
function item(id, overrides = {}) {
    return {
        id,
        title: `Article ${id}`,
        origin: {
            // Plain HTTP so the loopback mock can serve the article tabs.
            htmlUrl: "http://example-blog.com", // NOSONAR
            streamId: "feed/http://example-blog.com/rss",
            title: "Example Blog"
        },
        alternate: [{ href: `http://example-blog.com/posts/${id}` }],
        summary: { content: `<p>Summary of article ${id}</p>`, direction: "ltr" },
        crawled: Date.UTC(2024, 0, 15, 12, 0, 0),
        engagement: 10,
        engagementRate: 1,
        categories: [{ id: `user/${USER_ID}/category/Tech`, label: "Tech" }],
        ...overrides
    };
}

/** An entry already tagged as saved. */
function savedItem(id, overrides = {}) {
    return item(id, { tags: [{ id: GLOBAL_SAVED }], ...overrides });
}

const SUBSCRIPTIONS = [{
    id: "feed/http://example-blog.com/rss",
    title: "Example Blog",
    categories: [{ id: `user/${USER_ID}/category/Tech`, label: "Tech" }]
}];

module.exports = { item, savedItem, SUBSCRIPTIONS, USER_ID, GLOBAL_ALL, GLOBAL_SAVED };
