var appGlobal = {
    feedlyApiClient: null,
    icons: {
        default: "/images/icon.png",
        inactive: "/images/icon_inactive.png"
    },
    intervalId: 0,
    intervalPeriod: 60000,
	unreadItems: [{
			title: 'Test blog 1',
			url: 'http://ya.ru',
			blog: '.NET blog'
		}]
};

chrome.storage.sync.get(null, function(items){

    appGlobal.feedlyApiClient = new FeedlyApiClient(items.accessToken);

    chrome.browserAction.onClicked.addListener(function() {
	    updateToken();
    });

    checkUnread();
    appGlobal.intervalId = setInterval(checkUnread, appGlobal.intervalPeriod);
});

chrome.storage.onChanged.addListener(function(changes, areaName) {
    var accessTokenChange = changes.accessToken;
	if(accessTokenChange !== undefined && accessTokenChange.newValue !== undefined){
		appGlobal.feedlyApiClient.accessToken = accessTokenChange.newValue;
		console.log("check unread");
		checkUnread();
		appGlobal.intervalId = setInterval(checkUnread, appGlobal.intervalPeriod);
	}
});

function checkUnread(){
    appGlobal.feedlyApiClient.get("markers/counts", null, function(response){
        var unreadCounts = response.unreadcounts;
        if(response.errorCode === undefined){
            var max = 0;
            for	(var i = 0; i < unreadCounts.length; i++){
                if(max < unreadCounts[i].count){
                    max = unreadCounts[i].count;
                }
            }
            chrome.browserAction.setBadgeText({ text : String(max > 0 ? max : "")});
            chrome.browserAction.setIcon({ path : appGlobal.icons.default }, function (){});
			console.log("get items");
			fetchEntries();
        }else{
            chrome.browserAction.setBadgeText({ text : String("")});
            chrome.browserAction.setIcon({ path : appGlobal.icons.inactive }, function (){});
            clearInterval(appGlobal.intervalId);
        }
    });
};

function fetchEntries(){
	var items = [
		{
			title: 'Test blog 1',
			url: 'http://ya.ru',
			blog: '.NET blog'
		},
		{
			title: 'Test blog 2',
			url: 'http://google.com',
			blog: 'PHP blog'
		}
	];
	
	appGlobal.unreadItems = items;
	console.log(appGlobal.unreadItems.length);
}

function updateToken(){
    chrome.tabs.create( {url: "http://cloud.feedly.com" }, function (feedlytab){
        chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
            //Execute code in feedly page context
            chrome.tabs.executeScript(tabId, { code : "localStorage.getItem('session@cloud')"}, function(results){
                if(results === undefined || results.length !== 1){
                    return;
                }
                var accessToken = JSON.parse(results[0])['feedlyToken'];
                if(accessToken !== undefined){
                    chrome.storage.sync.set( { accessToken : accessToken}, function(){});
                }
            });
        });
    });
};