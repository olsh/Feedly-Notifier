"use strict";

var popupGlobal = {
    //Determines lists of supported jQuery.timeago localizations, default localization is en
    supportedTimeAgoLocales: ["ru", "fr", "pt-BR", "it", "cs"],
    feeds: [],
    savedFeeds: [],
    backgroundPage: chrome.extension.getBackgroundPage()
};

$(document).ready(function () {
    $("#feed, #feed-saved").css("font-size", popupGlobal.backgroundPage.appGlobal.options.popupFontSize / 100 + "em");
    $("#website").text(chrome.i18n.getMessage("FeedlyWebsite"));
    $("#mark-all-read>span").text(chrome.i18n.getMessage("MarkAllAsRead"));
    $("#expand-toggle-all>span").text(chrome.i18n.getMessage("ExpandToggleAll"));
    $("#update-feeds>span").text(chrome.i18n.getMessage("UpdateFeeds"));
    $("#open-all-news>span").text(chrome.i18n.getMessage("OpenAllFeeds"));
    $("<style>" + popupGlobal.backgroundPage.appGlobal.options.customCSS + "</style>").appendTo('head');

    if (popupGlobal.backgroundPage.appGlobal.options.abilitySaveFeeds) {
        $("#popup-content").addClass("tabs");
    }

    setPopupExpand(false);

    //If we support this localization of timeago, then insert script with it
    if (popupGlobal.supportedTimeAgoLocales.indexOf(window.navigator.language) !== -1) {
        //Trying load localization for jQuery.timeago
        $.getScript("/scripts/timeago/locales/jquery.timeago." + window.navigator.language + ".js", function () {
            renderFeeds();
        });
    } else {
        renderFeeds();
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

        if (isFeed && popupGlobal.backgroundPage.appGlobal.feedTab && popupGlobal.backgroundPage.appGlobal.options.openFeedsInSameTab) {
            chrome.tabs.update(popupGlobal.backgroundPage.appGlobal.feedTab.id,{url: url}, function(tab) {
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
            popupGlobal.backgroundPage.appGlobal.feedTab = tab;

            if (popupGlobal.backgroundPage.appGlobal.options.markReadOnClick) {
                markAsRead([link.closest(".item").data("id")]);
            }
        }
    }
});

$("#popup-content").on("click", "#mark-all-read", markAllAsRead);

$("#popup-content").on("click", "#expand-toggle-all", expandToggleAll);

$("#popup-content").on("click", "#open-all-news", function () {
    $("#feed").find("a.title[data-link]").filter(":visible").each(function (key, value) {
        var news = $(value);
        chrome.tabs.create({url: news.data("link"), active: false }, function () {});
    });
    if (popupGlobal.backgroundPage.appGlobal.options.markReadOnClick) {
        markAllAsRead();
    }
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

$("#popup-content").on("click", ".show-content, .article-title, .blog-title", function (event) {
    if (event.target.tagName == 'A') {
        return;
    }
    var $this = $(this);
    var feed = $this.closest(".item");
    var feedId = feed.data("id");
    var contentContainer = feed.find(".content");
    if (contentContainer.html() === "") {
        var feeds = $("#feed").is(":visible") ? popupGlobal.feeds : popupGlobal.savedFeeds;

        for (var i = 0; i < feeds.length; i++) {
            if (feeds[i].id === feedId) {
                contentContainer.html($("#feed-content").mustache(feeds[i]));
                retargetLinks(contentContainer);
                break;
            }
        }
    }

    var expandAllToggle = $("#expand-toggle-all").data("isExpanded");
    var expandAllRunning = $("#expand-toggle-all").data("running");

    function updateAppearance(){
        var isExpanded = expandAllRunning ? expandAllToggle : contentContainer.is(":visible");
        feed.toggleClass("expanded", isExpanded);
        feed.find(".show-content").css("background-position",
            isExpanded ? "-288px -120px" : "-313px -119px");

        if (popupGlobal.backgroundPage.appGlobal.options.condensedDisplay) {
            feed.toggleClass("condensed", !isExpanded);
        }
        if (!expandAllRunning) {
            // collapse only if all other items are collapsed
            if (isExpanded || $("#feed > .expanded").length == 0) {
                setPopupExpand(isExpanded);
            }
        }
        return isExpanded;
    }

    if (expandAllRunning) {
        contentContainer.toggle(expandAllToggle);
        updateAppearance();
    } else {
        contentContainer.slideToggle("fast", function(){
            var isExpanded = updateAppearance();
            if (!isExpanded) {
                window.scrollTo(0, Math.min(window.scrollY, feed.offset().top - $("#feedly").outerHeight()));
            }
        });
    }
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
    popupGlobal.backgroundPage.toggleSavedFeed(feedId, saveItem);
    $this.data("saved", saveItem);
    $this.toggleClass("saved");
});

$("#popup-content").on("click", "#website", function(){
    popupGlobal.backgroundPage.openFeedlyTab();
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

function renderFeeds(forceUpdate) {
    doRenderFeeds(forceUpdate);
}

function renderSavedFeeds(forceUpdate) {
    doRenderFeeds(forceUpdate, true);
}

function doRenderFeeds(forceUpdate, saved) {
    showLoader();
    forceUpdate = popupGlobal.backgroundPage.appGlobal.options.forceUpdateFeeds || forceUpdate;
    setTimeout(function() {
        popupGlobal.backgroundPage[saved ? "getSavedFeeds" : "getFeeds"](forceUpdate, function (feeds, isLoggedIn) {
            popupGlobal[saved ? "savedFeeds" : "feeds"] = feeds;
            if (isLoggedIn === false) {
                showLogin();
            } else {
                if (feeds.length === 0) {
                    showEmptyContent();
                } else {
                    var container = saved ? $("#feed-saved").empty() : $("#feed").show().empty();

                    if (popupGlobal.backgroundPage.appGlobal.options.expandFeeds) {
                        var partials = { content: $("#feed-content").html() };
                    }

                    if (popupGlobal.backgroundPage.appGlobal.options.showCategories) {
                        renderCategories(container, feeds);
                    }

                    var partials = $("#feedTemplate").mustache({feeds: feeds}, partials);
                    retargetLinks(partials.find(".content"));
                    container.append(partials);
                    container.find(".timeago").timeago();

                    if (popupGlobal.backgroundPage.appGlobal.options.expandFeeds) {
                        var timeout = setTimeout(function() {
                            clearTimeout(timeout); // prevent multiple calls
                            expandToggleAll();
                        }, 0);
                    } else {
                        var condensedDisplay = popupGlobal.backgroundPage.appGlobal.options.condensedDisplay;
                        $(".item" + (condensedDisplay ? ":not(.condensed)" : ".condensed"))
                            .each(function (key, value) {
                                $(value).toggleClass("condensed", condensedDisplay);
                            });
                    }

                    saved ? showSavedFeeds() : showFeeds();
                }
            }
        });
    }, 0);
}

function retargetLinks(container) {
    //For open new tab without closing popup
    container.find("a").each(function (key, value) {
        var link = $(value);
        link.data("link", link.attr("href"));
        link.attr("href", "javascript:void(0)");
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
    if ($("#feed").find(".item[data-is-read!='true']").size() === 0) {
        showLoader();
    }
    popupGlobal.backgroundPage.markAsRead(feedIds, function () {
        if ($("#feed").find(".item[data-is-read!='true']").size() === 0) {
            expandToggleAllSetButton(false);
            renderFeeds();
        }
    });
}

function markAllAsRead() {
    var feedIds = [];
    $(".item:visible").each(function (key, value) {
        feedIds.push($(value).data("id"));
    });
    markAsRead(feedIds);
}

function expandToggleAll() {
    var expandButton = $("#expand-toggle-all");
    var isExpand = !expandButton.data("isExpanded");
    expandToggleAllSetButton(isExpand);

    expandButton.data("running", true)
    $(".show-content").click();
    expandButton.removeData("running");

    setPopupExpand(isExpand);
}

function expandToggleAllSetButton(isExpand) {
    $("#expand-toggle-all").css("background-position", isExpand ? "-285px -118px" : "-310px -117px")
                           .data("isExpanded", isExpand)
}

function renderCategories(container, feeds){
    $(".categories").remove();
    var categories = getUniqueCategories(feeds);
    container.append($("#categories-template").mustache({categories: categories}));
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
}

function showSavedFeeds() {
    $("body").children("div").hide();
    $("#popup-content").show().children("div").hide().filter("#feed-saved").show().find(".mark-read").hide();
    $("#feed-saved").find(".show-content").attr("title", chrome.i18n.getMessage("More"));
    $("#feedly").show().find("#popup-actions").show().children().hide().filter(".icon-refresh").show();
}

function setPopupExpand(isExpand){
    if (isExpand){
        $("#feed, #feed-saved").width(popupGlobal.backgroundPage.appGlobal.options.expandedPopupWidth);
    } else {
        $("#feed, #feed-saved").width(popupGlobal.backgroundPage.appGlobal.options.popupWidth);
    }
}