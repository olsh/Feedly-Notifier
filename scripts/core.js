"use strict";

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
        hideNotificationDelay: 10, //seconds
        showFullFeedContent: false,
        maxNotificationsCount: 50,
        openSiteOnIconClick: false,
        feedlyUserId: "",
        abilitySaveFeeds: false,
        maxNumberOfFeeds: 20,
        forceUpdateFeeds: false
    },
    //Names of options after changes of which scheduler will be initialized
    criticalOptionNames: ["updateInterval", "accessToken", "showFullFeedContent", "openSiteOnIconClick", "maxNumberOfFeeds", "abilitySaveFeeds"],
    cachedFeeds: [],
    cachedSavedFeeds: [],
    isLoggedIn: false,
    intervalId: 0
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
    var callback;

    for (var optionName in changes) {
        if (appGlobal.criticalOptionNames.indexOf(optionName) !== -1) {
            callback = initialize;
            break;
        }
    }
    readOptions(callback);
});

chrome.runtime.onStartup.addListener(function () {
    readOptions(initialize);
});

/* Listener for adding or removing feeds on the feedly website */
chrome.webRequest.onCompleted.addListener(function (details) {
    if (details.method === "POST" || details.method === "DELETE") {
        updateFeeds();
    }
}, {urls: ["*://cloud.feedly.com/v3/subscriptions*", "*://cloud.feedly.com/v3/markers?*ct=feedly.desktop*"]});

/* Listener for adding or removing saved feeds */
chrome.webRequest.onCompleted.addListener(function (details) {
    if (details.method === "PUT" || details.method === "DELETE") {
        updateSavedFeeds();
    }
}, {urls: ["*://cloud.feedly.com/v3/tags*global.saved*"]});

chrome.browserAction.onClicked.addListener(function () {
    openUrlInNewTab("http://feedly.com", true);
});

/* Initialization all parameters and run feeds check */
function initialize() {
    if (appGlobal.options.openSiteOnIconClick) {
        chrome.browserAction.setPopup({popup: ""});
    } else {
        chrome.browserAction.setPopup({popup: "popup.html"});
    }
    appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;
    startSchedule(appGlobal.options.updateInterval);
}

function startSchedule(updateInterval) {
    stopSchedule();
    updateFeeds();
    appGlobal.intervalId = setInterval(updateFeeds, updateInterval * 60000);
}

function stopSchedule() {
    clearInterval(appGlobal.intervalId);
}

/* Sends desktop notifications */
function sendDesktopNotification(feeds) {
    var notifications = [];
    //if notifications too many, then to show only count
    if (feeds.length > appGlobal.options.maxNotificationsCount) {
        //We can detect only limit count of new feeds at time, but actually count of feeds may be more
        var count = feeds.length === appGlobal.options.maxNumberOfFeeds ? chrome.i18n.getMessage("many") : feeds.length.toString();
        var notification = window.webkitNotifications.createNotification(
            appGlobal.icons.defaultBig, chrome.i18n.getMessage("NewFeeds"), chrome.i18n.getMessage("YouHaveNewFeeds", count));
        notification.show();
        notifications.push(notification);
    } else {
        for (var i = 0; i < feeds.length; i++) {
            var notification = window.webkitNotifications.createNotification(
                feeds[i].blogIcon, feeds[i].blog, feeds[i].title);

            //Open new tab on click and close notification
            notification.url = feeds[i].url;
            notification.feedId = feeds[i].id;
            notification.onclick = function (e) {
                var target = e.target;
                target.cancel();
                openUrlInNewTab(target.url, true);
                if (appGlobal.options.markReadOnClick) {
                    markAsRead([target.feedId]);
                }
            };
            notification.show();
            notifications.push(notification);
        }
    }

    //Hide notifications after delay
    if (appGlobal.options.hideNotificationDelay > 0) {
        setTimeout(function () {
            for (i = 0; i < notifications.length; i++) {
                notifications[i].cancel();
            }
        }, appGlobal.options.hideNotificationDelay * 1000);
    }
}

/* Opens new tab, if tab is being opened when no active window (i.e. background mode)
 * then creates new window and adds tab in the end of it
 * url for open
 * active when is true, then tab will be active */
