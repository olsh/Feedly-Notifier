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
let environment = { os: "" };

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

    // @if BROWSER='chrome'
    window.addEventListener("resize", onResizeChrome);
    // @endif

    // @if BROWSER='firefox'
    popupGlobal.isSidebar = browser.sidebarAction.isOpen && await browser.sidebarAction.isOpen({});
    if (popupGlobal.isSidebar) {
        $(document.body).css("font-size", "12pt");
        $("html").height("100%");
        $("html").css("min-height", "600px");
        $("#popup-body").css("min-height", "600px");
        $("#popup-body").height("100%");
        $("#popup-body").css("max-height", "100%");
        $("#popup-content").css("max-height", "100%");
    }
    // @endif

    setPopupWidth(false);
    showEmptyContent();
    executeAsync(renderFeeds);
});

$("#login").on("click", function () {
    bg.send("getAccessToken").then(function () {
        setTimeout(renderFeeds, 500);
    });
});

//using "mousedown" instead of "click" event to process middle button click.
$("#feed, #feed-saved").on("mousedown", "a", async function (event) {
    var link = $(this);
    if (event.which === 1 || event.which === 2) {
        var isActiveTab = !(event.ctrlKey || event.which === 2) && !options.openFeedsInBackground;
        var isFeed = link.hasClass("title") && $("#feed").is(":visible");
        var url = link.data("link");

        if (isFeed && options.openFeedsInSameTab) {
            const resp = await bg.send("getFeedTabId");
            const existingTabId = resp && resp.feedTabId;
            if (existingTabId) {
                const tab = await browser.tabs.update(existingTabId, { url: url });
                onOpenCallback(isFeed, tab);
                return;
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

                // @if BROWSER='firefox'
                // We should sanitize the content of feeds because of AMO review.
                feed.title = DOMPurify.sanitize(feed.title);
                feed.content = DOMPurify.sanitize(feed.content);
                // @endif

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

function renderFeeds(forceUpdate) {
    showLoader();
    const wantForce = (options.forceUpdateFeeds || forceUpdate);
    bg.send("getFeeds", { forceUpdate: wantForce }).then(function (result) {
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
    });
}

function renderSavedFeeds(forceUpdate) {
    showLoader();
    const wantForce = (options.forceUpdateFeeds || forceUpdate);
    bg.send("getSavedFeeds", { forceUpdate: wantForce }).then(function (result) {
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
    });
}

function markAsRead(feedIds) {
    var feedItems = $();
    for (var i = 0; i < feedIds.length; i++) {
        feedItems = feedItems.add(".item[data-id='" + feedIds[i] + "']");
    }

    feedItems.fadeOut("fast", function(){
        $(this).remove();
    });

    feedItems.attr("data-is-read", "true");

    const closePopup = options.closePopupWhenLastFeedIsRead;
    //Show loader if all feeds were read
    if ($("#feed").find(".item[data-is-read!='true']").length === 0) {
        if (closePopup) {
            window.close();
        } else {
            showLoader();
        }
    }
    bg.send("markAsRead", { feedIds: feedIds }).then(function () {
        if ($("#feed").find(".item[data-is-read!='true']").length === 0) {
            renderFeeds();
        } else {
            setLastVisibleItems();
        }
    });
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

function setTheme() {
    switch (options.theme) {
        case "dark":
            document.body.setAttribute("data-theme", "dark");
            break;
        case "nord":
            document.body.setAttribute("data-theme", "nord");
            break;
        default: {
            document.body.removeAttribute("data-theme");
        }
    }
}

function openFeedlyTab() {
    bg.send("openFeedlyTab");

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
        const width = expanded
            ? options.expandedPopupWidth
            : options.popupWidth;

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
