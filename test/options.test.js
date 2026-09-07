// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

import { loadPage } from "./helpers/load-page.js";

describe("options page", () => {
    let optionsPage;
    let browser;
    let $;

    beforeEach(async () => {
        ({ page: optionsPage, browser, $ } = await loadPage({
            script: "options.js",
            page: "options.html",
            dependencies: [{ script: "feedly.api.js", expose: ["FeedlyApiClient"] }],
            expose: [
                "getSyncArea",
                "computeGlobalFavorites",
                "computeGlobalUncategorized",
                "parseFilters",
                "saveOptions",
                "loadOptions",
                "setAllSitesPermission"
            ]
        }));
    });

    describe("getSyncArea", () => {
        it("uses sync storage by default", () => {
            expect(optionsPage.getSyncArea(false)).toBe(browser.storage.sync);
        });

        it("uses local storage when syncing is disabled", () => {
            expect(optionsPage.getSyncArea(true)).toBe(browser.storage.local);
        });
    });

    describe("stream id helpers", () => {
        it("builds the favorites stream id", () => {
            expect(optionsPage.computeGlobalFavorites("u1")).toBe("user/u1/category/global.must");
        });

        it("builds the uncategorized stream id", () => {
            expect(optionsPage.computeGlobalUncategorized("u1")).toBe("user/u1/category/global.uncategorized");
        });
    });

    describe("parseFilters", () => {
        it("returns the ids of checked category boxes only", () => {
            $("#categories").append(
                $("<input type='checkbox' />").attr("data-id", "cat/A").prop("checked", true),
                $("<input type='checkbox' />").attr("data-id", "cat/B"),
                $("<input type='checkbox' />").attr("data-id", "cat/C").prop("checked", true)
            );

            expect(optionsPage.parseFilters()).toEqual(["cat/A", "cat/C"]);
        });

        it("returns an empty list when nothing is checked", () => {
            expect(optionsPage.parseFilters()).toEqual([]);
        });
    });

    describe("saveOptions", () => {
        it("coerces each control to the type its option expects", async () => {
            $("#updateInterval").val("25");
            $("#maxNumberOfFeeds").val("50");
            $("#markReadOnClick").prop("checked", true);
            $("#showFullFeedContent").prop("checked", false);
            $("#sortBy").val("oldest");

            await optionsPage.saveOptions();

            const stored = await browser.storage.sync.get(null);
            expect(stored.updateInterval).toBe(25);
            expect(stored.maxNumberOfFeeds).toBe(50);
            expect(stored.markReadOnClick).toBe(true);
            expect(stored.showFullFeedContent).toBe(false);
            expect(stored.sortBy).toBe("oldest");
        });

        it("stores the selected category filters", async () => {
            $("#categories").append(
                $("<input type='checkbox' />").attr("data-id", "cat/A").prop("checked", true)
            );

            await optionsPage.saveOptions();

            expect((await browser.storage.sync.get(null)).filters).toEqual(["cat/A"]);
        });

        it("writes to local storage when syncing is disabled", async () => {
            $("#disableOptionsSync").prop("checked", true);

            await optionsPage.saveOptions();

            expect(await browser.storage.sync.get(null)).toEqual({});
            expect((await browser.storage.local.get(null)).disableOptionsSync).toBe(true);
        });
    });

    describe("setAllSitesPermission", () => {
        it("does not ask for permission when neither option is enabled", async () => {
            let requested = false;
            browser.permissions.request = async () => {
                requested = true;
                return true;
            };

            await optionsPage.setAllSitesPermission(false, {});

            expect(requested).toBe(false);
        });

        /*
         * The <all_urls> grant is a browser-level prompt that Playwright cannot
         * accept, so the denial path is covered here rather than in e2e.
         */
        it("unchecks both notification options when the grant is denied", async () => {
            browser.permissions.request = async () => false;
            $("#showBlogIconInNotifications").prop("checked", true);
            $("#showThumbnailInNotifications").prop("checked", true);
            const options = {
                showBlogIconInNotifications: true,
                showThumbnailInNotifications: true
            };

            await optionsPage.setAllSitesPermission(true, options);

            expect(options.showBlogIconInNotifications).toBe(false);
            expect(options.showThumbnailInNotifications).toBe(false);
            expect($("#showBlogIconInNotifications").is(":checked")).toBe(false);
            expect($("#showThumbnailInNotifications").is(":checked")).toBe(false);
        });

        it("keeps both options when the grant is allowed", async () => {
            browser.permissions.request = async () => true;
            $("#showBlogIconInNotifications").prop("checked", true);
            $("#showThumbnailInNotifications").prop("checked", true);
            const options = {
                showBlogIconInNotifications: true,
                showThumbnailInNotifications: true
            };

            await optionsPage.setAllSitesPermission(true, options);

            expect(options.showBlogIconInNotifications).toBe(true);
            expect(options.showThumbnailInNotifications).toBe(true);
        });
    });

    describe("loadOptions", () => {
        it("populates the form from storage", async () => {
            await browser.storage.sync.set({
                updateInterval: 30,
                maxNumberOfFeeds: 75,
                markReadOnClick: true,
                sortBy: "oldest"
            });

            await optionsPage.loadOptions();

            expect($("#updateInterval").val()).toBe("30");
            expect($("#maxNumberOfFeeds").val()).toBe("75");
            expect($("#sortBy").val()).toBe("oldest");
        });

        it("keeps the notification options off without the all-sites permission", async () => {
            browser.permissions.contains = async () => false;
            await browser.storage.sync.set({
                showBlogIconInNotifications: true,
                showThumbnailInNotifications: true
            });

            await optionsPage.loadOptions();

            expect($("#showBlogIconInNotifications").is(":checked")).toBe(false);
            expect($("#showThumbnailInNotifications").is(":checked")).toBe(false);
        });
    });
});
