var appGlobal = {
    feedlyApiClient: new FeedlyApiClient(),
    icons: {
        default: "/images/icon.png",
        inactive: "/images/icon_inactive.png",
        defaultBig: "/images/icon128.png"
    },
    options: {
        updateInterval: 2, //minutes
        markReadOnClick: true,
        accessToken: "",
        showDesktopNotifications: true,
        hideNotificationDelay: 60 //seconds
    },
    cachedFeeds: [],
    isLoggedIn: false,
    intervalId : 0,
    lastFeedTime: new Date(),
    maxNotifications: 4
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

chrome.runtime.onStartup.addListener(function () {
    readOptions(initialize);
});

function togglePopup(){
    chrome.browserAction.getPopup({},function(popup){
        if(popup){
            chrome.browserAction.setPopup({popup: ""});
        }else{
            setTimeout(function(){
                chrome.browserAction.setPopup({popup: "popup.html"});
            }, 1 * 200);
        }
    })
}

/* Initialization all parameters and run feeds check */
function initialize() {
    appGlobal.lastFeedTime = new Date();
    appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;
    startSchedule(appGlobal.options.updateInterval);
}

function startSchedule(updateInterval) {
    stopSchedule(appGlobal.intervalId);
    updateFeeds();
    appGlobal.intervalId = setInterval(updateFeeds, updateInterval * 60000)
}

function stopSchedule(intervalId) {
    clearInterval(intervalId);
}

function sendDesktopNotification(feeds){
    var notifications = [];
    if(feeds.length > 5){
        var notification = window.webkitNotifications.createNotification(
            appGlobal.icons.defaultBig, chrome.i18n.getMessage("NewFeeds"), chrome.i18n.getMessage("YouHaveUnreadFeeds", feeds.length.toString()));
        notification.show();
        notifications.push(notification);
    }else{
        for(var i = 0; i < feeds.length; i++){
            var notification = window.webkitNotifications.createNotification(
                appGlobal.icons.defaultBig, chrome.i18n.getMessage("NewFeed"), feeds[i].title);
            notification.show();
            notifications.push(notification);
        }
    }

    if(appGlobal.options.hideNotificationDelay > 0){
        setTimeout(function () {
            for(i=0; i < notifications.length; i++){
                notifications[i].cancel();
            }
        }, appGlobal.options.hideNotificationDelay * 1000);
    }
}

/* Removes feeds from cache by feed ID */
function removeFeedFromCache(feedId){
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
    }
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete
 * If silentUpdate is true, then notifications will not be shown
 * */
function updateFeeds(callback, silentUpdate) {
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
                    if (appGlobal.options.showDesktopNotifications) {
                        //Find only new feeds and set date of last feed
                        var lastFeedTime = appGlobal.lastFeedTime;
                        var newFeeds = [];
                        for (var i = 0; i < feeds.length; i++) {
                            if (feeds[i].date > appGlobal.lastFeedTime) {
                                newFeeds.push(feeds[i]);
                                if (feeds[i].date > lastFeedTime) {
                                    lastFeedTime = feeds[i].date;
                                }
                            }
                        }
                        appGlobal.lastFeedTime = lastFeedTime;
                        if(!silentUpdate ){
                            sendDesktopNotification(newFeeds);
                        }
                    }
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
         callback(appGlobal.cachedFeeds.slice(0), appGlobal.isLoggedIn);
     }else{
         updateFeeds(function(){
             callback(appGlobal.cachedFeeds.slice(0), appGlobal.isLoggedIn);
         }, true);
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
                    content: item.summary === undefined ? (item.content === undefined ? "" : item.content.content) : item.summary.content,
                    isoDate: item.crawled === undefined ? "" : new Date(item.crawled).toISOString(),
                    date: item.crawled === undefined ? "" : new Date(item.crawled)
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
 * array of the ID of feeds
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
function markAsRead(feedIds, callback) {
    appGlobal.feedlyApiClient.post("markers", null, {
        action: "markAsRead",
        type: "entries",
        entryIds: feedIds
    }, function (response) {
        var isLoggedIn;
        if (response.errorCode !== undefined) {
            for(var i = 0; i < feedIds.length; i++){
                removeFeedFromCache(feedIds[i]);
            }
            chrome.browserAction.getBadgeText({}, function (feedsCount) {
                feedsCount = +feedsCount;
                if (feedsCount > 0) {
                    feedsCount-= feedIds.length;
                    chrome.browserAction.setBadgeText({ text: String(feedsCount > 0 ? feedsCount : "")});
                }
            });
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