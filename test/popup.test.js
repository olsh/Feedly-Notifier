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
    "bg"
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
