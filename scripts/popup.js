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
    }
});

$("#login").click(function () {
    backgroundPage.updateToken();
});

$("#feed").on("click", "a", function (event) {
    var link = $(this);
    chrome.tabs.create({url: link.attr("href") }, function (feedTab) {
        if (backgroundPage.appGlobal.options.markReadOnClick === true && link.hasClass("title") === true) {
            backgroundPage.markAsRead(link.closest(".item").data("id"));
        }
    });
});

$("#feed").on("click", "input.mark-read", function (event) {
    var feed = $(this).closest(".item");
    backgroundPage.markAsRead(feed.data("id"));
    feed.fadeOut();
});