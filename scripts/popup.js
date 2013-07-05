var backgroundPage = chrome.extension.getBackgroundPage();

$(function(){
	$("#login").click(function(){
		chrome.extension.getBackgroundPage().updateToken();
	});

	var items = backgroundPage.appGlobal.unreadItems;
    console.log(items);
	if (items != null) {
		$('#entryTemplate').tmpl(items).appendTo('#feed');
	}
});

$("#feed").on("click", "a.title", function(event){
    var feedLink = $(this);
    chrome.tabs.create( {url: feedLink.attr("href") }, function (feedlytab){
        backgroundPage.markAsRead(feedLink.closest(".item").data("id"));
    });
});

$("#feed").on("click", "input.mark-read", function(event){
    var feedLink = $(this);
    backgroundPage.markAsRead(feedLink.closest(".item").data("id"));
});