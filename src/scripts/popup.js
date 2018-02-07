"use strict";

var popupGlobal = {
    //Determines lists of supported jQuery.timeago localizations, default localization is en
    supportedTimeAgoLocales: ["ru", "fr", "pt-br", "it", "cs", "zh-CN", "zh-TW", "tr", "es", "ko", "de",
        "uk", "sr", "ja", "ar", "id", "da", "hu", "pt", "el", "fa"],
    feeds: [],
    savedFeeds: [],
    backgroundPage: chrome.extension.getBackgroundPage()
};

$(document).ready(function () {
    $("#feed, #feed-saved").css("font-size", popupGlobal.backgroundPage.appGlobal.options.popupFontSize / 100 + "em");
    $("#website").text(chrome.i18n.getMessage("FeedlyWebsite"));
    $("#mark-all-read>span").text(chrome.i18n.getMessage("MarkAllAsRead"));
    $("#update-feeds>span").text(chrome.i18n.getMessage("UpdateFeeds"));
    $("#open-all-news>span").text(chrome.i18n.getMessage("OpenAllFeeds"));
    $("#open-unsaved-all-news>span").text(chrome.i18n.getMessage("OpenAllSavedFeeds"));


    if (popupGlobal.backgroundPage.appGlobal.options.abilitySaveFeeds) {
        $("#popup-content").addClass("tabs");
    }

    setPopupExpand(false);

    //If we support this localization of timeago, then insert script with it
    if (popupGlobal.supportedTimeAgoLocales.indexOf(window.navigator.language) !== -1) {
        //Trying load localization for jQuery.timeago
        $.getScript("/scripts/timeago/locales/jquery.timeago." + window.navigator.language + ".js", function () {
            executeAsync(renderFeeds);
        });
    } else {
        executeAsync(renderFeeds);
    }
});

$("#login").click(function () {
    popupGlobal.backgroundPage.getAccessToken();
});

//using "mousedown" instead of "click" event to process middle button click.
$("#feed, #feed-saved").on("mousedown", "a", function (event) {
    var link = $(this);
    if (event.which === 1 || event.which === 2) {
        var isActiveTab = !(event.ctrlKey || event.which === 2) && !popupGlobal.backgroundPage.appGlobal.options.openFeedsInBackground;
        var isFeed = link.hasClass("title") && $("#feed").is(":visible");
        var url = link.data("link");

        if (isFeed && popupGlobal.backgroundPage.appGlobal.feedTabId && popupGlobal.backgroundPage.appGlobal.options.openFeedsInSameTab) {
            chrome.tabs.update(popupGlobal.backgroundPage.appGlobal.feedTabId, {url: url}, function(tab) {
                onOpenCallback(isFeed, tab);
            })
        } else {
            chrome.tabs.create({url: url, active: isActiveTab }, function(tab) {
                onOpenCallback(isFeed, tab);
            });
        }
    }

    function onOpenCallback(isFeed, tab) {
        if (isFeed) {
            popupGlobal.backgroundPage.appGlobal.feedTabId = tab.id;

            if (popupGlobal.backgroundPage.appGlobal.options.markReadOnClick) {
                markAsRead([link.closest(".item").data("id")]);
            }
        }
    }
});

$("#popup-content").on("click", "#mark-all-read", markAllAsRead);

$("#popup-content").on("click", "#open-all-news", function () {
    $("#feed").find("a.title[data-link]").filter(":visible").each(function (key, value) {
        var news = $(value);
        chrome.tabs.create({url: news.data("link"), active: false }, function () {});
    });
    if (popupGlobal.backgroundPage.appGlobal.options.markReadOnClick) {
        markAllAsRead();
    }
});

$("#popup-content").on("click", "#open-unsaved-all-news", function () {
   $("#feed-saved").find("a.title[data-link]").filter(":visible").each(function (key, value) {
           var news = $(value);
           chrome.tabs.create({url: news.data("link"), active: false }, function () {});
       });
        markAllAsUnsaved();
});

$("#feed").on("click", ".mark-read", function (event) {
    var feed = $(this).closest(".item");
    markAsRead([feed.data("id")]);
});

$("#feedly").on("click", "#btn-feeds-saved", function () {
    $(this).addClass("active-tab");
    $("#btn-feeds").removeClass("active-tab");
    renderSavedFeeds();
});

$("#feedly").on("click", "#btn-feeds", function () {
    $(this).addClass("active-tab");
    $("#btn-feeds-saved").removeClass("active-tab");
    renderFeeds();
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
        $this.css("background-position", contentContainer.is(":visible") ? "-288px -120px" : "-313px -119px");
        if ($(".content").is(":visible")) {
            setPopupExpand(true);
        } else {
            setPopupExpand(false);
        }
    });
});

