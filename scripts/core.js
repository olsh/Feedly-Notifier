var appGlobal = {
    feedlyApiClient: new FeedlyApiClient(),
    icons: {
        default: "/images/icon.png",
        inactive: "/images/icon_inactive.png"
    },
    options: {
        updateInterval: 1,
        markReadOnClick: true,
        accessToken: "",
        compactPopupMode: true
    },
    cachedFeeds: [],
    isLoggedIn: false
};

// #Event handlers
chrome.runtime.onInstalled.addListener(function (details) {
    //Trying read old options (mostly access token) if possible
    readOptions(function () {
        //Write all options in chrome storage and initialize application
        writeOptions(initialize);
    });
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    readOptions(initialize);
});

chrome.alarms.onAlarm.addListener(function (alarm) {
    updateFeeds();
});

chrome.runtime.onStartup.addListener(function () {
    readOptions(initialize);
});

/* Initialization all parameters and run feeds check */
function initialize() {
    appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;
    startSchedule(appGlobal.options.updateInterval);
}

function startSchedule(updateInterval) {
    chrome.alarms.create("updateFeeds", {
        when: Date.now(),
        periodInMinutes: updateInterval
    });
}

function stopSchedule() {
    chrome.alarms.clearAll();
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete */
function updateFeeds(callback) {
    getUnreadFeedsCount(function (unreadFeedsCount, globalCategoryId, isLoggedIn) {
        chrome.browserAction.setBadgeText({ text: String(unreadFeedsCount > 0 ? unreadFeedsCount : "")});
        appGlobal.isLoggedIn = isLoggedIn;
        if (isLoggedIn === true) {
            chrome.browserAction.setIcon({ path: appGlobal.icons.default }, function () {
            });
            fetchEntries(globalCategoryId, function (feeds, isLoggedIn) {
                appGlobal.isLoggedIn = isLoggedIn;
                if (isLoggedIn === true) {
                    appGlobal.cachedFeeds = feeds;
                } else {
                    appGlobal.cachedFeeds = [];
                }
                if (typeof callback === "function") {
                    callback();
                }
            });
        } else {
            chrome.browserAction.setIcon({ path: appGlobal.icons.inactive }, function () {
            });
            stopSchedule();
            if (typeof callback === "function") {
                callback();
            }
        }
    });
}

/* Returns feeds from the cache.
 If the cache is empty, then it will be updated before return */
function getFeeds(callback){
     if(appGlobal.cachedFeeds.length > 0){
         callback(appGlobal.cachedFeeds, appGlobal.isLoggedIn);
     }else{
         updateFeeds(function(){
             callback(appGlobal.cachedFeeds, appGlobal.isLoggedIn);
         });
     }
}

/* Returns unread feeds count.
 * The callback parameter should specify a function that looks like this:
 * function(number unreadFeedsCount, string globalCategoryId, boolean isLoggedIn) {...};*/
function getUnreadFeedsCount(callback) {
    appGlobal.feedlyApiClient.get("markers/counts", null, function (response) {
        var unreadCounts = response.unreadcounts;

        var unreadFeedsCount = -1;
        var globalCategoryId = "";
        var isLoggedIn;
        if (response.errorCode === undefined) {
            for (var i = 0; i < unreadCounts.length; i++) {
                if (unreadFeedsCount < unreadCounts[i].count) {
                    unreadFeedsCount = unreadCounts[i].count;

                    //Search category(global or uncategorized) with max feeds
                    globalCategoryId = unreadCounts[i].id;
                }
            }
            isLoggedIn = true;
        } else {
            isLoggedIn = false;
        }
        if(typeof  callback === "function"){
            callback(Number(unreadFeedsCount), globalCategoryId, isLoggedIn);
        }
    });
}

/* Download unread feeds.
 * categoryId is feedly category ID.
 * The callback parameter should specify a function that looks like this:
 * function(array feeds, boolean isLoggedIn) {...};*/
function fetchEntries(categoryId, callback) {
    appGlobal.feedlyApiClient.get("streams/" + encodeURIComponent(categoryId) + "/contents", {
        unreadOnly: true
    }, function (response) {
        var isLoggedIn;
        var feeds = [];
        if (response.errorCode === undefined) {
            feeds = response.items.map(function (item) {
                var blogUrl;
                try{
                    blogUrl = item.origin.htmlUrl.match(/http(?:s)?:\/\/[^/]+/i).pop();
                }catch(exception) {
                    blogUrl = "#";
                }
                return {
                    title: item.title,
                    url: item.alternate === undefined || item.alternate[0] === undefined ? "" : item.alternate[0].href,
                    blog: item.origin === undefined ? "" : item.origin.title,
                    blogUrl: blogUrl,
                    id: item.id,
                    content: item.summary === undefined || appGlobal.options.compactPopupMode ? "" : item.summary.content
                };
            });
            isLoggedIn = true;
        }else{
            isLoggedIn = false;
        }
        if(typeof callback === "function"){
            callback(feeds, isLoggedIn);
        }
    });
}

/* Marks feed as read, remove it from the cache and decrement badge.
 * categoryId is feedly category ID.
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
function markAsRead(feedId, callback) {
    appGlobal.feedlyApiClient.post("markers", null, {
        action: "markAsRead",
        type: "entries",
        entryIds: [feedId]
    }, function (response) {
        var isLoggedIn;
        if (response.errorCode !== undefined) {
            var indexFeedForRemove;
            for (var i = 0; i < appGlobal.cachedFeeds.length; i++) {
                if (appGlobal.cachedFeeds[i].id === feedId) {
                    indexFeedForRemove = i;
                    break;
                }
            }

            //Remove feed from unreadItems and update badge
            if (indexFeedForRemove !== undefined) {
                appGlobal.cachedFeeds.splice(indexFeedForRemove, 1);
                chrome.browserAction.getBadgeText({}, function (feedsCount) {
                    feedsCount = +feedsCount;
                    if (feedsCount > 0) {
                        feedsCount--;
                        chrome.browserAction.setBadgeText({ text: String(feedsCount > 0 ? feedsCount : "")});
                    }
                });
            }
            isLoggedIn = true;
        }else{
            isLoggedIn = false;
        }
        if(typeof callback === "function"){
            callback(isLoggedIn);
        }
    });
}

/* Opens feedly site and if user are logged in,
 * then read access token and stores in chrome.storage */
function updateToken() {
    chrome.tabs.create({url: "http://cloud.feedly.com" }, function (feedlytab) {
        chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
            //Execute code in feedly page context
            chrome.tabs.executeScript(tabId, { code: "JSON.parse(localStorage.getItem('session@cloud'))['feedlyToken']"}, function (result) {
                if (result === undefined || result.length !== 1) {
                    return;
                }
                chrome.storage.sync.set({ accessToken: result[0]}, function () {
                });
            });
        });
    });
}

/* Writes all application options in chrome storage and runs callback after it */
function writeOptions(callback) {
    var options = {};
    for (var option in appGlobal.options) {
        options[option] = appGlobal.options[option];
    }
    chrome.storage.sync.set(options, function () {
        if (typeof callback === "function") {
            callback();
        }
    });
}

/* Reads all options from chrome storage and runs callback after it */
function readOptions(callback) {
    chrome.storage.sync.get(null, function (options) {
        for (var optionName in options) {
            if (typeof appGlobal.options[optionName] === "boolean") {
                appGlobal.options[optionName] = Boolean(options[optionName]);
            } else if (typeof appGlobal.options[optionName] === "number") {
                appGlobal.options[optionName] = Number(options[optionName]);
            } else {
                appGlobal.options[optionName] = options[optionName];
            }
        }
        if (typeof callback === "function") {
            callback();
        }
    });
}