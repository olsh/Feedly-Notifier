var backgroundPage = chrome.extension.getBackgroundPage();

function renderFeeds(){
    backgroundPage.getFeeds(function(feeds, isLoggedIn){
        if (isLoggedIn === false) {
            $("body").children("div").hide();
            $("#login").show();
        } else if (feeds.length === 0) {
            $("body").children("div").hide();
            $("#feed-empty").html("All read").show();
        } else {
            $("body").children("div").hide();
            $("#feed").show();
            $('#entryTemplate').tmpl(feeds).appendTo('#feed');
            $(".timeago").timeago();
        }
    })
}

renderFeeds();

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

$("#feed").on("click", ".mark-read", function (event) {
    var feed = $(this).closest(".item");
    feed.fadeOut().attr("data-is-read", "true");
    backgroundPage.markAsRead(feed.data("id"), function(){
        if($("#feed").find(".item[data-is-read!='true']").size() === 0){
            renderFeeds();
        }
    });
});