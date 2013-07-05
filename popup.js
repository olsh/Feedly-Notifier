$(function(){
	$("#login").click(function(){
		chrome.extension.getBackgroundPage().updateToken();
	});

	var items = chrome.extension.getBackgroundPage().appGlobal.unreadItems;
	
	if (items != null) {
		console.log("output items");
		console.log(items);
		$('#entryTemplate').tmpl(items).appendTo('#feed');
	}
});