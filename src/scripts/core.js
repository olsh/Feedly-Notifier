"use strict";

var appGlobal = {
    feedlyApiClient: new FeedlyApiClient(),
    feedTab: null,
    icons: {
        default: {
            "19": "/images/icon.png",
            "38": "/images/icon38.png"
        },
        inactive: {
            "19": "/images/icon_inactive.png",
            "38": "/images/icon_inactive38.png"
        },
        defaultBig: "/images/icon128.png"
    },
    options: {
        _updateInterval: 10, //minutes
        _popupWidth: 380,
        _expandedPopupWidth: 650,

        markReadOnClick: true,
        accessToken: "",
        refreshToken: "",
        showDesktopNotifications: true,
        hideNotificationDelay: 10, //seconds
        showFullFeedContent: false,
        maxNotificationsCount: 5,
        openSiteOnIconClick: false,
        feedlyUserId: "",
        abilitySaveFeeds: false,
        maxNumberOfFeeds: 20,
        forceUpdateFeeds: false,
        useSecureConnection: true,
        expandFeeds: false,
        isFiltersEnabled: false,
        openFeedsInSameTab: false,
        openFeedsInBackground: true,
        filters: [],
        showCounter: true,
        playSound: false,
        oldestFeedsFirst: false,
        resetCounterOnClick: false,
        popupFontSize: 100, //percent
        showCategories: false,

        get updateInterval(){
            var minimumInterval = 10;
            return this._updateInterval >= minimumInterval ? this._updateInterval : minimumInterval;
        },
        set updateInterval(value) {
            return this._updateInterval = value;
        },
        get popupWidth() {
            var maxValue = 750;
            var minValue = 380;
            if (this._popupWidth > maxValue ) {
                return maxValue;
            }
            if (this._popupWidth < minValue){
                return minValue;
            }
            return this._popupWidth;
        },
        set popupWidth(value) {
            this._popupWidth = value;
        },
        get expandedPopupWidth() {
            var maxValue = 750;
            var minValue = 380;
            if (this._expandedPopupWidth > maxValue ) {
                return maxValue;
            }
            if (this._expandedPopupWidth < minValue){
                return minValue;
            }
            return this._expandedPopupWidth;
        },
        set expandedPopupWidth(value) {
            this._expandedPopupWidth = value;
        }
    },
    //Names of options after changes of which scheduler will be initialized
    criticalOptionNames: ["updateInterval", "accessToken", "showFullFeedContent", "openSiteOnIconClick", "maxNumberOfFeeds", "abilitySaveFeeds", "filters", "isFiltersEnabled", "showCounter", "oldestFeedsFirst", "resetCounterOnClick"],
    cachedFeeds: [],
    cachedSavedFeeds: [],
    isLoggedIn: false,
    intervalIds: [],
    clientId: "",
    clientSecret: "",
    tokenIsRefreshing: false,
    get feedlyUrl(){
        return this.options.useSecureConnection ? "https://feedly.com" : "http://feedly.com"
    },
    get savedGroup(){
        return "user/" + this.options.feedlyUserId + "/tag/global.saved";
    },
    get globalGroup(){
        return "user/" + this.options.feedlyUserId + "/category/global.all";
    },
    get globalUncategorized(){
        return "user/" + this.options.feedlyUserId + "/category/global.uncategorized";
    },
    get syncStorage(){
        // @if BROWSER='firefox'
        // Firefox doesn't support sync storage
        return chrome.storage.local;
        // @endif

        // @if BROWSER!='firefox'
        //noinspection UnreachableCodeJS
        return chrome.storage.sync;
        // @endif
    }
};

// #Event handlers
// @if BROWSER!='firefox'
chrome.runtime.onInstalled.addListener(function (details) {
    //Trying read old options (mostly access token) if possible
    readOptions(function () {
        //Write all options in chrome storage and initialize application
        writeOptions(initialize);
    });
});

chrome.runtime.onStartup.addListener(function () {
    readOptions(initialize);
});
// @endif

// @if BROWSER=='firefox'
readOptions(function () {
    //Write all options in chrome storage and initialize application
    writeOptions(initialize);
});
// @endif

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

