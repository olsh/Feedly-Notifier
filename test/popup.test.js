// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

import { loadPage } from "./helpers/load-page.js";

const POPUP_EXPORTS = [
    "getUniqueCategories",
    "getSystemTheme",
    "applyTheme",
    "setTheme",
    "executeAsync",
    "options",
    "environment",
    "bg",
    "popupGlobal",
    "renderFromCache",
    "markAsRead",
    "openFeedlyTab"
];

async function loadPopup(overrides = {}) {
    return loadPage({
        script: "popup.js",
        page: "popup.html",
        expose: POPUP_EXPORTS,
        ...overrides
    });
}

describe("popup page", () => {
    describe("getUniqueCategories", () => {
        let popup;

        beforeEach(async () => {
            ({ page: popup } = await loadPopup());
        });

        it("collects categories across feeds without repeating them", () => {
            const feeds = [
                { categories: [{ id: "cat/A", label: "A" }, { id: "cat/B", label: "B" }] },
                { categories: [{ id: "cat/B", label: "B" }, { id: "cat/C", label: "C" }] }
            ];

            expect(popup.getUniqueCategories(feeds).map(category => category.id))
                .toEqual(["cat/A", "cat/B", "cat/C"]);
        });

        it("preserves the order each category was first seen in", () => {
            const feeds = [
                { categories: [{ id: "cat/Z" }] },
                { categories: [{ id: "cat/A" }] }
            ];

            expect(popup.getUniqueCategories(feeds).map(category => category.id))
                .toEqual(["cat/Z", "cat/A"]);
        });

        it("returns nothing for an empty feed list", () => {
            expect(popup.getUniqueCategories([])).toEqual([]);
        });

        it("returns nothing when no feed has categories", () => {
            expect(popup.getUniqueCategories([{ categories: [] }])).toEqual([]);
        });
    });

    describe("theme", () => {
        it("reports the system theme as light by default", async () => {
            const { page: popup } = await loadPopup({ prefersDark: false });

            expect(popup.getSystemTheme()).toBe("light");
        });

        it("reports the system theme as dark when the media query matches", async () => {
            const { page: popup } = await loadPopup({ prefersDark: true });

            expect(popup.getSystemTheme()).toBe("dark");
        });

        it.each([
            ["dark", "dark"],
            ["nord", "nord"]
        ])("marks the body with data-theme=%s", async (theme, expected) => {
            const { page: popup } = await loadPopup();

            popup.applyTheme(theme);

            expect(document.body.getAttribute("data-theme")).toBe(expected);
        });

        it("removes the attribute for the light theme", async () => {
            const { page: popup } = await loadPopup();
            popup.applyTheme("dark");

            popup.applyTheme("light");

            expect(document.body.hasAttribute("data-theme")).toBe(false);
        });

        it("resolves the auto theme against a dark system preference", async () => {
            const { page: popup } = await loadPopup({ prefersDark: true });
            popup.options.theme = "auto";

            popup.setTheme();

            expect(document.body.getAttribute("data-theme")).toBe("dark");
        });

        it("resolves the auto theme against a light system preference", async () => {
            const { page: popup } = await loadPopup({ prefersDark: false });
            popup.options.theme = "auto";

            popup.setTheme();

            expect(document.body.hasAttribute("data-theme")).toBe(false);
        });

        it("follows later system changes while on the auto theme", async () => {
            const { page: popup, themeListeners } = await loadPopup({ prefersDark: false });
            popup.options.theme = "auto";
            popup.setTheme();

            themeListeners.forEach(listener => listener({ matches: true }));

            expect(document.body.getAttribute("data-theme")).toBe("dark");
        });

        it("ignores system changes when a theme is pinned", async () => {
            const { page: popup, themeListeners } = await loadPopup({ prefersDark: false });
            popup.options.theme = "light";

            popup.setTheme();

            expect(themeListeners).toHaveLength(0);
        });
    });

    describe("bg bridge", () => {
        it("sends the message type alone when there is no payload", async () => {
            const { page: popup, browser } = await loadPopup();

            popup.bg.send("getState");

            expect(browser._calls.messagesSent).toEqual([{ type: "getState" }]);
        });

        it("merges the payload into the message", async () => {
            const { page: popup, browser } = await loadPopup();

            popup.bg.send("getFeeds", { forceUpdate: true });

            expect(browser._calls.messagesSent).toEqual([{ type: "getFeeds", forceUpdate: true }]);
        });
    });

    describe("executeAsync", () => {
        it("runs on the next tick away from macOS", async () => {
            const { page: popup } = await loadPopup();
            let ran = false;

            popup.executeAsync(() => {
                ran = true;
            });

            expect(ran).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(ran).toBe(true);
        });

        // The popup must yield before acting on macOS, or the window closes first.
        it("defers on macOS", async () => {
            const { page: popup } = await loadPopup();
            popup.environment.os = "mac";
            let ran = false;

            popup.executeAsync(() => {
                ran = true;
            });

            expect(ran).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 600));
            expect(ran).toBe(true);
        });
    });
});

/**
 * A pinned sidebar or side panel has to follow the worker's scheduled updates, which the
 * worker announces by broadcasting to every extension page (issue #297). The toolbar
 * popup receives the same message and must ignore it -- it renders on open, and
 * re-rendering under the user's cursor would be worse than showing a stale list.
 */
