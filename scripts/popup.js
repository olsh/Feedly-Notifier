var backgroundPage = chrome.extension.getBackgroundPage();

//Determines lists of supported jQuery.timeago localizations, default localization is en
var supportedTimeAgoLocales = ["ru", "fr"];

function renderFeeds(){
    $("body").children("div").hide();
    $("#loading").show();
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
                $("#mark-all-read").hide();
            } else {
                $("#feed-empty").html("");
                $('#entryTemplate').tmpl(feeds).appendTo('#feed');
                $(".mark-read").attr("title", chrome.i18n.getMessage("MarkAsRead"));
                $("#mark-all-read").text(chrome.i18n.getMessage("MarkAllAsRead")).show();
                $(".timeago").timeago();
            }
        }
    });
}

function markAsRead(feedIds, callback){
    for(var i = 0; i < feedIds.length; i++){
        var feed = $(".item[data-id='" + feedIds[i] + "']");
        feed.fadeOut().attr("data-is-read", "true");
    }
    backgroundPage.markAsRead(feedIds, function(isLoggedIn){
        if(typeof callback === "function"){
            callback(isLoggedIn);
        }
    });
}

$("#login").click(function () {
    backgroundPage.updateToken();
});

//using "mousedown" instead of "click" event to process middle button click.
$("#feed").on("mousedown", "a", function (event) {
    var link = $(this);
    if(event.which === 1 || event.which === 2){
        var isActiveTab = !(event.ctrlKey || event.which === 2);
        chrome.tabs.create({url: link.data("link"), active : isActiveTab }, function (feedTab) {
            if (backgroundPage.appGlobal.options.markReadOnClick === true && link.hasClass("title") === true) {
                markAsRead([link.closest(".item").data("id")]);
            }
        });
    }
});

$("#popup-content").on("click", "#mark-all-read",function(event){
    var feedIds = [];
    $(".item").each(function(key, value){
        feedIds.push($(value).data("id"));
    });
    markAsRead(feedIds, function(){
        renderFeeds();
    });
});

$("#feed").on("click", ".mark-read", function (event) {
    var feed = $(this).closest(".item");
    markAsRead([feed.data("id")], function(){
        if($("#feed").find(".item[data-is-read!='true']").size() === 0){
            renderFeeds();
        }
    });
});

addEventListener("unload", function (event) {
    backgroundPage.togglePopup();
}, true);

$(document).ready(function(){
    backgroundPage.togglePopup();
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