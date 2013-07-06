var appGlobal = {
    feedlyApiClient: new FeedlyApiClient(),
    icons: {
        default: "/images/icon.png",
        inactive: "/images/icon_inactive.png"
    },
    options: {
        updateInterval: 1,
        markReadOnClick: true,
        accessToken: ""
    },
    unreadItems: [],
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
    checkUnread();
});

chrome.runtime.onStartup.addListener(function () {
    readOptions(initialize);
});

/* Initialization all parameters and run news check */
function initialize() {
    appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;
    startSchedule(appGlobal.options.updateInterval);
}

function startSchedule(updateInterval) {
    chrome.alarms.create("checkUnread", {
        when: Date.now(),
        periodInMinutes: updateInterval
    });
}

function stopSchedule() {
    chrome.alarms.clearAll();
}

function checkUnread() {
    appGlobal.feedlyApiClient.get("markers/counts", null, function (response) {
        var unreadCounts = response.unreadcounts;
        if (response.errorCode === undefined) {
            var max = 0;
            var categoryForFetching;
            for (var i = 0; i < unreadCounts.length; i++) {
                if (max < unreadCounts[i].count) {
                    max = unreadCounts[i].count;

                    //Search category(global or uncategorized) with max feeds for fetching
                    categoryForFetching = unreadCounts[i].id;
                }

            }
            setFeedsCounter(max);
            chrome.browserAction.setIcon({ path: appGlobal.icons.default }, function () {
            });
            fetchEntries(categoryForFetching);
            appGlobal.isLoggedIn = true;
        } else {
            setFeedsCounter(0);
            chrome.browserAction.setIcon({ path: appGlobal.icons.inactive }, function () {
            });
            stopSchedule();
            appGlobal.isLoggedIn = false;
        }
    });
}

function fetchEntries(categoryId) {
    appGlobal.feedlyApiClient.get("streams/" + encodeURIComponent(categoryId) + "/contents", {
        unreadOnly: true
    }, function (response) {
        if (response.errorCode === undefined) {
            appGlobal.unreadItems = response.items.map(function (item) {
                return {
                    title: item.title,
                    blog: item.origin.title,
                    id: item.id,
                    url: item.alternate[0].href
                };
            });
        }
    });
}

function markAsRead(feedId) {
    appGlobal.feedlyApiClient.post("markers", null, {
        action: "markAsRead",
        type: "entries",
        entryIds: [feedId]
    }, function (response) {
        if (response.errorCode !== undefined) {
            var indexFeedForRemove;
            for (var i = 0; i < appGlobal.unreadItems.length; i++) {
                if (appGlobal.unreadItems[i].id === feedId) {
                    indexFeedForRemove = i;
                    break;
                }
            }

            //Remove feed from unreadItems and update badge
            if (indexFeedForRemove !== undefined) {
                appGlobal.unreadItems.splice(indexFeedForRemove, 1);
                chrome.browserAction.getBadgeText({}, function (feedsCount) {
                    feedsCount = +feedsCount;
                    if (feedsCount > 0) {
                        setFeedsCounter(--feedsCount);
                    }
                });
            }
        }
    });
}

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

function setFeedsCounter(number) {
    number = +number;
    chrome.browserAction.setBadgeText({ text: String(number > 0 ? number : "")});
}