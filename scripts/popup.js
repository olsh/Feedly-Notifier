var backgroundPage = chrome.extension.getBackgroundPage();

//Determines lists of supported jQuery.timeago localizations, default localization is en
var supportedTimeAgoLocales = ["ru"];

function renderFeeds(){
    backgroundPage.getFeeds(function (feeds, isLoggedIn) {
        $("#loading").hide();

        if (isLoggedIn === false) {
            $("#login-btn").text(chrome.i18n.getMessage("Login"));
            $("#login").show();
        } else {
            $("#popup-content").show();
            $("#website").text(chrome.i18n.getMessage("FeedlyWebsite"));

            if (feeds.length === 0) {
                $("#feed-empty").html(chrome.i18n.getMessage("NoUnreadArticles"));
            } else {
                $("#feed-empty").html("");
                $('#entryTemplate').tmpl(feeds).appendTo('#feed');
                $(".mark-read").attr("title", chrome.i18n.getMessage("MarkAsRead"));
                $(".timeago").timeago();
            }
        }
    });
}

function markAsRead(link){
    if (backgroundPage.appGlobal.options.markReadOnClick === true && link.hasClass("title") === true) {
        backgroundPage.markAsRead(link.closest(".item").data("id"));
    }
}

$("#login").click(function () {
    backgroundPage.updateToken();
});

//using "mousedown" instead of "click" event to process middle button click.
$("#feed").on("mousedown", "a", function (event) {
    var link = $(this);

    switch(event.which){
        //left button click - open tab
        case 1:{
            chrome.tabs.create({url: link.attr("href") }, function (feedTab) {
                markAsRead(link);
            });
            break;
        }
        //middle button click - just mark as read (tab opens without chrome.tabs.create on the background)
        case 2: {
            markAsRead(link);
        }
    }
});

$("#website").on("click", function (event) {
    chrome.tabs.create({url: "http://cloud.feedly.com" }, function (feedTab) {});
});

$("#feed").on("click", ".mark-read", function (event) {
    var feed = $(this).closest(".item");
    feed.fadeOut().attr("data-is-read", "true");
    backgroundPage.markAsRead(feed.data("id"), function(){
        if($("#feed").find(".item[data-is-read!='true']").size() === 0){
            renderFeeds();
        }
    });
});

$(document).ready(function(){
    //If we support this localization of timeago, then insert script with it
    if (supportedTimeAgoLocales.indexOf(window.navigator.language) !== -1) {
        //Trying load localization for jQuery.timeago
        $.getScript("/scripts/timeago/locales/jquery.timeago." + window.navigator.language + ".js", function () {
            renderFeeds();
        });
    }else{
        renderFeeds();
    }
});