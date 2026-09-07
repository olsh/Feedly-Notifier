import { describe, it, expect, beforeEach } from "vitest";

import { loadCore } from "./helpers/load-core.js";

describe("options", () => {
    describe("clamping getters", () => {
        let appGlobal;

        beforeEach(() => {
            ({ appGlobal } = loadCore());
        });

        it.each([
            [1, 10],
            [9, 10],
            [10, 10],
            [45, 45]
        ])("raises an update interval of %i minutes to %i", (stored, expected) => {
            appGlobal.options.updateInterval = stored;

            expect(appGlobal.options.updateInterval).toBe(expected);
        });

        it("keeps the raw update interval in the private field", () => {
            appGlobal.options.updateInterval = 3;

            expect(appGlobal.options._updateInterval).toBe(3);
            expect(appGlobal.options.updateInterval).toBe(10);
        });

        it.each([
            ["popupWidth", 100, 380],
            ["popupWidth", 380, 380],
            ["popupWidth", 600, 600],
            ["popupWidth", 800, 800],
            ["popupWidth", 5000, 800],
            ["expandedPopupWidth", 10, 380],
            ["expandedPopupWidth", 700, 700],
            ["expandedPopupWidth", 1200, 800]
        ])("clamps %s of %i to %i", (option, stored, expected) => {
            appGlobal.options[option] = stored;

            expect(appGlobal.options[option]).toBe(expected);
        });
    });

    describe("stream id getters", () => {
        it("derive the feedly stream ids from the user id", () => {
            const { appGlobal } = loadCore();
            appGlobal.options.feedlyUserId = "user-42";

            expect(appGlobal.savedGroup).toBe("user/user-42/tag/global.saved");
            expect(appGlobal.globalGroup).toBe("user/user-42/category/global.all");
            expect(appGlobal.globalUncategorized).toBe("user/user-42/category/global.uncategorized");
            expect(appGlobal.globalFavorites).toBe("user/user-42/category/global.must");
        });
    });

    describe("writeOptions", () => {
        it("persists public options and skips private fields", async () => {
            const { ctx, browser, appGlobal } = loadCore();
            appGlobal.options.maxNumberOfFeeds = 42;

            await ctx.writeOptions();

            const stored = await browser.storage.sync.get(null);
            expect(stored.maxNumberOfFeeds).toBe(42);
            expect(stored).not.toHaveProperty("_updateInterval");
            expect(stored).not.toHaveProperty("_popupWidth");
            expect(stored).not.toHaveProperty("_expandedPopupWidth");
        });

        it("persists the resolved value of a clamping getter, not the raw one", async () => {
            const { ctx, browser, appGlobal } = loadCore();
            appGlobal.options.updateInterval = 2;

            await ctx.writeOptions();

            expect((await browser.storage.sync.get(null)).updateInterval).toBe(10);
        });

        it("writes to local storage when sync is disabled", async () => {
            const { ctx, browser, appGlobal } = loadCore();
            appGlobal.options.disableOptionsSync = true;

            await ctx.writeOptions();

            expect(await browser.storage.local.get("maxNumberOfFeeds")).toHaveProperty("maxNumberOfFeeds");
            expect(await browser.storage.sync.get(null)).toEqual({});
        });
    });

    describe("readOptions", () => {
        it("coerces stored values to the type of the default", async () => {
            const { ctx, appGlobal } = loadCore({
                storage: {
                    sync: {
                        maxNumberOfFeeds: "35",
                        soundVolume: "0.5",
                        sortBy: "oldest"
                    }
                }
            });

            await ctx.readOptions();

            expect(appGlobal.options.maxNumberOfFeeds).toBe(35);
            expect(appGlobal.options.soundVolume).toBe(0.5);
            expect(appGlobal.options.sortBy).toBe("oldest");
        });

        /*
         * KNOWN BEHAVIOUR (core.js:1119): booleans go through Boolean(), so any
         * non-empty string is true. A legacy record holding the string "false"
         * therefore reads back as true.
         */
        it.each([
            [true, true],
            [false, false],
            ["", false],
            [0, false],
            [1, true],
            ["false", true]
        ])("coerces a stored boolean of %j to %j", async (stored, expected) => {
            const { ctx, appGlobal } = loadCore({ storage: { sync: { showCounter: stored } } });

            await ctx.readOptions();

            expect(appGlobal.options.showCounter).toBe(expected);
        });

        it("ignores private fields held in storage", async () => {
            const { ctx, appGlobal } = loadCore({ storage: { sync: { _popupWidth: 9999 } } });

            await ctx.readOptions();

            expect(appGlobal.options._popupWidth).toBe(500);
        });

        it("routes reads through local storage when sync is disabled", async () => {
            const { ctx, appGlobal } = loadCore({
                storage: {
                    local: { disableOptionsSync: true, maxNumberOfFeeds: 7 },
                    sync: { maxNumberOfFeeds: 99 }
                }
            });

            await ctx.readOptions();

            expect(appGlobal.options.maxNumberOfFeeds).toBe(7);
        });

        it("treats a stored access token as being logged in", async () => {
            const { ctx, appGlobal } = loadCore({ storage: { sync: { accessToken: "token" } } });

            await ctx.readOptions();

            expect(appGlobal.isLoggedIn).toBe(true);
        });

        it("is logged out when no token is stored", async () => {
            const { ctx, appGlobal } = loadCore();

            await ctx.readOptions();

            expect(appGlobal.isLoggedIn).toBe(false);
        });

        it("picks up the current ui language", async () => {
            const { ctx, appGlobal } = loadCore({ uiLanguage: "de" });

            await ctx.readOptions();

            expect(appGlobal.options.currentUiLanguage).toBe("de");
        });

        it("restores cached feeds from local storage", async () => {
            const { ctx, appGlobal } = loadCore({
                storage: { local: { cachedFeeds: [{ id: "a" }], cachedSavedFeeds: [{ id: "b" }] } }
            });

            await ctx.readOptions();

            expect(appGlobal.cachedFeeds).toEqual([{ id: "a" }]);
            expect(appGlobal.cachedSavedFeeds).toEqual([{ id: "b" }]);
        });

        it("falls back to empty caches when storage holds a non-array", async () => {
            const { ctx, appGlobal } = loadCore({
                storage: { local: { cachedFeeds: "corrupted", cachedSavedFeeds: null } }
            });

            await ctx.readOptions();

            expect(appGlobal.cachedFeeds).toEqual([]);
            expect(appGlobal.cachedSavedFeeds).toEqual([]);
        });
    });
});