function openUrlInNewTab(url, active) {
    chrome.windows.getAll({}, function (windows) {
        if (windows.length < 1) {
            chrome.windows.create({focused: true}, function (window) {
                chrome.tabs.create({url: url, active: active }, function (feedTab) {
                });
            });
        } else {
            chrome.tabs.create({url: url, active: active }, function (feedTab) {
            });
        }
    });
}

/* Removes feeds from cache by feed ID */
function removeFeedFromCache(feedId) {
    var indexFeedForRemove;
    for (var i = 0; i < appGlobal.cachedFeeds.length; i++) {
        if (appGlobal.cachedFeeds[i].id === feedId) {
            indexFeedForRemove = i;
            break;
        }
    }

    //Remove feed from cached feeds
    if (indexFeedForRemove !== undefined) {
        appGlobal.cachedFeeds.splice(indexFeedForRemove, 1);
    }
}

/* Returns only new feeds and set date of last feed
 * The callback parameter should specify a function that looks like this:
 * function(object newFeeds) {...};*/
function filterByNewFeeds(feeds, callback) {
    chrome.storage.local.get("lastFeedTimeTicks", function (options) {
        var lastFeedTime;

        if (options.lastFeedTimeTicks) {
            lastFeedTime = new Date(options.lastFeedTimeTicks);
        } else {
            lastFeedTime = new Date(1971, 0, 1);
        }

        var newFeeds = [];
        var maxFeedTime = lastFeedTime;

        for (var i = 0; i < feeds.length; i++) {
            if (feeds[i].date > lastFeedTime) {
                newFeeds.push(feeds[i]);
                if (feeds[i].date > maxFeedTime) {
                    maxFeedTime = feeds[i].date;
                }
            }
        }

        chrome.storage.local.set({ lastFeedTimeTicks: maxFeedTime.getTime() }, function () {
            if (typeof callback === "function") {
                callback(newFeeds);
            }
        });
    });
}