/* Manually feeds update */
$("#feedly").on("click", "#update-feeds", function () {
    if ($("#feed").is(":visible")) {
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
    popupGlobal.backgroundPage.toggleSavedFeed([feedId], saveItem);
    $this.data("saved", saveItem);
    $this.toggleClass("saved");
});

$("#popup-content").on("click", "#website", function(){
    popupGlobal.backgroundPage.openFeedlyTab();

    // Close the popup since the user wants to see Feedly website anyway
    window.close();
});

$("#popup-content").on("click", ".categories > span", function (){
    $(".categories").find("span").removeClass("active");
    var button = $(this).addClass("active");
    var categoryId = button.data("id");
    if (categoryId) {
        $(".item").hide();
        $(".item[data-categories~='" + categoryId + "']").show();
    } else {
        $(".item").show();
    }
});

$("#feedly").on("click", "#feedly-logo", function (event) {
    if (event.ctrlKey) {
        popupGlobal.backgroundPage.appGlobal.options.abilitySaveFeeds = !popupGlobal.backgroundPage.appGlobal.options.abilitySaveFeeds;
        location.reload();
    }
});

function executeAsync(func) {
    chrome.runtime.getPlatformInfo(function (platformInfo) {
        let timeout = 0;

        // Workaround for the bug: https://bugs.chromium.org/p/chromium/issues/detail?id=307912
        if (platformInfo.os === "mac") {
            timeout = 150;
        }

        setTimeout(function () {
            func();
        }, timeout);
    });
}

function renderFeeds(forceUpdate) {
    showLoader();
    popupGlobal.backgroundPage.getFeeds(popupGlobal.backgroundPage.appGlobal.options.forceUpdateFeeds || forceUpdate, function (feeds, isLoggedIn) {
        popupGlobal.feeds = feeds;
        if (isLoggedIn === false) {
            showLogin();
        } else {
            if (feeds.length === 0) {
                showEmptyContent();
            } else {
                var container = $("#feed").show().empty();

                if (popupGlobal.backgroundPage.appGlobal.options.showCategories) {
                    renderCategories(container, feeds);
                }

                var feedsTemplate = $("#feedTemplate").html();
                Mustache.parse(feedsTemplate);

                container.append(Mustache.render(feedsTemplate, {feeds: feeds}));
                container.find(".timeago").timeago();

                showFeeds();

                if (popupGlobal.backgroundPage.appGlobal.options.expandFeeds) {
                    container.find(".show-content").click();
                }
            }
        }
    });
}

function renderSavedFeeds(forceUpdate) {
    showLoader();
    popupGlobal.backgroundPage.getSavedFeeds(popupGlobal.backgroundPage.appGlobal.options.forceUpdateFeeds || forceUpdate, function (feeds, isLoggedIn) {
        popupGlobal.savedFeeds = feeds;
        if (isLoggedIn === false) {
            showLogin();
        } else {
            if (feeds.length === 0) {
                showEmptyContent();
            } else {
                var container = $("#feed-saved").empty();

                if (popupGlobal.backgroundPage.appGlobal.options.showCategories) {
                    renderCategories(container, feeds);
                }

                var feedTemplate = $("#feedTemplate").html();
                Mustache.parse(feedTemplate);

                container.append(Mustache.render(feedTemplate, {feeds: feeds}));
                container.find(".timeago").timeago();

                showSavedFeeds();

                if (popupGlobal.backgroundPage.appGlobal.options.expandFeeds) {
                    container.find(".show-content").click();
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

    //Show loader if all feeds were read
    if ($("#feed").find(".item[data-is-read!='true']").length === 0) {
        showLoader();
    }
    popupGlobal.backgroundPage.markAsRead(feedIds, function () {
        if ($("#feed").find(".item[data-is-read!='true']").length === 0) {
            renderFeeds();
        }
    });
}

function markAsUnSaved(feedIds) {
    var feedItems = $();
    for (var i = 0; i < feedIds.length; i++) {
        feedItems = feedItems.add(".item[data-id='" + feedIds[i] + "']");
    }

    popupGlobal.backgroundPage.toggleSavedFeed(feedIds, false);

    feedItems.data("saved", false);
    feedItems.find(".saved").removeClass("saved");
}

function markAllAsRead() {
    var feedIds = [];
    $(".item:visible").each(function (key, value) {
        feedIds.push($(value).data("id"));
    });
    markAsRead(feedIds);
}

function markAllAsUnsaved() {
    var feedIds = [];
    $(".item:visible").each(function (key, value) {
        feedIds.push($(value).data("id"));
    });
    markAsUnSaved(feedIds);
}

function renderCategories(container, feeds){
    $(".categories").remove();
    var categories = getUniqueCategories(feeds);
    var template = $("#categories-template").html();
    Mustache.parse(template);
    container.append(Mustache.render(template, {categories: categories}));
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

function showLoader() {
    $("body").children("div").hide();
    $("#loading").show();
}

function showLogin() {
    $("body").children("div").hide();
    $("#login-btn").text(chrome.i18n.getMessage("Login"));
    $("#login").show();
}

function showEmptyContent() {
    $("body").children("div").hide();
    $("#popup-content").show().children("div").hide().filter("#feed-empty").text(chrome.i18n.getMessage("NoUnreadArticles")).show();
    $("#feedly").show().find("#popup-actions").hide();
}

function showFeeds() {
    if (popupGlobal.backgroundPage.appGlobal.options.resetCounterOnClick) {
        popupGlobal.backgroundPage.resetCounter();
    }
    $("body").children("div").hide();
    $("#popup-content").show().children("div").hide().filter("#feed").show();
    $("#feedly").show().find("#popup-actions").show().children().show();
    $(".mark-read").attr("title", chrome.i18n.getMessage("MarkAsRead"));
    $(".show-content").attr("title", chrome.i18n.getMessage("More"));
    $("#feedly").show().find("#popup-actions").show().children().filter(".icon-unsaved").hide();

}

function showSavedFeeds() {
    $("body").children("div").hide();
    $("#popup-content").show().children("div").hide().filter("#feed-saved").show().find(".mark-read").hide();
    $("#feed-saved").find(".show-content").attr("title", chrome.i18n.getMessage("More"));
    $("#feedly").show().find("#popup-actions").show().children().hide();
    $("#feedly").show().find("#popup-actions").show().children().filter(".icon-unsaved").show();
    $("#feedly").show().find("#popup-actions").show().children().filter(".icon-refresh").show();
}

function setPopupExpand(isExpand) {
    if (isExpand) {
        $("#feed, #feed-saved").width(popupGlobal.backgroundPage.appGlobal.options.expandedPopupWidth);
    } else {
        $("#feed, #feed-saved").width(popupGlobal.backgroundPage.appGlobal.options.popupWidth);
    }
}
