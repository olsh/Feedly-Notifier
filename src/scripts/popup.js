"use strict";

var popupGlobal = {
    feeds: [],
    savedFeeds: [],
    isSidebar: false,
    resized: false
};

const bg = {
    send: (type, payload) => browser.runtime.sendMessage(Object.assign({ type }, payload || {}))
};

let options = {};
//The lower bound core.js clamps popupWidth and expandedPopupWidth to.
const minPopupWidth = 380;
let environment = { os: "" };

/* The layout for the page rendered as a panel rather than as the toolbar popup. Chromium's
   side panel and firefox's sidebar both size the frame themselves and both let the user
   drag it wider, so the fixed dimensions the popup relies on give way to percentages --
   without the widths, the inline-flex body in style.css shrink-wraps to its 380px minimum
   and leaves the rest of a widened panel empty. */
function applySidebarLayout() {
    $(document.body).css("font-size", "12pt");
    $(document.body).css("width", "100%");
    $("html").height("100%");
    $("html").css("min-height", "600px");
    $("#popup-body").css("min-height", "600px");
    $("#popup-body").height("100%");
    $("#popup-body").css("max-height", "100%");
    $("#popup-content").css("max-height", "100%");
    $("#popup-content").css("width", "100%");
}

document.addEventListener("DOMContentLoaded", async function () {
    const state = await bg.send("getState") || {};
    options = state.options || {};
    environment = state.environment || { os: "" };

    setTheme();
    $("#feed, #feed-saved, #feed-empty").css("font-size", (options.popupFontSize || 100) / 100 + "em");
    $("#website").text(browser.i18n.getMessage("FeedlyWebsite"));
    $("#mark-all-read>span").text(browser.i18n.getMessage("MarkAllAsRead"));
    $("#mark-read-engagement>span").text(browser.i18n.getMessage("MarkAsReadEngagement"));
    $("#update-feeds>span").text(browser.i18n.getMessage("UpdateFeeds"));
    $("#open-all-news>span").text(browser.i18n.getMessage("OpenAllFeeds"));
    $("#open-unsaved-all-news>span").text(browser.i18n.getMessage("OpenAllSavedFeeds"));

    if (options.abilitySaveFeeds) {
        $("#popup-content").addClass("tabs");
    }

    //Both browsers point their panel at popup.html?panel=1, so the marker is per document
    //and says what this page IS. sidebarAction.isOpen, which firefox used to use here,
    //only says whether a sidebar is open somewhere in the window -- with one open, the
    //toolbar popup was laying itself out as a sidebar too.
    const isSidePanel = new URLSearchParams(window.location.search).get("panel") === "1";
    if (isSidePanel) {
        popupGlobal.isSidebar = true;
        applySidebarLayout();
    }

    // @if BROWSER='chrome'
    //The side panel is resizable and keeps the percentage based layout applied above,
    //onResizeChrome would freeze it at the height of the first resize.
    if (!isSidePanel) {
        window.addEventListener("resize", onResizeChrome);
    }
    // @endif

    setPopupWidth(false);
    showEmptyContent();
    executeAsync(renderFeeds);
});

//Deliberately not async: this listener also sees the messages the options page sends to
//the worker, and any promise returned from here would race with the worker's own reply.
//Returning undefined leaves those messages to it.
browser.runtime.onMessage.addListener(function (message) {
    if (message?.type === "feedsUpdated") {
        renderFromCache();
    }

    return undefined;
});

/* Follows the background's scheduled updates while the page stays open. Only the sidebar
   and the side panel need it: the popup is opened, read and closed again, whereas a pinned
   panel would otherwise go on showing the articles that were current when it was pinned
   (issue #297). Renders from the cache the background has just filled, spending a request
   of our own here would undo the quota protection. */
