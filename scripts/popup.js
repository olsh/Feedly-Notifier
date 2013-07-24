var backgroundPage = chrome.extension.getBackgroundPage()

var popupGlobal = {
    //Determines lists of supported jQuery.timeago localizations, default localization is en
    supportedTimeAgoLocales : ["ru", "fr"],
    feeds : []
}

function renderFeeds(){
    showLoader();
    backgroundPage.getFeeds(false, function (feeds, isLoggedIn) {
        $("#loading").hide();
        popupGlobal.feeds = feeds;
        if (isLoggedIn === false) {
            showLogin();
        } else {
            $("#popup-content").show();
            $("#website").text(chrome.i18n.getMessage("FeedlyWebsite"));

            if (feeds.length === 0) {
                $("#feed-empty").html(chrome.i18n.getMessage("NoUnreadArticles"));
                $("#all-read-section").hide();
            } else {
                $("#feed-empty").html("");
                $('#entryTemplate').tmpl(feeds).appendTo('#feed');
                $(".mark-read").attr("title", chrome.i18n.getMessage("MarkAsRead"));
                $("#mark-all-read").text(chrome.i18n.getMessage("MarkAllAsRead"));
                $("#all-read-section").show();
                $(".show-content").attr("title", chrome.i18n.getMessage("More")).show();
                $(".timeago").timeago();
            }
        }
    });
}

function markAsRead(feedIds){
    for(var i = 0; i < feedIds.length; i++){
        var feed = $(".item[data-id='" + feedIds[i] + "']");
        feed.fadeOut().attr("data-is-read", "true");
    }
    //Show loader if all feeds were read
    if($("#feed").find(".item[data-is-read!='true']").size() === 0){
        showLoader();
    }
    backgroundPage.markAsRead(feedIds, function(isLoggedIn){
        if($("#feed").find(".item[data-is-read!='true']").size() === 0){
            renderFeeds();
        }
    });
}

function showLoader(){
    $("body").children("div").hide();
    $("#loading").show();
}

function showLogin(){
    $("body").children("div").hide();
    $("#login-btn").text(chrome.i18n.getMessage("Login"));
    $("#login").show();
}

$("#login").click(function () {
    backgroundPage.getAccessToken();
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
    markAsRead(feedIds);
});

$("#feed").on("click", ".mark-read", function (event) {
    var feed = $(this).closest(".item");
    markAsRead([feed.data("id")]);
});

$("#feed").on("click", ".show-content", function(){
    var $this = $(this);
    var feed = $this.closest(".item");
    var contentContainer = feed.find(".content");
    var feedId = feed.data("id");
    if(contentContainer.html() === ""){
        var content;
        for(var i = 0; i < popupGlobal.feeds.length; i++){
            if(popupGlobal.feeds[i].id === feedId){
                content = popupGlobal.feeds[i].content
            }
        }
        if(content){
            contentContainer.html(content);
            //For open new tab without closing popup
            contentContainer.find("a").each(function(key, value){
                var link = $(value);
                link.data("link", link.attr("href"));
                link.attr("href", "javascript:void(0)");
            });
        }
    }
    contentContainer.slideToggle(function () {
        $this.css("background-position", contentContainer.is(":visible") ? "-288px -120px" :"-313px -119px");
        if (contentContainer.is(":visible") && contentContainer.text().length > 350){
            $(".item").css("width",  "700px");
            $(".article-title").css("width", "660px");
        } else{
            $(".item").css("width",  "350px");
            $(".article-title").css("width", "310px");
        }
    });
});

/* Manually feeds update */
$("#feedly").on("click", "#update-feeds", function(){
    backgroundPage.getFeeds(true, function(feeds, isLoggedIn){
        if(isLoggedIn){
            //Backward loop for chronological sequence
            for(var i = feeds.length - 1; i >= 0; i--){
                if($(".item[data-id='" + feeds[i].id + "']").size() === 0){
                    $('#entryTemplate').tmpl(feeds[i]).fadeIn().prependTo('#feed').find(".timeago").timeago();
                    popupGlobal.feeds.push(feeds[i]);
                }
            }
        }else{
            showLogin();
        }
    });
});

$(document).ready(function(){
    //If we support this localization of timeago, then insert script with it
    if (popupGlobal.supportedTimeAgoLocales.indexOf(window.navigator.language) !== -1) {
        //Trying load localization for jQuery.timeago
        $.getScript("/scripts/timeago/locales/jquery.timeago." + window.navigator.language + ".js", function () {
            renderFeeds();
        });
    }else{
        renderFeeds();
    }
});