/* Update saved feeds and stores its in cache */
function updateSavedFeeds(callback) {
    if (appGlobal.options.feedlyUserId) {
        appGlobal.feedlyApiClient.request("streams/" + encodeURIComponent("user/" + appGlobal.options.feedlyUserId + "/tag/global.saved") + "/contents", {
            onSuccess: function (response) {
                appGlobal.cachedSavedFeeds = parseFeeds(response);
                if (typeof callback === "function") {
                    callback();
                }
            }
        });
    }
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete
 * If silentUpdate is true, then notifications will not be shown
 * */
function updateFeeds(callback, silentUpdate) {
    appGlobal.feedlyApiClient.request("markers/counts", {
        onSuccess: function (response) {
            setActiveStatus();

            var unreadCounts = response.unreadcounts;
            var unreadFeedsCount = -1;
            var globalCategoryId = "";
            var userIdRegex = /user\/(.+?)\/category/i;

            for (var i = 0; i < unreadCounts.length; i++) {
                if (unreadFeedsCount < unreadCounts[i].count) {
                    unreadFeedsCount = unreadCounts[i].count;

                    //Search category(global or uncategorized) with max feeds
                    globalCategoryId = unreadCounts[i].id;
                }
                //Search Feedly user id
                if (!appGlobal.options.feedlyUserId && appGlobal.options.abilitySaveFeeds) {
                    //Search user id
                    var matches = userIdRegex.exec(unreadCounts[i].id);
                    if (matches) {
                        appGlobal.options.feedlyUserId = matches[1];
                        //Update cache when update feedlyUserId
                        updateSavedFeeds();
                    }
                }
            }
            chrome.browserAction.setBadgeText({ text: String(unreadFeedsCount > 0 ? unreadFeedsCount : "")});

            if (appGlobal.options.showDesktopNotifications || !appGlobal.options.openSiteOnIconClick) {
                appGlobal.feedlyApiClient.request("streams/" + encodeURIComponent(globalCategoryId) + "/contents", {
                    parameters: {
                        unreadOnly: true,
                        count: appGlobal.options.maxNumberOfFeeds
                    },
                    onSuccess: function (response) {
                        appGlobal.cachedFeeds = parseFeeds(response);
                        filterByNewFeeds(appGlobal.cachedFeeds, function (newFeeds) {
                            if (appGlobal.options.showDesktopNotifications && !silentUpdate) {
                                sendDesktopNotification(newFeeds);
                            }
                        });
                        if (typeof callback === "function") {
                            callback();
                        }
                    },
                    onAuthorizationRequired: function () {
                        setInactiveStatus();
                        if (typeof callback === "function") {
                            callback();
                        }
                    }
                });
            }
        },
        onAuthorizationRequired: function () {
            setInactiveStatus();
            if (typeof  callback === "function") {
                callback();
            }
        }
    });
}

/* Stops scheduler, sets badge as inactive and resets counter */
function setInactiveStatus() {
    chrome.browserAction.setIcon({ path: appGlobal.icons.inactive }, function () {
    });
    chrome.browserAction.setBadgeText({ text: ""});
    appGlobal.cachedFeeds = [];
    appGlobal.isLoggedIn = false;
    appGlobal.options.feedlyUserId = "";
    stopSchedule();
}

/* Sets badge as active */
function setActiveStatus() {
    chrome.browserAction.setIcon({ path: appGlobal.icons.default }, function () {
    });
    appGlobal.isLoggedIn = true;
}

/* Converts feedly response to feeds */
function parseFeeds(feedlyResponse) {
    var feeds = feedlyResponse.items.map(function (item) {

        var blogUrl;
        try {
            blogUrl = item.origin.htmlUrl.match(/http(?:s)?:\/\/[^/]+/i).pop();
        } catch (exception) {
            blogUrl = "#";
        }

        //Set content
        var content = "";
        var contentDirection = "";
        if (appGlobal.options.showFullFeedContent) {
            if (item.content !== undefined) {
                content = item.content.content;
                contentDirection = item.content.direction;
            }
        }
        if (content === "") {
            if (item.summary !== undefined) {
                content = item.summary.content;
                contentDirection = item.summary.direction;
            }
        }

        //Set title
        var title = "";
        var titleDirection = "";
        if (item.title !== undefined) {
            if (item.title.indexOf("direction:rtl") !== -1) {
                //Feedly wraps rtl titles in div, we remove div because desktopNotification supports only text
                title = item.title.replace(/<\/?div.*?>/gi, "");
                titleDirection = "rtl";
            } else {
                title = item.title;
            }
        }

        var isSaved = false;
        if (item.tags) {
            for (var i = 0; i < item.tags.length; i++) {
                if (item.tags[i].id.search(/global\.saved$/i) !== -1) {
                    isSaved = true;
                    break;
                }
            }
        }

        return {
            title: title,
            titleDirection: titleDirection,
            url: item.alternate === undefined || item.alternate[0] === undefined ? "" : item.alternate[0].href,
            blog: item.origin === undefined ? "" : item.origin.title,
            blogUrl: blogUrl,
            blogIcon: "https://www.google.com/s2/favicons?domain=" + blogUrl + "&alt=feed",
            id: item.id,
            content: content,
            contentDirection: contentDirection,
            isoDate: item.crawled === undefined ? "" : new Date(item.crawled).toISOString(),
            date: item.crawled === undefined ? "" : new Date(item.crawled),
            isSaved: isSaved
        };
    });
    return feeds;
}

/* Returns feeds from the cache.
 * If the cache is empty, then it will be updated before return
 * forceUpdate, when is true, then cache will be updated
 */
function getFeeds(forceUpdate, callback) {
    if (appGlobal.cachedFeeds.length > 0 && !forceUpdate) {
        callback(appGlobal.cachedFeeds.slice(0), appGlobal.isLoggedIn);
    } else {
        updateFeeds(function () {
            callback(appGlobal.cachedFeeds.slice(0), appGlobal.isLoggedIn);
        }, true);
    }
}

/* Returns saved feeds from the cache.
 * If the cache is empty, then it will be updated before return
 * forceUpdate, when is true, then cache will be updated
 */
function getSavedFeeds(forceUpdate, callback) {
    if (appGlobal.cachedSavedFeeds.length > 0 && !forceUpdate) {
        callback(appGlobal.cachedSavedFeeds.slice(0), appGlobal.isLoggedIn);
    } else {
        updateSavedFeeds(function () {
            callback(appGlobal.cachedSavedFeeds.slice(0), appGlobal.isLoggedIn);
        }, true);
    }
}

/* Marks feed as read, remove it from the cache and decrement badge.
 * array of the ID of feeds
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
function markAsRead(feedIds, callback) {
    appGlobal.feedlyApiClient.request("markers", {
        body: {
            action: "markAsRead",
            type: "entries",
            entryIds: feedIds
        },
        method: "POST",
        onSuccess: function () {
            for (var i = 0; i < feedIds.length; i++) {
                removeFeedFromCache(feedIds[i]);
            }
            chrome.browserAction.getBadgeText({}, function (feedsCount) {
                feedsCount = +feedsCount;
                if (feedsCount > 0) {
                    feedsCount -= feedIds.length;
                    chrome.browserAction.setBadgeText({ text: String(feedsCount > 0 ? feedsCount : "")});
                }
            });
            if (typeof callback === "function") {
                callback(true);
            }
        },
        onAuthorizationRequired: function () {
            setInactiveStatus();
            if (typeof callback === "function") {
                callback(false);
            }
        }
    });
}

/* Save feed or unsave it.
 * feed ID
 * if saveFeed is true, then save feed, else unsafe it
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
function toggleSavedFeed(feedId, saveFeed, callback) {
    if (saveFeed) {
        appGlobal.feedlyApiClient.request("tags/" + encodeURIComponent("user/" + appGlobal.options.feedlyUserId + "/tag/global.saved"), {
            method: "PUT",
            body: {
                entryId: feedId
            },
            onSuccess: function (response) {
                if (typeof callback === "function") {
                    callback(true);
                }
            },
            onAuthorizationRequired: function () {
                if (typeof callback === "function") {
                    callback(false);
                }
            }
        });
    } else {
        appGlobal.feedlyApiClient.request("tags/" + encodeURIComponent("user/" + appGlobal.options.feedlyUserId + "/tag/global.saved") + "/" + encodeURIComponent(feedId), {
            method: "DELETE",
            onSuccess: function (response) {
                if (typeof callback === "function") {
                    callback(true);
                }
            },
            onAuthorizationRequired: function () {
                if (typeof callback === "function") {
                    callback(false);
                }
            }
        });
    }

    //Update state in the cache
    for (var i = 0; i < appGlobal.cachedFeeds.length; i++) {
        if (appGlobal.cachedFeeds[i].id === feedId) {
            appGlobal.cachedFeeds[i].isSaved = saveFeed;
            break;
        }
    }
}

/* Opens feedly site and if user are logged in,
 * then read access token and stores in chrome.storage */
function getAccessToken() {
    chrome.tabs.create({url: "http://cloud.feedly.com" }, function (feedlytab) {
        chrome.webRequest.onBeforeSendHeaders.addListener(function processRequest(details) {
                var accessToken;

                for (var i = 0; i < details.requestHeaders.length; i++) {
                    if (details.requestHeaders[i].name === "X-Feedly-Access-Token") {
                        accessToken = details.requestHeaders[i].value;
                        break;
                    }
                    if (details.requestHeaders[i].name === "Cookie") {
                        var cookies = details.requestHeaders[i].value;
                        try {
                            var feedlyParametersRegex = /session@cloud=({.+?})/i;
                            var feedlyParameters = JSON.parse(feedlyParametersRegex.exec(cookies)[1]);
                            if(feedlyParameters.feedlyExpirationTime > new Date()){
                                accessToken = feedlyParameters.feedlyToken;
                            }
                            break;
                        } catch (exception) {

                        }
                    }
                }

                if (accessToken) {
                    chrome.storage.sync.set({ accessToken: accessToken }, function () {
                    });
                    chrome.webRequest.onBeforeSendHeaders.removeListener(processRequest);
                }
            },
            {urls: ["<all_urls>"], tabId: feedlytab.id}, ["requestHeaders"]);

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