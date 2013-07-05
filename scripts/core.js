var appGlobal = {
    feedlyApiClient: new FeedlyApiClient(),
    icons: {
        default: "/images/icon.png",
        inactive: "/images/icon_inactive.png"
    },
    defaultValues: {
		updateInterval : 1
	},
	unreadItems: null
};

//Event handlers
chrome.runtime.onInstalled.addListener(function(details) {
    chrome.storage.sync.set({ updateInterval: appGlobal.defaultValues.updateInterval }, function () { });
    initialize();
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    initialize();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
    checkUnread();
});

chrome.runtime.onStartup.addListener(function () {
    initialize();
});

//Initialization all parameters and run news check
function initialize() {
    chrome.storage.sync.get(null, function(items){
        appGlobal.feedlyApiClient.accessToken = items.accessToken;
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
            var categoryForFetching;
            for	(var i = 0; i < unreadCounts.length; i++){
                if(max < unreadCounts[i].count){
                    max = unreadCounts[i].count;

                    //Search category(global or uncategorized) with max feeds for fetching
                    categoryForFetching = unreadCounts[i].id;
                }

            }
            chrome.browserAction.setBadgeText({ text : String(max > 0 ? max : "")});
            chrome.browserAction.setIcon({ path : appGlobal.icons.default }, function (){});
			fetchEntries(categoryForFetching);
        }else{
            chrome.browserAction.setBadgeText({ text : String("")});
            chrome.browserAction.setIcon({ path : appGlobal.icons.inactive }, function (){});
            stopSchedule();
        }
    });
}

function fetchEntries(categoryId){
    appGlobal.feedlyApiClient.get("streams/" + encodeURIComponent(categoryId) + "/contents", {
        unreadOnly : true
    }, function(response){
        if(response.errorCode === undefined) {
            appGlobal.unreadItems = response.items.map(function(item){
                return {
                    title : item.title,
                    blog : item.origin.title,
                    id : item.id,
                    url : item.alternate[0].href
                };
            });
        }else{
            appGlobal.unreadItems = null;
        }
    });
}

function markAsRead(feedId){
    appGlobal.feedlyApiClient.post("markers", null, {
        action : "markAsRead",
        type : "entries",
        entryIds : [feedId]
    },function(response){
        if(response.errorCode !== undefined) {
            //TODO: Refresh token
        }
    });
}

function updateToken(){
    chrome.tabs.create( {url: "http://cloud.feedly.com" }, function (feedlytab){
        chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
            //Execute code in feedly page context
            chrome.tabs.executeScript(tabId, { code : "JSON.parse(localStorage.getItem('session@cloud'))['feedlyToken']"}, function(results){
                if(results === undefined){
                    return;
                }
                chrome.storage.sync.set( { accessToken : results}, function(){});
            });
        });
    });
}