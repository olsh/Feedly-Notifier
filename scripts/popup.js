var backgroundPage = chrome.extension.getBackgroundPage();

$(function () {
    var items = backgroundPage.appGlobal.unreadItems;
    if (backgroundPage.appGlobal.isLoggedIn === false) {
        $("body").children("div").hide();
        $("#login").show();
    } else if (items.length === 0) {
        $("body").children("div").hide();
        $("#feed-empty").show();
    } else {
        $("body").children("div").hide();
        $("#feed").show();
        $('#entryTemplate').tmpl(items).appendTo('#feed');
        if(backgroundPage.appGlobal.options.compactPopupMode === true){
            $(".content").hide();
        }
    }
});

$("#login").click(function () {
    backgroundPage.updateToken();
});

$("#feed").on("click", "a.title", function (event) {
    var feedLink = $(this);
    chrome.tabs.create({url: feedLink.attr("href") }, function (feedTab) {
        if (backgroundPage.appGlobal.options.markReadOnClick === true) {
            backgroundPage.markAsRead(feedLink.closest(".item").data("id"));
        }
    });
});

$("#feed").on("click", "input.mark-read", function (event) {
    var feed = $(this).closest(".item");
    backgroundPage.markAsRead(feed.data("id"));
    feed.fadeOut();
});