chrome.tabs.onRemoved.addListener(function(tabId){
    if (appGlobal.feedTab && appGlobal.feedTab.id == tabId) {
        appGlobal.feedTab = null;
    }
});

/* Listener for adding or removing feeds on the feedly website */
chrome.webRequest.onCompleted.addListener(function (details) {
    if (details.method === "POST" || details.method === "DELETE") {
        updateCounter();
        updateFeeds();
    }
}, {urls: ["*://*.feedly.com/v3/subscriptions*", "*://*.feedly.com/v3/markers?*ct=feedly.desktop*"]});

/* Listener for adding or removing saved feeds */
chrome.webRequest.onCompleted.addListener(function (details) {
    if (details.method === "PUT" || details.method === "DELETE") {
        updateSavedFeeds();
    }
}, {urls: ["*://*.feedly.com/v3/tags*global.saved*"]});

chrome.browserAction.onClicked.addListener(function () {
    if (appGlobal.isLoggedIn) {
        openFeedlyTab();
        if(appGlobal.options.resetCounterOnClick){
            resetCounter();
        }
    } else {
        getAccessToken();
    }
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
    updateCounter();
    updateFeeds();
    if(appGlobal.options.showCounter){
        appGlobal.intervalIds.push(setInterval(updateCounter, updateInterval * 60000));
    }
    if (appGlobal.options.showDesktopNotifications || appGlobal.options.playSound || !appGlobal.options.openSiteOnIconClick) {
        appGlobal.intervalIds.push(setInterval(updateFeeds, updateInterval * 60000));
    }
}

function stopSchedule() {
    appGlobal.intervalIds.forEach(function(intervalId){
        clearInterval(intervalId);
    });
    appGlobal.intervalIds = [];
}

/* Sends desktop notifications */
function sendDesktopNotification(feeds) {
    var notifications = [];
    //if notifications too many, then to show only count
    if (feeds.length > appGlobal.options.maxNotificationsCount) {
        //We can detect only limit count of new feeds at time, but actually count of feeds may be more
        var count = feeds.length === appGlobal.options.maxNumberOfFeeds ? chrome.i18n.getMessage("many") : feeds.length.toString();
        var notification = new Notification(chrome.i18n.getMessage("NewFeeds"), {
                body: chrome.i18n.getMessage("YouHaveNewFeeds", count),
                icon: appGlobal.icons.defaultBig
            });
        notifications.push(notification);
    } else {
        for (var i = 0; i < feeds.length; i++) {
            notification = new Notification(feeds[i].blog,{
                body: feeds[i].title,
                icon: feeds[i].blogIcon
            });

            //Open new tab on click and close notification
            notification.url = feeds[i].url;
            notification.feedId = feeds[i].id;
            notification.onclick = function (e) {
                var target = e.target;
                target.close();
                openUrlInNewTab(target.url, true);
                if (appGlobal.options.markReadOnClick) {
                    markAsRead([target.feedId]);
                }
            };
            notifications.push(notification);
        }
    }

    //Hide notifications after delay
    if (appGlobal.options.hideNotificationDelay > 0) {
        setTimeout(function () {
            for (i = 0; i < notifications.length; i++) {
                notifications[i].close();
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

/* Opens new Feedly tab, if tab was already opened, then switches on it and reload. */
function openFeedlyTab() {
    chrome.tabs.query({url: appGlobal.feedlyUrl + "/*"}, function (tabs) {
        if (tabs.length < 1) {
            chrome.tabs.create({url: appGlobal.feedlyUrl});
        } else {
            chrome.tabs.update(tabs[0].id, {active: true});
            chrome.tabs.reload(tabs[0].id);
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

/* Plays alert sound */
function playSound(){
    var audio = new Audio("sound/alert.mp3");
    audio.play();
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

function resetCounter(){
    setBadgeCounter(0);
    chrome.storage.local.set({ lastCounterResetTime: new Date().getTime() });
}

/* Update saved feeds and stores its in cache */
function updateSavedFeeds(callback) {
    apiRequestWrapper("streams/" + encodeURIComponent(appGlobal.savedGroup) + "/contents", {
        onSuccess: function (response) {
            appGlobal.cachedSavedFeeds = parseFeeds(response);
            if (typeof callback === "function") {
                callback();
            }
        }
    });
}

/* Sets badge counter if unread feeds more than zero */
function setBadgeCounter(unreadFeedsCount) {
    if (appGlobal.options.showCounter) {
        chrome.browserAction.setBadgeText({ text: String(+unreadFeedsCount > 0 ? unreadFeedsCount : "")});
    } else {
        chrome.browserAction.setBadgeText({ text: ""});
    }
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete
 * */
function updateCounter() {
    if(appGlobal.options.resetCounterOnClick){
        chrome.storage.local.get("lastCounterResetTime", function(options){
            if (options.lastCounterResetTime){
                var parameters = {
                    newerThan: options.lastCounterResetTime
                };
            }
            makeMarkersRequest(parameters);
        });
    } else {
        chrome.storage.local.set({ lastCounterResetTime: new Date(0).getTime() });
        makeMarkersRequest();
    }

    function makeMarkersRequest(parameters){
        apiRequestWrapper("markers/counts", {
            parameters: parameters,
            onSuccess: function (response) {
                var unreadCounts = response.unreadcounts;
                var unreadFeedsCount = 0;

                if (appGlobal.options.isFiltersEnabled) {
                    apiRequestWrapper("subscriptions", {
                        onSuccess: function (response) {
                            unreadCounts.forEach(function (element) {
                                if (appGlobal.options.filters.indexOf(element.id) !== -1) {
                                    unreadFeedsCount += element.count;
                                }
                            });

                            // When feed consists in more than one category, we remove feed which was counted twice or more
                            response.forEach(function (feed) {
                                var numberOfDupesCategories = 0;
                                feed.categories.forEach(function(category){
                                    if(appGlobal.options.filters.indexOf(category.id) !== -1){
                                        numberOfDupesCategories++;
                                    }
                                });
                                if(numberOfDupesCategories > 1){
                                    for (var i = 0; i < unreadCounts.length; i++) {
                                        if (feed.id === unreadCounts[i].id) {
                                            unreadFeedsCount -= unreadCounts[i].count * --numberOfDupesCategories;
                                            break;
                                        }
                                    }
                                }
                            });

                            setBadgeCounter(unreadFeedsCount);
                        }
                    });
                } else {
                    for (var i = 0; i < unreadCounts.length; i++) {
                        if (appGlobal.globalGroup === unreadCounts[i].id) {
                            unreadFeedsCount = unreadCounts[i].count;
                            break;
                        }
                    }

                    setBadgeCounter(unreadFeedsCount);
                }
            }
        });
    }
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete
 * If silentUpdate is true, then notifications will not be shown
 *  */
function updateFeeds(callback, silentUpdate){
    appGlobal.cachedFeeds = [];
    appGlobal.options.filters = appGlobal.options.filters || [];

    var streamIds = appGlobal.options.isFiltersEnabled && appGlobal.options.filters.length ? appGlobal.options.filters : [appGlobal.globalGroup];

    var requestCount = streamIds.length;
    for(var i = 0; i < streamIds.length; i++){
        apiRequestWrapper("streams/" + encodeURIComponent(streamIds[i]) + "/contents", {
            timeout: 7000, // Prevent infinite loading
            parameters: {
                unreadOnly: true,
                count: appGlobal.options.maxNumberOfFeeds,
                ranked: appGlobal.options.oldestFeedsFirst ? "oldest" : "newest"
            },
            onSuccess: function (response) {
                requestCount--;

                appGlobal.cachedFeeds = appGlobal.cachedFeeds.concat(parseFeeds(response));
                // When all request are completed
                if (requestCount < 1) {

                    // Remove duplicates
                    appGlobal.cachedFeeds = appGlobal.cachedFeeds.filter(function(value, index, feeds){
                        for(var i = ++index; i < feeds.length; i++){
                            if(feeds[i].id == value.id){
                                return false;
                            }
                        }
                        return true;
                    });

                    appGlobal.cachedFeeds = appGlobal.cachedFeeds.sort(function (a, b) {
                        if (a.date > b.date) {
                            return appGlobal.options.oldestFeedsFirst ? 1 : -1;
                        } else if (a.date < b.date) {
                            return appGlobal.options.oldestFeedsFirst ? -1 : 1;
                        }
                        return 0;
                    });

                    appGlobal.cachedFeeds = appGlobal.cachedFeeds.splice(0, appGlobal.options.maxNumberOfFeeds);
                    if (!silentUpdate
                        && (appGlobal.options.showDesktopNotifications || appGlobal.options.playSound)) {

                        filterByNewFeeds(appGlobal.cachedFeeds, function (newFeeds) {
                            if (appGlobal.options.showDesktopNotifications) {
                                sendDesktopNotification(newFeeds);
                            }
                            if (appGlobal.options.playSound && newFeeds.length > 0) {
                                playSound();
                            }
                        });
                    }
                }
            },
            onComplete: function(){
                if (typeof callback === "function") {
                    callback();
                }
            }
        });
    }
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
    chrome.browserAction.setBadgeBackgroundColor({color: "#CF0016"});
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
        var content;
        var contentDirection;
        if (appGlobal.options.showFullFeedContent) {
            if (item.content !== undefined) {
                content = item.content.content;
                contentDirection = item.content.direction;
            }
        }

        if (!content) {
            if (item.summary !== undefined) {
                content = item.summary.content;
                contentDirection = item.summary.direction;
            }
        }

        //Set title
        var title;
        var titleDirection;
        if (item.title) {
            if (item.title.indexOf("direction:rtl") !== -1) {
                //Feedly wraps rtl titles in div, we remove div because desktopNotification supports only text
                title = item.title.replace(/<\/?div.*?>/gi, "");
                titleDirection = "rtl";
            } else {
                title = item.title;
            }
        }

        var isSaved;
        if (item.tags) {
            for (var i = 0; i < item.tags.length; i++) {
                if (item.tags[i].id.search(/global\.saved$/i) !== -1) {
                    isSaved = true;
                    break;
                }
            }
        }

        var blog;
        var blogTitleDirection;
        if (item.origin && item.origin.title) {
            if (item.origin.title.indexOf("direction:rtl") !== -1) {
                //Feedly wraps rtl titles in div, we remove div because desktopNotification supports only text
                blog = item.origin.title.replace(/<\/?div.*?>/gi, "");
                blogTitleDirection = "rtl";
            } else {
                blog = item.origin.title;
            }
        }

        var categories = [];
        if (item.categories) {
            categories = item.categories.map(function (category){
                return {
                    id: category.id,
                    encodedId: encodeURI(category.id),
                    label: category.label
                };
            });
        }

        var googleFaviconUrl = "https://www.google.com/s2/favicons?domain=" + blogUrl + "&alt=feed";

        return {
            title: title,
            titleDirection: titleDirection,
            url: (item.alternate ? item.alternate[0] ? item.alternate[0].href : "" : "") || blogUrl,
            blog: blog,
            blogTitleDirection: blogTitleDirection,
            blogUrl: blogUrl,
            blogIcon: "https://i.olsh.me/icon?url=" + blogUrl + "&size=32&fallback_icon_url=" + googleFaviconUrl,
            id: item.id,
            content: content,
            contentDirection: contentDirection,
            isoDate: item.crawled ? new Date(item.crawled).toISOString() : "",
            date: item.crawled ? new Date(item.crawled) : "",
            isSaved: isSaved,
            categories: categories,
            author: item.author
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
        updateCounter();
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
    apiRequestWrapper("markers", {
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
                    setBadgeCounter(feedsCount);
                }
            });
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

/* Save feed or unsave it.
 * array of the feeds IDs
 * if saveFeed is true, then save the feeds, else unsafe them
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
function toggleSavedFeed(feedsIds, saveFeed, callback) {
    if (saveFeed) {
        apiRequestWrapper("tags/" + encodeURIComponent(appGlobal.savedGroup), {
            method: "PUT",
            body: {
                entryIds: feedsIds
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
        apiRequestWrapper("tags/" + encodeURIComponent(appGlobal.savedGroup) + "/" + encodeURIComponent(feedsIds), {
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
    for (var i = 0; i < feedsIds.length; i++) {
        var feedId = feedsIds[i];
        for (var j = 0; j < appGlobal.cachedFeeds.length; j++) {
            if (appGlobal.cachedFeeds[j].id === feedId) {
                appGlobal.cachedFeeds[j].isSaved = saveFeed;
                break;
            }
        }
    }
}

/* Runs authenticating a user process,
 * then read access token and stores in chrome.storage */
function getAccessToken() {
    var state = (new Date()).getTime();
    var redirectUri = "https://olsh.github.io/Feedly-Notifier/";
    var url = appGlobal.feedlyApiClient.getMethodUrl("auth/auth", {
        response_type: "code",
        client_id: appGlobal.clientId,
        redirect_uri: redirectUri,
        scope: "https://cloud.feedly.com/subscriptions",
        state: state
    }, appGlobal.options.useSecureConnection);

    chrome.tabs.create({url: url}, function (authorizationTab) {
        chrome.tabs.onUpdated.addListener(function processCode(tabId, information, tab) {

            var checkStateRegex = new RegExp("state=" + state);
            if (!checkStateRegex.test(information.url)) {
                return;
            }

            var codeParse = /code=(.+?)(?:&|$)/i;
            var matches = codeParse.exec(information.url);
            if (matches) {
                appGlobal.feedlyApiClient.request("auth/token", {
                    method: "POST",
                    useSecureConnection: appGlobal.options.useSecureConnection,
                    parameters: {
                        code: matches[1],
                        client_id: appGlobal.clientId,
                        client_secret: appGlobal.clientSecret,
                        redirect_uri: redirectUri,
                        grant_type: "authorization_code"
                    },
                    onSuccess: function (response) {
                        appGlobal.syncStorage.set({
                            accessToken: response.access_token,
                            refreshToken: response.refresh_token,
                            feedlyUserId: response.id
                        }, function () {
                        });
                        chrome.tabs.onUpdated.removeListener(processCode);
                    }
                });
            }
        });
    });
}

/* Tries refresh access token if possible */
function refreshAccessToken(){
    if(!appGlobal.options.refreshToken) return;

    appGlobal.feedlyApiClient.request("auth/token", {
        method: "POST",
        useSecureConnection: appGlobal.options.useSecureConnection,
        parameters: {
            refresh_token: appGlobal.options.refreshToken,
            client_id: appGlobal.clientId,
            client_secret: appGlobal.clientSecret,
            grant_type: "refresh_token"
        },
        onSuccess: function (response) {
            appGlobal.syncStorage.set({
                accessToken: response.access_token,
                feedlyUserId: response.id
            }, function () {});
        },
        onComplete: function(){
            appGlobal.tokenIsRefreshing = false;
        }
    });
}

/* Writes all application options in chrome storage and runs callback after it */
function writeOptions(callback) {
    var options = {};
    for (var option in appGlobal.options) {
        options[option] = appGlobal.options[option];
    }
    appGlobal.syncStorage.set(options, function () {
        if (typeof callback === "function") {
            callback();
        }
    });
}

/* Reads all options from chrome storage and runs callback after it */
function readOptions(callback) {
    appGlobal.syncStorage.get(null, function (options) {
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

function apiRequestWrapper(methodName, settings) {
    var onSuccess = settings.onSuccess;
    settings.onSuccess = function (response) {
        setActiveStatus();
        if (typeof onSuccess === "function") {
            onSuccess(response);
        }
    };

    var onAuthorizationRequired = settings.onAuthorizationRequired;

    settings.onAuthorizationRequired = function (accessToken) {
        if (appGlobal.isLoggedIn) {
            setInactiveStatus();
        }
        if (!appGlobal.tokenIsRefreshing){
            appGlobal.tokenIsRefreshing = true;
            refreshAccessToken();
        }
        if (typeof onAuthorizationRequired === "function") {
            onAuthorizationRequired(accessToken);
        }
    };

    appGlobal.feedlyApiClient.request(methodName, settings);
}