function renderFromCache() {
    if (!popupGlobal.isSidebar) {
        return;
    }

    //Re-rendering collapses whatever the user has open, so a page being read is left as
    //it is. Not a signal when expandFeeds expands every article by itself.
    if (!options.expandFeeds && $(".content").is(":visible")) {
        return;
    }

    if (options.abilitySaveFeeds && $("#tabs-checkbox").is(":checked")) {
        renderSavedFeeds(false, true);
    } else {
        renderFeeds(false, true);
    }
}

$("#login").on("click", async function () {
    await bg.send("getAccessToken");
    renderFeeds();
});

//Resolves the tab to reuse when "open feeds in same tab" is enabled: the remembered
//feed tab if it is still known, otherwise the active tab, but only in the sidebar and
//the side panel. There the feeds live next to the tab strip rather than inside it, so
//reusing the active tab is expected. In the popup it would navigate the page the user
//opened the popup from.
async function resolveSameTabTargetId() {
    const resp = await bg.send("getFeedTabId");
    const storedTabId = resp?.feedTabId;
    if (storedTabId) {
        return storedTabId;
    }

    if (!popupGlobal.isSidebar) {
        return undefined;
    }

    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    return activeTabs?.[0]?.id;
}

//using "mousedown" instead of "click" event to process middle button click.
$("#feed, #feed-saved").on("mousedown", "a", async function (event) {
    var link = $(this);
    if (event.which === 1 || event.which === 2) {
        var isNewTabRequested = event.ctrlKey || event.metaKey || event.which === 2;
        var isActiveTab = !isNewTabRequested && !options.openFeedsInBackground;
        var isFeed = link.hasClass("title") && $("#feed").is(":visible");
        var url = link.data("link");

        //Only an explicitly requested new tab overrides "open feeds in same tab",
        //opening in the background still reuses the feed tab.
        if (isFeed && options.openFeedsInSameTab && !isNewTabRequested) {
            const targetTabId = await resolveSameTabTargetId();
            if (targetTabId) {
                try {
                    const tab = await browser.tabs.update(targetTabId, { url: url, active: isActiveTab });
                    onOpenCallback(isFeed, tab);
                    return;
                } catch {
                    // Tab no longer exists (e.g. closed while service worker was inactive),
                    // fall through to create a new one
                }
            }
        }
        const tab = await browser.tabs.create({ url: url, active: isActiveTab });
        onOpenCallback(isFeed, tab);
    }

    function onOpenCallback(isFeed, tab) {
        if (isFeed) {
            bg.send("setFeedTabId", { tabId: tab.id });

            if (options.markReadOnClick) {
                markAsRead([link.closest(".item").data("id")]);
            }
        }
    }
});

$("#popup-content").on("click", "#mark-all-read", markAllAsRead);

$("#popup-content").on("click", "#mark-read-engagement", markAsReadEngagement);

$("#popup-content").on("click", "#open-all-news", async function () {
    const links = $("#feed").find("a.title[data-link]").filter(":visible");
    for (let i = 0; i < links.length; i++) {
        const news = $(links[i]);
        await browser.tabs.create({url: news.data("link"), active: false });
    }
    if (options.markReadOnClick) {
        markAllAsRead();
    }
});

$("#popup-content").on("click", "#open-unsaved-all-news", async function () {
    const links = $("#feed-saved").find("a.title[data-link]").filter(":visible");
    for (let i = 0; i < links.length; i++) {
        const news = $(links[i]);
        await browser.tabs.create({url: news.data("link"), active: false });
    }
    markAllAsUnsaved();
});

$("#feed").on("click", ".mark-read", function (event) {
    var feed = $(this).closest(".item");
    markAsRead([feed.data("id")]);
});

$("#tabs-checkbox").on("change", function () {
    if ($(this).is(":checked")) {
        renderSavedFeeds();
    } else {
        renderFeeds();
    }
});