describe("feedsUpdated broadcast", () => {
    let popup;
    let browser;

    /** Every request the page made of the worker. */
    function sent() {
        return browser._calls.messagesSent;
    }

    beforeEach(async () => {
        ({ page: popup, browser } = await loadPopup());
        sent().length = 0;
    });

    function broadcast(message) {
        return browser._events["runtime.onMessage"][0](message, {});
    }

    it("listens for messages from the worker", () => {
        expect(browser._events["runtime.onMessage"]).toHaveLength(1);
    });

    /* An async listener would return a promise for every message, including the ones the
       options page sends to the worker, and race with the worker's own reply. */
    it("claims no message it does not handle", () => {
        expect(broadcast({ type: "getOptions" })).toBeUndefined();
        expect(broadcast({ type: "feedsUpdated" })).toBeUndefined();
        expect(broadcast(null)).toBeUndefined();
    });

    it("ignores unrelated messages", () => {
        broadcast({ type: "getOptions" });

        expect(sent()).toEqual([]);
    });

    it("ignores the broadcast in the popup", () => {
        popup.popupGlobal.isSidebar = false;

        broadcast({ type: "feedsUpdated" });

        expect(sent()).toEqual([]);
    });

    it("re-reads the cache in the sidebar", () => {
        popup.popupGlobal.isSidebar = true;

        broadcast({ type: "feedsUpdated" });

        expect(sent()).toEqual([{ type: "getFeeds", forceUpdate: false }]);
    });

    /* The worker has just finished an update; asking for another one would undo the
       quota protection, and forceUpdateFeeds must not drag the panel into one either. */
    it("never forces an update, whatever the option says", () => {
        popup.popupGlobal.isSidebar = true;
        popup.options.forceUpdateFeeds = true;

        popup.renderFromCache();

        expect(sent()).toEqual([{ type: "getFeeds", forceUpdate: false }]);
    });

    it("re-reads the saved articles when that tab is showing", () => {
        popup.popupGlobal.isSidebar = true;
        popup.options.abilitySaveFeeds = true;
        $("#tabs-checkbox").prop("checked", true);

        popup.renderFromCache();

        expect(sent()).toEqual([{ type: "getSavedFeeds", forceUpdate: false }]);
    });
});

/**
 * The popup is torn down by window.close(), and a request that has not reached the worker
 * yet goes with it -- the batch is then never marked read on the server and the articles
 * come back on the next update (issue #393). These pin the ordering rather than the end
 * state: the assertions are about when close() happens relative to the send, so they fail
 * on the old code even though it, too, eventually calls sendMessage.
 */
describe("closing the popup", () => {
    let popup;
    let browser;
    /** close() and every send, in the order they happened. */
    let events;
    /** Releases the send the current test parked. */
    let release;

    /** Parks sends of `type` until release() so the pending window is observable. */
    function parkSends(type) {
        const original = browser.runtime.sendMessage;
        browser.runtime.sendMessage = async (message) => {
            events.push("send:" + message.type);
            if (message.type === type) {
                await new Promise(resolve => {
                    release = resolve;
                });
            }
            return original(message);
        };
    }

    function seedFeed(...ids) {
        $("#feed").html(ids.map(id => `<div class="item" data-id="${id}"></div>`).join(""));
    }

    beforeEach(async () => {
        ({ page: popup, browser } = await loadPopup());
        events = [];
        release = undefined;
        // The real close() would tear down the window the rest of the file runs in.
        window.close = () => events.push("close");
    });

    it("hands the batch to the worker before closing", async () => {
        popup.options.closePopupWhenLastFeedIsRead = true;
        seedFeed("a");
        parkSends("markAsRead");

        const marking = popup.markAsRead(["a"]);

        expect(events).toEqual(["send:markAsRead"]);
        release();
        await marking;
        expect(events).toEqual(["send:markAsRead", "close"]);
        expect(browser._calls.messagesSent).toEqual([{ type: "markAsRead", feedIds: ["a"] }]);
    });

    // Re-rendering a closing document is pointless, and getFeeds would cost a request.
    it("does not re-render the feeds it is closing over", async () => {
        popup.options.closePopupWhenLastFeedIsRead = true;
        seedFeed("a");

        await popup.markAsRead(["a"]);

        expect(events).toEqual(["close"]);
        expect(browser._calls.messagesSent.map(message => message.type)).toEqual(["markAsRead"]);
    });

    it("re-renders instead of closing when the option is off", async () => {
        popup.options.closePopupWhenLastFeedIsRead = false;
        seedFeed("a");

        await popup.markAsRead(["a"]);

        expect(events).toEqual([]);
        expect(browser._calls.messagesSent.map(message => message.type)).toEqual(["markAsRead", "getFeeds"]);
    });

    it("stays open while unread articles remain", async () => {
        popup.options.closePopupWhenLastFeedIsRead = true;
        seedFeed("a", "b");

        await popup.markAsRead(["a"]);

        expect(events).toEqual([]);
        expect(browser._calls.messagesSent.map(message => message.type)).toEqual(["markAsRead"]);
    });

    /* Same shape, same hazard: the worker opens the tab, and the popup closes on top of
       the request that asks it to. */
    it("hands the feedly tab request over before closing", async () => {
        parkSends("openFeedlyTab");

        const opening = popup.openFeedlyTab();

        expect(events).toEqual(["send:openFeedlyTab"]);
        release();
        await opening;
        expect(events).toEqual(["send:openFeedlyTab", "close"]);
    });
});
