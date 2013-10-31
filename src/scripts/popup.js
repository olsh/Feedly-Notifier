"use strict";

var popupGlobal = {
    //Determines lists of supported jQuery.timeago localizations, default localization is en
    supportedTimeAgoLocales: ["ru", "fr", "pt-BR", "it", "cs"],
    feeds: [],
    savedFeeds: [],
    backgroundPage: chrome.extension.getBackgroundPage()
};

$(document).ready(function () {
    if (popupGlobal.backgroundPage.appGlobal.options.abilitySaveFeeds) {
        $("#feedly").children("button").show();
    }

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
        var isActiveTab = !(event.ctrlKey || event.which === 2);
        chrome.tabs.create({url: link.data("link"), active: isActiveTab }, function (feedTab) {
            if (popupGlobal.backgroundPage.appGlobal.options.markReadOnClick === true && link.hasClass("title") === true && $("#feed").is(":visible")) {
                markAsRead([link.closest(".item").data("id")]);
            }
        });
    }
});

$("#popup-content").on("click", "#mark-all-read", function (event) {
    var feedIds = [];
    $(".item").each(function (key, value) {
        feedIds.push($(value).data("id"));
    });
    markAsRead(feedIds);
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
    if (contentContainer.html() === "") {
        var content;
        var feeds = $("#feed").is(":visible") ? popupGlobal.feeds : popupGlobal.savedFeeds;

        for (var i = 0; i < feeds.length; i++) {
            if (feeds[i].id === feedId) {
                content = feeds[i].content
            }
        }
        if (content) {
            contentContainer.html(content);
            //For open new tab without closing popup
            contentContainer.find("a").each(function (key, value) {
                var link = $(value);
                link.data("link", link.attr("href"));
                link.attr("href", "javascript:void(0)");
            });
        }
    }
    contentContainer.slideToggle(function () {
        $this.css("background-position", contentContainer.is(":visible") ? "-288px -120px" : "-313px -119px");
        if (contentContainer.is(":visible") && contentContainer.text().length > 350) {
            $(".item").css("width", "700px");
            $("#feedly").css("width", "700px");
            $(".article-title, .blog-title").css("width", $("#popup-content").hasClass("tabs") ? "645px" : "660px");
        } else {
            $(".item").css("width", $("#popup-content").hasClass("tabs") ? "380px" : "350px");
            $("#feedly").css("width", $("#popup-content").hasClass("tabs") ? "380px" : "350px");
            $(".article-title, .blog-title").css("width", $("#popup-content").hasClass("tabs") ? "325px" : "310px");
        }
    });
});

/* Manually feeds update */
$("#feedly").on("click", "#update-feeds", function () {
    $(".icon-refresh").css("background", "url(/images/loading16.gif)");
    if ($("#feed").is(":visible")) {
        popupGlobal.backgroundPage.getFeeds(true, function (feeds, isLoggedIn) {
            if (isLoggedIn) {
                var newFeeds = [];
                for (var i = 0; i < feeds.length; i++) {
                    if ($("#feed .item[data-id='" + feeds[i].id + "']").size() === 0) {
                        newFeeds.push(feeds[i]);
                    }
                }
                $("#feed").prepend($("#feedTemplate").mustache({feeds: newFeeds})).find(".timeago").timeago();
                popupGlobal.feeds = popupGlobal.feeds.concat(newFeeds);
            } else {
                showLogin();
            }
            $(".icon-refresh").css("background", "");
        });
    } else {
        popupGlobal.backgroundPage.getSavedFeeds(true, function (feeds, isLoggedIn) {
            if (isLoggedIn) {
                //Backward loop for chronological sequence
                var container = $("#feed-saved");
                var newSavedFeeds = [];
                for (var i = 0; i < feeds.length; i++) {
                    if ($("#feed-saved .item[data-id='" + feeds[i].id + "']").size() === 0) {
                        newSavedFeeds.push(feeds[i]);
                    }
                }
                $("#feed-saved").prepend($("#feedTemplate").mustache({feeds: newSavedFeeds})).find(".timeago").timeago();
                container.find(".mark-read").hide();
                popupGlobal.savedFeeds = popupGlobal.savedFeeds.concat(newSavedFeeds);
            } else {
                showLogin();
            }
            $(".icon-refresh").css("background", "");
        });
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

function renderFeeds() {
    showLoader();
    popupGlobal.backgroundPage.getFeeds(popupGlobal.backgroundPage.appGlobal.options.forceUpdateFeeds, function (feeds, isLoggedIn) {
        $("#loading").hide();
        $("#feed-saved").hide();
        popupGlobal.feeds = feeds;
        if (isLoggedIn === false) {
            showLogin();
        } else {
            $("#popup-content").show();
            $("#website").text(chrome.i18n.getMessage("FeedlyWebsite"));

            if (popupGlobal.backgroundPage.appGlobal.options.abilitySaveFeeds) {
                $("#popup-content").addClass("tabs");
            }

            if (feeds.length === 0) {
                $("#feed-empty").text(chrome.i18n.getMessage("NoUnreadArticles"));
                $("#feed-empty").show();
                $("#all-read-section").hide();
            } else {
                if (popupGlobal.backgroundPage.appGlobal.options.resetCounterOnClick) {
                    popupGlobal.backgroundPage.resetCounter();
                }
                $("#feed").css("font-size", popupGlobal.backgroundPage.appGlobal.options.popupFontSize / 100 + "em");
                $("#feed-empty").hide();
                var container = $("#feed").show().empty();
                container.append($("#feedTemplate").mustache({feeds: feeds}));
                $(".mark-read").attr("title", chrome.i18n.getMessage("MarkAsRead"));
                $("#mark-all-read").text(chrome.i18n.getMessage("MarkAllAsRead"));
                $("#all-read-section").show().find("*").show();
                $(".show-content").attr("title", chrome.i18n.getMessage("More"));
                container.find(".timeago").timeago();
            }
        }
    });
}

function renderSavedFeeds() {
    $("#mark-all-read").hide().siblings(".icon-ok").hide();
    showLoader();
    popupGlobal.backgroundPage.getSavedFeeds(popupGlobal.backgroundPage.appGlobal.options.forceUpdateFeeds, function (feeds, isLoggedIn) {
        $("#loading").hide();
        $("#feed").hide();
        $("#feed-saved").empty();
        popupGlobal.savedFeeds = feeds;
        if (isLoggedIn === false) {
            showLogin();
        } else {
            $("#popup-content").show();
            if (feeds.length === 0) {
                $("#feed-empty").text(chrome.i18n.getMessage("NoSavedArticles"));
                $("#feed-empty").show();
            } else {
                $("#feed-empty").hide();
                var container = $("#feed-saved").show();
                container.append($("#feedTemplate").mustache({feeds: feeds}));
                container.find(".show-content").attr("title", chrome.i18n.getMessage("More"));
                container.find(".timeago").timeago();
                container.find(".mark-read").hide();
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
    if ($("#feed").find(".item[data-is-read!='true']").size() === 0) {
        showLoader();
    }
    popupGlobal.backgroundPage.markAsRead(feedIds, function (isLoggedIn) {
        if ($("#feed").find(".item[data-is-read!='true']").size() === 0) {
            renderFeeds();
        }
    });
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