$("#popup-content").on("click", ".show-content", function () {
    var $this = $(this);
    var feed = $this.closest(".item");
    var contentContainer = feed.find(".content");
    var feedId = feed.data("id");

    if (!contentContainer.html()) {
        var feeds = $("#feed").is(":visible") ? popupGlobal.feeds : popupGlobal.savedFeeds;

        var template = $("#feed-content").html();
        Mustache.parse(template);
        for (let feed of feeds) {
            if (feed.id === feedId) {

                // Sanitize feed HTML before rendering it in the popup.
                feed.title = DOMPurify.sanitize(feed.title);
                feed.content = DOMPurify.sanitize(feed.content);

                contentContainer.html(Mustache.render(template, feed));

                //For open new tab without closing popup
                contentContainer.find("a").each(function (key, value) {
                    var link = $(value);
                    link.data("link", link.attr("href"));
                    link.attr("href", "javascript:void(0)");
                });
            }
        }
    }
    contentContainer.slideToggle("fast", function () {
        $this.toggleClass("glyphicon-chevron-down");
        $this.toggleClass("glyphicon-chevron-up");

        var expanded = $(".content").is(":visible");
        setPopupWidth(expanded);
    });
});

/* Manually feeds update */
$("#feedly").on("click", "#update-feeds", function () {
    if (!options.abilitySaveFeeds || !$("#tabs-checkbox").is(":checked")) {
        renderFeeds(true);
    } else {
        renderSavedFeeds(true);
    }
});

/* Save or unsave feed */
$("#popup-content").on("click", ".save-feed", function () {
    var $this = $(this);
    var feed = $this.closest(".item");
    var feedId = feed.data("id");
    var saveItem = !$this.data("saved");
    bg.send("toggleSavedFeed", { feedIds: [feedId], save: saveItem });
    $this.data("saved", saveItem);
    $this.toggleClass("saved");
});

$("#popup-content").on("click", "#website", openFeedlyTab);

$("#popup-content").on("click", "#feedly-logo", openFeedlyTab);

$("#popup-content").on("click", ".categories > span", function (){
    $(".categories").find("span").removeClass("active");
    var button = $(this).addClass("active");
    var categoryId = button.data("id");
    if (categoryId) {
        $(".item").hide().removeClass("item-last");
        $(".item[data-categories~='" + categoryId + "']").show();
    } else {
        $(".item").show();
    }
    setLastVisibleItems();
});

$("#feedly").on("click", "#feedly-logo", function (event) {
    if (event.ctrlKey) {
        options.abilitySaveFeeds = !options.abilitySaveFeeds;
        location.reload();
    }
});

function executeAsync(func) {
    const timeout = environment.os === "mac" ? 500 : 0;
    setTimeout(function () {
        func();
    }, timeout);
}

async function renderFeeds(forceUpdate = options.forceUpdateFeeds, isSilent = false) {
    if (!isSilent) {
        showLoader();
    }
    const result = await bg.send("getFeeds", { forceUpdate: Boolean(forceUpdate) });
    const feeds = result && result.feeds || [];
    const isLoggedIn = result && result.isLoggedIn;
    popupGlobal.feeds = feeds;
    if (isLoggedIn === false) {
        showLogin();
    } else {
        if (feeds.length === 0) {
            showEmptyContent();
        } else {
            var container = $("#feed").show().empty();

            if (options.showCategories) {
                renderCategories(container, feeds);
            }

            var feedsTemplate = $("#feedTemplate").html();
            Mustache.parse(feedsTemplate);

            container.append(Mustache.render(feedsTemplate, {feeds: feeds}));
            renderTimeAgo(container);

            showFeeds();

            if (options.expandFeeds) {
                container.find(".show-content").trigger("click");
            }
        }
    }
}

