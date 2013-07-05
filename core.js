var appGlobal = {
    feedlyApiClient: null,
    icons: {
        default: "/images/icon.png",
        inactive: "/images/icon_inactive.png"
    },
    defaultValues: {
		updateInterval : 1
	},
	unreadItems: [{
			title: 'Test blog 1',
			url: 'http://ya.ru',
			blog: '.NET blog'
		}]
};

//Event handlers
chrome.runtime.onInstalled.addListener(function(details) {
    chrome.storage.sync.set({ updateInterval: appGlobal.defaultValues.updateInterval }, function () { });
    intialize();
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    intialize();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
    checkUnread();
});

chrome.runtime.onStartup.addListener(function () {
    intialize();
});

//Initialization all parameters and run news check
function intialize() {    
    chrome.storage.sync.get(null, function(items){
        appGlobal.feedlyApiClient = new FeedlyApiClient(items.accessToken);
        startSchedule(items.updateInterval);
    });
}

function startSchedule(updateInterval) {    
    chrome.alarms.create("checkUnread", {
        when: Date.now(),
        periodInMinutes: updateInterval === undefined ? appGlobal.defaultValues.updateInterval : +updateInterval
    });
}

function stopSchedule() {
    chrome.alarms.clearAll();
}

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
            stopSchedule();
        }
    });
}

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
}