async function renderSavedFeeds(forceUpdate = options.forceUpdateFeeds, isSilent = false) {
    if (!isSilent) {
        showLoader();
    }
    const result = await bg.send("getSavedFeeds", { forceUpdate: Boolean(forceUpdate) });
    const feeds = result && result.feeds || [];
    const isLoggedIn = result && result.isLoggedIn;
    popupGlobal.savedFeeds = feeds;
    if (isLoggedIn === false) {
        showLogin();
    } else {
        if (feeds.length === 0) {
            showEmptyContent();
        } else {
            var container = $("#feed-saved").empty();

            if (options.showCategories) {
                renderCategories(container, feeds);
            }

            var feedTemplate = $("#feedTemplate").html();
            Mustache.parse(feedTemplate);

            container.append(Mustache.render(feedTemplate, {feeds: feeds}));
            renderTimeAgo(container);

            showSavedFeeds();

            if (options.expandFeeds) {
                container.find(".show-content").trigger("click");
            }
        }
    }
}

async function markAsRead(feedIds) {
    var feedItems = $();
    for (var i = 0; i < feedIds.length; i++) {
        feedItems = feedItems.add(".item[data-id='" + feedIds[i] + "']");
    }

    feedItems.fadeOut("fast", function(){
        $(this).remove();
    });

    feedItems.attr("data-is-read", "true");

    /* Only the still unread items are counted, and fadeOut removes the ones just read,
       so this answer cannot change across the await below. */
    const allRead = $("#feed").find(".item[data-is-read!='true']").length === 0;
    const closePopup = allRead && options.closePopupWhenLastFeedIsRead;

    //Show loader if all feeds were read
    if (allRead && !closePopup) {
        showLoader();
    }

    /* window.close() tears the document down and takes any request that has not been
       handed to the worker yet with it, so it has to wait until the worker has taken the
       batch -- otherwise the articles come back unread on the next update (issue #393). */
    await bg.send("markAsRead", { feedIds: feedIds });

    if (closePopup) {
        window.close();
        return;
    }

    if (allRead) {
        renderFeeds();
    } else {
        setLastVisibleItems();
    }
}

function markAsUnSaved(feedIds) {
    var feedItems = $();
    for (var i = 0; i < feedIds.length; i++) {
        feedItems = feedItems.add(".item[data-id='" + feedIds[i] + "']");
    }

    bg.send("toggleSavedFeed", { feedIds: feedIds, save: false });

    feedItems.data("saved", false);
    feedItems.find(".saved").removeClass("saved");
}

function markAllAsRead() {
    let feedIds = [];
    $(".item:visible").each(function (key, value) {
        feedIds.push($(value).data("id"));
    });
    scrollFeedsToTop();
    markAsRead(feedIds);
}

function markAsReadEngagement() {
    var feedIds = [];
    $(".item:visible").each(function (key, value) {
        var engagement = +$(value).find(".engagement").text();
        if(engagement < options.engagementFilterLimit) {
            feedIds.push($(value).data("id"));
        }
    });
    scrollFeedsToTop();
    markAsRead(feedIds);
}

function markAllAsUnsaved() {
    var feedIds = [];
    $(".item:visible").each(function (key, value) {
        feedIds.push($(value).data("id"));
    });
    scrollFeedsToTop();
    markAsUnSaved(feedIds);
}

function scrollFeedsToTop() {
    $("#feed").scrollTop(0);
    $("#feed-saved").scrollTop(0);
}

function renderCategories(container, feeds){
    $(".categories").remove();
    var categories = getUniqueCategories(feeds);
    var template = $("#categories-template").html();
    Mustache.parse(template);
    container.append(Mustache.render(template, {categories: categories}));
}

function renderTimeAgo(container) {
    let timeagoNodes = document.querySelectorAll(".timeago");
    timeago.render(timeagoNodes, options.currentUiLanguage);
}

function getUniqueCategories(feeds){
    var categories = [];
    var addedIds = [];
    feeds.forEach(function(feed){
        feed.categories.forEach(function (category) {
            if (addedIds.indexOf(category.id) === -1) {
                categories.push(category);
                addedIds.push(category.id);
            }
        });
    });
    return categories;
}

function getSystemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
    if (theme === "dark") {
        document.body.setAttribute("data-theme", "dark");
    } else if (theme === "nord") {
        document.body.setAttribute("data-theme", "nord");
    } else {
        document.body.removeAttribute("data-theme");
    }
}

function setTheme() {
    let effectiveTheme = options.theme;

    if (options.theme === "auto") {
        effectiveTheme = getSystemTheme();
    }

    applyTheme(effectiveTheme);

    // Listen for system theme changes when auto mode is enabled
    if (options.theme === "auto") {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
            applyTheme(e.matches ? "dark" : "light");
        });
    }
}

async function openFeedlyTab() {
    // Closing the popup would take an unsent request with it -- see markAsRead (issue #393).
    await bg.send("openFeedlyTab");

    // Close the popup since the user wants to see Feedly website anyway
    window.close();
}

function showLoader() {
    lockTabsSlider();
    $("#feed, #feed-saved, #feed-empty").hide();
    $("#loading").show();
}

function showLogin() {
    $("body").children("div").hide();
    $("#login-btn").text(browser.i18n.getMessage("Login"));
    $("#login").show();
}

function showEmptyContent() {
    unlockTabsSlider();
    $("body").children("div").not("#popup-content").hide();
    $("#popup-content").show().children("div").not("#feedly").hide().filter("#feed-empty").text(browser.i18n.getMessage("NoUnreadArticles")).show();
    $("#feedly").show().find("#popup-actions").show().children().hide().filter(".icon-refresh").show();
}

function showFeeds() {
    unlockTabsSlider();
    if (options.resetCounterOnClick) {
        bg.send("resetCounter");
    }
    $("body").children("div").not("#popup-content").hide();
    $("#popup-content").show().children("div").not("#feedly").hide().filter("#feed").show();
    $(".mark-read").attr("title", browser.i18n.getMessage("MarkAsRead"));
    $(".show-content").attr("title", browser.i18n.getMessage("More"));
    $("#feedly").show().find("#popup-actions").show().children().show().filter(".icon-unsaved, #mark-read-engagement").hide();
    setLastVisibleItems();

    if (options.showEngagementFilter) {
        $("#mark-read-engagement").show();
    }
}

function showSavedFeeds() {
    unlockTabsSlider();
    $("body").children("div").not("#popup-content").hide();
    $("#popup-content").show().children("div").not("#feedly").hide().filter("#feed-saved").show().find(".mark-read").hide();
    $("#feed-saved").find(".show-content").attr("title", browser.i18n.getMessage("More"));
    $("#feedly").show().find("#popup-actions").show().children().hide().filter(".icon-unsaved, .icon-refresh").show();
    setLastVisibleItems();
}

function setLastVisibleItems() {
    if (!$(".item").not(":hidden").last().hasClass("item-last")) {
        $(".item").removeClass("item-last");
        $(".item").not(":hidden").last().addClass("item-last");
    }
}

function setPopupWidth(expanded) {
    if (! popupGlobal.isSidebar) {
        const configured = expanded
            ? options.expandedPopupWidth
            : options.popupWidth;

        //jQuery reads .width(undefined) as a getter and drops a NaN, either of which would set
        //no width at all and leave the popup to shrink-wrap its longest article title. Falling
        //back to the same floor core.js clamps to keeps that from being silent.
        const requested = Number(configured);
        const width = Number.isFinite(requested) && requested > 0 ? requested : minPopupWidth;

        $("#feed, #feed-saved, #feed-empty, #loading").width(width);
    }
}

// @if BROWSER='chrome'
function onResizeChrome() {
    if (!popupGlobal.resized) {
        var windowHeight = $(window).height();
        if ($(document).height() > windowHeight + 1) {
            $("#popup-body, #popup-content").css("max-height", windowHeight - 1);
            popupGlobal.resized = true;
        }
    }
}
// @endif

function lockTabsSlider() {
    $("#tabs-checkbox").prop("disabled", true);
}

function unlockTabsSlider() {
    $("#tabs-checkbox").prop("disabled", false);
}
