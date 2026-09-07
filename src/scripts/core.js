"use strict";
/* exported getFeeds, getSavedFeeds, toggleSavedFeed */

var appGlobal = {
    feedlyApiClient: new FeedlyApiClient(),
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
        _popupWidth: 500,
        _expandedPopupWidth: 800,

        markReadOnClick: true,
        accessToken: "",
        refreshToken: "",
        showDesktopNotifications: true,
        showFullFeedContent: false,
        maxNotificationsCount: 5,
        openSiteOnIconClick: false,
        enableSidePanel: false,
        feedlyUserId: "",
        abilitySaveFeeds: false,
        maxNumberOfFeeds: 20,
        forceUpdateFeeds: false,
        expandFeeds: false,
        isFiltersEnabled: false,
        showEngagementFilter: false,
        engagementFilterLimit: 1,
        openFeedsInSameTab: false,
        openFeedsInBackground: true,
        filters: [],
        showCounter: true,
        playSound: true,
        sound: "sound/alert.mp3",
        soundVolume: 0.8,
        sortBy: "newest",
        theme: "auto",
        resetCounterOnClick: false,
        popupFontSize: 100, //percent
        showCategories: false,
        grayIconColorIfNoUnread: false,
        showBlogIconInNotifications: false,
        showThumbnailInNotifications: false,
        currentUiLanguage: "en",
        closePopupWhenLastFeedIsRead: false,
        disableOptionsSync: false,

        get updateInterval(){
            let minimumInterval = 10;
            return this._updateInterval >= minimumInterval ? this._updateInterval : minimumInterval;
        },
        set updateInterval(value) {
            this._updateInterval = value;
        },
        get popupWidth() {
            let maxValue = 800;
            let minValue = 380;
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
            let maxValue = 800;
            let minValue = 380;
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
    criticalOptionNames: [
        "updateInterval",
        "accessToken",
        "showFullFeedContent",
        "openSiteOnIconClick",
        "enableSidePanel",
        "maxNumberOfFeeds",
        "abilitySaveFeeds",
        "filters",
        "isFiltersEnabled",
        "showCounter",
        "resetCounterOnClick",
        "grayIconColorIfNoUnread",
        "sortBy",
        // Both decide whether startSchedule creates the updateFeeds alarm
        "showDesktopNotifications",
        "playSound"
    ],
    cachedFeeds: [],
    cachedSavedFeeds: [],
    notifications: {},
    isLoggedIn: false,
    intervalIds: [],
    clientId: "",
    clientSecret: "",
    getUserSubscriptionsPromise: null,
    refreshAccessTokenPromise: null,
    rateLimitedUntil: 0,
    /* The statuses the token endpoint uses to say that the grant will never be accepted
       again: 400 invalid_grant for an expired or revoked refresh token, 401 and 403 for
       one that no longer belongs to this client. Anything else, 429 and 5xx included, is
       temporary and must not sign the user out. */
    deadRefreshTokenStatuses: [400, 401, 403],
    environment: {
        os: ""
    },
    get feedlyUrl(){
        return "https://feedly.com";
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
    get globalFavorites(){
        return "user/" + this.options.feedlyUserId + "/category/global.must";
    },
    get syncStorage(){
        if (this.options.disableOptionsSync) {
            return browser.storage.local;
        }
        return browser.storage.sync;
    },
    get sessionStorage(){
        return browser.storage.session;
    }
};

/* The feedly website marks entries as read one request at a time, so without a window
   here reading a page of articles costs a full update per article. Kept below the
   ~30 seconds a service worker stays alive after an event, so the trailing run fires. */
const websiteUpdateWindowMs = 20000;

/* How long to stop talking to feedly after it answers 429. The response usually says
   when the quota resets, the rest is a guard against a missing or absurd value. */
const rateLimitDefaultCooldownMs = 15 * 60 * 1000;
const rateLimitMinCooldownMs = 60 * 1000;
const rateLimitMaxCooldownMs = 60 * 60 * 1000;

// #Event handlers
browser.runtime.onInstalled.addListener(async function () {
    await readOptions();
    // Write all options in storage and initialize application
    await writeOptions();
    await initialize();
});

browser.runtime.onStartup.addListener(async function () {
    await readOptions();
    await initialize();
});

browser.storage.onChanged.addListener(async function (changes) {
    // The feed caches, the notification watermark and the rate limit deadline share these
    // storage areas and are written by this worker on every update cycle. Re-reading the
    // options for them is pure noise.
    if (!containsOptionChanges(changes)) {
        return;
    }

    let previousToken = appGlobal.options.accessToken;
    let snapshot = snapshotCriticalOptions();

    await readOptions();

    let changedOptions = getChangedCriticalOptions(snapshot);

    // A write raises the event even when the value did not change, and writeOptions
    // rewrites every option at once. Comparing the resolved options rather than the
    // reported change also keeps signing out correct, where the two storage areas are
    // written one after the other.
    if (changedOptions.length === 0) {
        return;
    }

    // A refreshed access token replaces one working token with another, and the request
    // that asked for the refresh is already retrying with it. Reinitializing here would
    // rebuild the schedule and start another update for every single refresh.
    if (changedOptions.length === 1 && changedOptions[0] === "accessToken"
        && previousToken && appGlobal.options.accessToken) {
        appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;
        return;
    }

    await initialize();
});

function containsOptionChanges(changes) {
    for (let key in changes) {
        if (Object.hasOwn(appGlobal.options, key)) {
            return true;
        }
    }

    return false;
}

/* Values are stringified so that an array option such as the filters compares by content
   rather than by identity. */
function snapshotCriticalOptions() {
    let snapshot = {};
    for (let optionName of appGlobal.criticalOptionNames) {
        snapshot[optionName] = JSON.stringify(appGlobal.options[optionName]);
    }

    return snapshot;
}

function getChangedCriticalOptions(snapshot) {
    let changed = [];
    for (let optionName of appGlobal.criticalOptionNames) {
        if (snapshot[optionName] !== JSON.stringify(appGlobal.options[optionName])) {
            changed.push(optionName);
        }
    }

    return changed;
}

browser.tabs.onRemoved.addListener(function(tabId){
    if (appGlobal.feedTabId && appGlobal.feedTabId === tabId) {
        appGlobal.feedTabId = null;
        appGlobal.sessionStorage.remove("_feedTabId").catch(function () {});
    }
});

/* Listener for adding or removing feeds on the feedly website */
browser.webRequest.onCompleted.addListener(function (details) {
    if (details.method !== "POST" && details.method !== "DELETE") {
        return;
    }

    // Our own markers request already updated the cache and the badge, updating again
    // would only repeat the work and the request.
    if (isOwnRequest(details)) {
        return;
    }

    // Only a subscriptions change can invalidate the memo, marking as read cannot.
    if (details.url?.includes("/v3/subscriptions")) {
        appGlobal.getUserSubscriptionsPromise = null;
    }

    scheduleWebsiteUpdate();
}, {urls: ["*://*.feedly.com/v3/subscriptions*", "*://*.feedly.com/v3/markers*"]});

/* Listener for adding or removing saved feeds */
browser.webRequest.onCompleted.addListener(function (details) {
    if (details.method !== "PUT" && details.method !== "DELETE") {
        return;
    }

    if (isOwnRequest(details)) {
        return;
    }

    scheduleSavedFeedsUpdate();
}, {urls: ["*://*.feedly.com/v3/tags*global.saved*"]});

/* True when the extension itself made the request rather than the feedly website.
   Chromium reports the origin in initiator, firefox in originUrl. The tab id is not
   usable here, the feedly website is a progressive web app and its own service worker
   makes requests without a tab too. */
function isOwnRequest(details) {
    // getURL ends in exactly one slash, chrome reports initiator as a bare origin
    let extensionOrigin = browser.runtime.getURL("").replace(/\/$/, "");
    let initiator = details.initiator || details.originUrl || "";

    return initiator.length > 0 && initiator.indexOf(extensionOrigin) === 0;
}

/**
 * Wraps an update so that a burst of website activity costs one run instead of one per
 * event: the first event runs straight away, everything else inside the window collapses
 * into a single trailing run. Each throttle keeps its own timer, so saving an article
 * cannot postpone the counter refresh or the other way round.
 */
function createWebsiteUpdateThrottle(runUpdate) {
    let timeoutId = null;
    let lastRunTime = 0;

    function runNow() {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }

        lastRunTime = Date.now();

        // Nothing awaits this, so a failure would surface as an unhandled rejection
        runUpdate().catch(function (e) {
            console.info("Unable to update after a change on the feedly website.", e);
        });
    }

    return function () {
        let elapsed = Date.now() - lastRunTime;

        if (elapsed >= websiteUpdateWindowMs) {
            runNow();
            return;
        }

        if (timeoutId === null) {
            timeoutId = setTimeout(runNow, websiteUpdateWindowMs - elapsed);
        }
    };
}

async function runWebsiteUpdate() {
    await ensureOptionsLoaded();
    updateCounter();
    updateFeeds();
}

async function runSavedFeedsUpdate() {
    await ensureOptionsLoaded();
    await updateSavedFeeds();
}

const scheduleWebsiteUpdate = createWebsiteUpdateThrottle(runWebsiteUpdate);
const scheduleSavedFeedsUpdate = createWebsiteUpdateThrottle(runSavedFeedsUpdate);

browser.action.onClicked.addListener(function (tab) {
    //The side panel may only be opened from within the user gesture, which any
    //preceding await destroys, so try it before the options are read from storage.
    if (appGlobal.options.enableSidePanel && openSidePanel(tab)) {
        return;
    }

    handleActionClick(tab).catch(function (e) {
        console.error("Unable to handle the action click", e);
    });
});

async function handleActionClick(tab) {
    await ensureOptionsLoaded();

    //The options were not loaded yet when the click arrived. The gesture is gone by
    //now, so this only succeeds on browsers that do not enforce it.
    if (appGlobal.options.enableSidePanel && openSidePanel(tab)) {
        return;
    }

    if (appGlobal.isLoggedIn) {
        await openFeedlyTab();
        if(appGlobal.options.resetCounterOnClick){
            await resetCounter();
        }
    } else {
        await getAccessToken();
    }
}

/* Initialization all parameters and run feeds check */
async function initialize(immediate) {
    //Only drop the popup once the side panel is known to replace it, otherwise the
    //icon would do nothing at all on browsers without the side panel API.
    const isSidePanelActive = await configureSidePanel();

    if (isSidePanelActive || appGlobal.options.openSiteOnIconClick) {
        await browser.action.setPopup({popup: ""});
    } else {
        await browser.action.setPopup({popup: "popup.html"});
    }
    appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;

    const platformInfo = await browser.runtime.getPlatformInfo();
    appGlobal.environment.os = platformInfo.os;
    startSchedule(appGlobal.options.updateInterval, immediate);
}

/* Returns true when the side panel is enabled and the browser accepted the configuration */
async function configureSidePanel() {
    if (!browser.sidePanel || typeof browser.sidePanel.setOptions !== "function") {
        return false;
    }

    const isEnabled = Boolean(appGlobal.options.enableSidePanel);
    let isConfigured = false;

    try {
        await browser.sidePanel.setOptions({
            enabled: isEnabled,
            path: "popup.html?panel=1"
        });
        isConfigured = true;
    } catch (e) {
        console.info("Unable to configure side panel", e);
    }

    //Set separately, a failure above must not leave the icon without any behaviour
    if (typeof browser.sidePanel.setPanelBehavior === "function") {
        try {
            await browser.sidePanel.setPanelBehavior({openPanelOnActionClick: isEnabled});
            isConfigured = true;
        } catch (e) {
            console.info("Unable to set side panel behaviour", e);
        }
    }

    return isEnabled && isConfigured;
}

/* Opens the side panel for the clicked tab. Deliberately not async, awaiting the call
   would move it out of the user gesture that the browser requires. */
function openSidePanel(tab) {
    if (!browser.sidePanel || typeof browser.sidePanel.open !== "function") {
        return false;
    }

    if (!tab || (tab.id == null && tab.windowId == null)) {
        return false;
    }

    const target = tab.id == null ? {windowId: tab.windowId} : {tabId: tab.id};
    Promise.resolve(browser.sidePanel.open(target)).catch(function (e) {
        console.info("Unable to open side panel", e);
    });

    return true;
}

async function ensureOptionsLoaded() {
    await readOptions();
    appGlobal.feedlyApiClient.accessToken = appGlobal.options.accessToken;
    appGlobal.isLoggedIn = Boolean(appGlobal.options.accessToken);
}

function startSchedule(updateInterval, immediate) {
    const shouldRecreate = (immediate !== false);

    // When shouldRecreate is false (worker wake), keep existing alarms as-is and avoid immediate fetch.
    if (shouldRecreate) {
        stopSchedule();

        // Without a token every scheduled request fails, and every failure wakes the
        // worker again. Stay quiet until the user signs in.
        if (!appGlobal.options.accessToken) {
            return;
        }

        if (appGlobal.options.showCounter) {
            browser.alarms.create("updateCounter", { periodInMinutes: updateInterval });
        }
        if (appGlobal.options.showDesktopNotifications || appGlobal.options.playSound || !appGlobal.options.openSiteOnIconClick) {
            browser.alarms.create("updateFeeds", { periodInMinutes: updateInterval });
        }
        updateCounter();
        updateFeeds();
    }
}

function stopSchedule() {
    browser.alarms.clear("updateCounter");
    browser.alarms.clear("updateFeeds");
}

browser.alarms.onAlarm.addListener(async function (alarm) {
    // Ensure tokens/options are loaded when worker wakes for an alarm
    await ensureOptionsLoaded();

    if (alarm && alarm.name === "updateCounter") {
        updateCounter();
    } else if (alarm && alarm.name === "updateFeeds") {
        updateFeeds();
    }
});

browser.notifications.onClicked.addListener(function (notificationId) {
    browser.notifications.clear(notificationId);

    if (appGlobal.notifications[notificationId]) {
        openUrlInNewTab(appGlobal.notifications[notificationId], true);
        if (appGlobal.options.markReadOnClick) {
            markAsRead([notificationId]);
        }
    }

    appGlobal.notifications[notificationId] = undefined;
});

browser.notifications.onButtonClicked.addListener(function(notificationId, button) {
    if (button !== 0) {
        // Unknown button index
        return;
    }

    // The "Mark as read button has been clicked"
    if (appGlobal.notifications[notificationId]) {
        markAsRead([notificationId]);
        browser.notifications.clear(notificationId);
    }

    appGlobal.notifications[notificationId] = undefined;
});

/* Sends desktop notifications */
async function sendDesktopNotification(feeds) {

    //if notifications too many, then to show only count
    let maxNotifications = appGlobal.options.maxNotificationsCount;
    // @if BROWSER='firefox'
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications/create
    // If you call notifications.create() more than once in rapid succession,
    // Firefox may end up not displaying any notification at all.
    maxNotifications = 1;
    // @endif

    const isSoundEnabled = appGlobal.options.playSound && feeds.length > 0;
    if (feeds.length > maxNotifications) {
        //We can detect only limit count of new feeds at time, but actually count of feeds may be more
        let count = feeds.length === appGlobal.options.maxNumberOfFeeds ? browser.i18n.getMessage("many") : feeds.length.toString();

        browser.notifications.create({
            type: "basic",
            title: browser.i18n.getMessage("NewFeeds"),
            message: browser.i18n.getMessage("YouHaveNewFeeds", count),
            iconUrl: appGlobal.icons.defaultBig,
            // @if BROWSER!='firefox'
            silent: !isSoundEnabled
            // @endif
        });
    } else {
        let showBlogIcons = false;
        let showThumbnails = false;

        const canCheckPermissions = browser.permissions && typeof browser.permissions.contains === "function";
        const hasAllOrigins = canCheckPermissions
            ? await browser.permissions.contains({ origins: ["<all_urls>"] }).catch(function () { return false; })
            : false;
        if (appGlobal.options.showBlogIconInNotifications && hasAllOrigins) {
            showBlogIcons = true;
        }
        if (appGlobal.options.showThumbnailInNotifications && hasAllOrigins) {
            showThumbnails = true;
        }

        createNotifications(feeds, showBlogIcons, showThumbnails, isSoundEnabled);
    }

    // @if BROWSER='firefox'
    // Firefox doesn't support silent notifications, so we need to play custom audio file
    if (isSoundEnabled) {
        playSound();
    }
    // @endif

    function createNotifications(feeds, showBlogIcons, showThumbnails, isSoundEnabled) {
        for (let feed of feeds) {
            let notificationType = "basic";
            // @if BROWSER='chrome'
            if (showThumbnails && feed.thumbnail) {
                notificationType = "image";
            }
            // @endif

            browser.notifications.create(feed.id, {
                type: notificationType,
                title: feed.blog,
                message: feed.title,
                iconUrl: showBlogIcons ? feed.blogIcon : appGlobal.icons.defaultBig
                // @if BROWSER='chrome'
                ,imageUrl: showThumbnails ? feed.thumbnail : null
                ,buttons: [
                    {
                        title: browser.i18n.getMessage("MarkAsRead")
                    }
                ],
                silent: !isSoundEnabled
                // @endif
            });

            appGlobal.notifications[feed.id] = feed.url;
        }
    }
}

/* Opens new tab, if tab is being opened when no active window (i.e. background mode)
 * then creates new window and adds tab in the end of it
 * url for open
 * active when is true, then tab will be active */
async function openUrlInNewTab(url, active) {
    const windows = await browser.windows.getAll({});
    if (windows.length < 1) {
        await browser.windows.create({focused: true});
    }
    await browser.tabs.create({url: url, active: active });
}

/* Opens new Feedly tab, if tab was already opened, then switches on it and reload. */
async function openFeedlyTab() {
    const tabs = await browser.tabs.query({url: appGlobal.feedlyUrl + "/*"});
    if (tabs.length < 1) {
        await browser.tabs.create({url: appGlobal.feedlyUrl});
    } else {
        await browser.tabs.update(tabs[0].id, {active: true});
        await browser.tabs.reload(tabs[0].id);
    }
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
    if (typeof Audio !== "function") {
        return;
    }
    var audio = new Audio(appGlobal.options.sound);
    audio.volume = appGlobal.options.soundVolume;
    Promise.resolve(audio.play()).catch(function () {});
}

/* Returns only new feeds and set date of last feed
 * The callback parameter should specify a function that looks like this:
 * function(object newFeeds) {...};*/
async function filterByNewFeeds(feeds) {
    const options = await browser.storage.local.get("lastFeedTimeTicks");
    let lastFeedTime;

    if (options.lastFeedTimeTicks) {
        lastFeedTime = new Date(options.lastFeedTimeTicks);
    } else {
        lastFeedTime = new Date(1971, 0, 1);
    }

    let newFeeds = [];
    let maxFeedTime = lastFeedTime;

    for (let i = 0; i < feeds.length; i++) {
        if (feeds[i].date > lastFeedTime) {
            newFeeds.push(feeds[i]);
            if (feeds[i].date > maxFeedTime) {
                maxFeedTime = feeds[i].date;
            }
        }
    }

    await browser.storage.local.set({ lastFeedTimeTicks: maxFeedTime.getTime() });
    return newFeeds;
}

async function resetCounter(){
    setBadgeCounter(0);
    await browser.storage.local.set({ lastCounterResetTime: new Date().getTime() });
}

/**
 * Updates saved feeds and stores them in cache.
 * @returns {Promise}
 */
async function updateSavedFeeds() {
    if (isRateLimited()) {
        return;
    }

    const response = await apiRequestWrapper("streams/" + encodeURIComponent(appGlobal.savedGroup) + "/contents");
    const feeds = await parseFeeds(response);
    appGlobal.cachedSavedFeeds = feeds;
    browser.storage.local.set({ cachedSavedFeeds: feeds }).catch(function () {});
}

/* Sets badge counter if unread feeds more than zero */
function setBadgeCounter(unreadFeedsCount) {
    if (appGlobal.options.showCounter) {
        const unreadFeedsCountNumber = +unreadFeedsCount;
        if (unreadFeedsCountNumber > 999) {
            const thousands = Math.floor(unreadFeedsCountNumber / 1000);
            unreadFeedsCount = thousands + "k+";
        }
        browser.action.setBadgeText({ text: String(unreadFeedsCountNumber > 0 ? unreadFeedsCount : "")});
    } else {
        browser.action.setBadgeText({ text: ""});
    }

    if (!unreadFeedsCount && appGlobal.options.grayIconColorIfNoUnread) {
        browser.action.setIcon({ path: appGlobal.icons.inactive });
    } else {
        browser.action.setIcon({ path: appGlobal.icons.default });
    }
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete
 * */
async function updateCounter() {
    if (isRateLimited()) {
        return;
    }

    try {
        if (appGlobal.options.resetCounterOnClick) {
            const options = await browser.storage.local.get("lastCounterResetTime");
            let parameters = null;
            if (options.lastCounterResetTime) {
                parameters = { newerThan: options.lastCounterResetTime };
            }
            await makeMarkersRequest(parameters);
        } else {
            await browser.storage.local.set({lastCounterResetTime: new Date(0).getTime()});
            await makeMarkersRequest();
        }
    } catch (e) {
        // A rate limited cycle knows nothing about the count, so blanking the badge would
        // throw the last good value away for the whole cooldown.
        if (e?.status !== 429) {
            await browser.action.setBadgeText({ text: ""});
        }
        console.info("Unable to load counters.", e);
    }
}

async function makeMarkersRequest(parameters){
    const response = await apiRequestWrapper("markers/counts", { parameters: parameters });
    const unreadCounts = response.unreadcounts || [];
    let unreadFeedsCount = 0;

    if (appGlobal.options.isFiltersEnabled) {
        try {
            const subscriptions = await getUserSubscriptions();
            unreadCounts.forEach(function (element) {
                if (appGlobal.options.filters.indexOf(element.id) !== -1) {
                    unreadFeedsCount += element.count;
                }
            });

            // Remove double-counted feeds when they belong to multiple categories
            subscriptions.forEach(function (feed) {
                let numberOfDupesCategories = 0;
                feed.categories.forEach(function(category){
                    if(appGlobal.options.filters.indexOf(category.id) !== -1){
                        numberOfDupesCategories++;
                    }
                });
                if(numberOfDupesCategories > 1){
                    for (let i = 0; i < unreadCounts.length; i++) {
                        if (feed.id === unreadCounts[i].id) {
                            unreadFeedsCount -= unreadCounts[i].count * --numberOfDupesCategories;
                            break;
                        }
                    }
                }
            });
        } catch (e) {
            console.info("Unable to load subscriptions.", e);
        }
    } else {
        for (let unreadCount of unreadCounts) {
            if (appGlobal.globalGroup === unreadCount.id) {
                unreadFeedsCount = unreadCount.count;
                break;
            }
        }
    }

    setBadgeCounter(unreadFeedsCount);
}

/* Runs feeds update and stores unread feeds in cache
 * Callback will be started after function complete
 * If silentUpdate is true, then notifications will not be shown
 *  */
async function updateFeeds(silentUpdate) {
    if (isRateLimited()) {
        return;
    }

    const previousCache = appGlobal.cachedFeeds.slice(0);
    appGlobal.options.filters = appGlobal.options.filters || [];

    let streamIds = appGlobal.options.isFiltersEnabled && appGlobal.options.filters.length
        ? appGlobal.options.filters : [appGlobal.globalGroup];

    let promises = [];
    for (let i = 0; i < streamIds.length; i++) {
        let promise = apiRequestWrapper("streams/" + encodeURIComponent(streamIds[i]) + "/contents", {
            timeout: 10000, // Prevent infinite loading
            parameters: {
                unreadOnly: true,
                count: appGlobal.options.maxNumberOfFeeds,
                ranked: appGlobal.options.sortBy
            }
        });

        promises.push(promise);
    }

    try {
        const responses = await Promise.all(promises);
        const parsedFeeds = await Promise.all(responses.map(response => parseFeeds(response)));

        let newCache = [];
        for (let parsedFeed of parsedFeeds) {
            newCache = newCache.concat(parsedFeed);
        }

        // Remove duplicates
        newCache = newCache.filter(function (value, index, feeds) {
            for (let i = ++index; i < feeds.length; i++) {
                if (feeds[i].id === value.id) {
                    return false;
                }
            }
            return true;
        });

        newCache = newCache.sort(function (a, b) {
            if (appGlobal.options.sortBy === "newest") {
                if (a.date > b.date) {
                    return -1;
                } else if (a.date < b.date){
                    return 1;
                } else {
                    return 0;
                }
            }

            if (appGlobal.options.sortBy === "oldest") {
                if (a.date > b.date) {
                    return 1;
                } else if (a.date < b.date){
                    return -1;
                } else {
                    return 0;
                }
            }

            if (a.engagementRate < b.engagementRate) {
                return 1;
            } else if (a.engagementRate > b.engagementRate){
                return -1;
            } else {
                return 0;
            }
        });

        newCache = newCache.splice(0, appGlobal.options.maxNumberOfFeeds);
        appGlobal.cachedFeeds = newCache;
        browser.storage.local.set({ cachedFeeds: newCache }).catch(function () {});
        if (!silentUpdate && (appGlobal.options.showDesktopNotifications)) {
            const newFeeds = await filterByNewFeeds(appGlobal.cachedFeeds);
            await sendDesktopNotification(newFeeds);
        }
    } catch (e) {
        // Preserve previous cache on failure
        appGlobal.cachedFeeds = previousCache;
        console.info("Unable to update feeds.", e);
    }
}

/* Stops scheduler, sets badge as inactive and resets counter */
function setInactiveStatus() {
    browser.action.setIcon({ path: appGlobal.icons.inactive });
    browser.action.setBadgeText({ text: ""});
    appGlobal.cachedFeeds = [];
    appGlobal.isLoggedIn = false;
    stopSchedule();
}

/* Drops credentials that feedly has permanently rejected and stops polling. Left in
   storage a dead token keeps the scheduler awake, and every cycle spends requests that can
   only fail, which is what exhausts the account's quota. Mirrors the options page logout,
   which is the recovery users have been performing by hand. */
async function clearStoredTokens() {
    appGlobal.options.accessToken = "";
    appGlobal.options.refreshToken = "";
    appGlobal.feedlyApiClient.accessToken = "";
    // Nothing else drops the memo, so signing in as somebody else would otherwise
    // label their articles with the previous account's subscription titles.
    appGlobal.getUserSubscriptionsPromise = null;
    setInactiveStatus();

    try {
        // The area the options are read from goes first, otherwise the storage event for
        // the other one would read the token back out of it and revive the session.
        await appGlobal.syncStorage.set({ accessToken: "", refreshToken: "" });
        await browser.storage.local.set({ accessToken: "", refreshToken: "" });
    } catch (e) {
        console.info("Unable to clear the stored tokens.", e);
    }
}

/* Sets badge as active */
function setActiveStatus() {
    browser.action.setBadgeBackgroundColor({color: "#CF0016"});
    appGlobal.isLoggedIn = true;
}

/* Converts feedly response to feeds */
async function parseFeeds(feedlyResponse) {
    const subscriptionResponse = await getUserSubscriptions();

    let subscriptionsMap = {};
    subscriptionResponse.forEach(item => { subscriptionsMap[item.id] = item.title; });

    return feedlyResponse.items.map(function (item) {

        let blogUrl;
        try {
            blogUrl = item.origin.htmlUrl.match(/https?:\/\/[^:/?]+/i).pop();
        } catch {
            blogUrl = "#";
        }

        //Set content
        let content;
        let contentDirection;
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

        let titleDirection;
        let title = item.title;

        //Sometimes Feedly doesn't have title property, so we put content
        // Feedly website do the same trick
        if (!title) {
            if (item.summary && item.summary.content) {
                let contentWithoutTags = item.summary.content.replace(/<\/?[^>]+(>|$)/g, "");
                const maxTitleLength = 100;
                if (contentWithoutTags.length > maxTitleLength) {
                    title = contentWithoutTags.substring(0, maxTitleLength) + "...";
                } else {
                    title = contentWithoutTags;
                }
            }
        }

        if (!title) {
            title = "[no title]";
        }

        if (title && title.indexOf("direction:rtl") !== -1) {
            //Feedly wraps rtl titles in div, we remove div because desktopNotification supports only text
            title = title.replace(/<\/?div.*?>/gi, "");
            titleDirection = "rtl";
        }

        let isSaved;
        if (item.tags) {
            for (let tag of item.tags) {
                if (tag.id.search(/global\.saved$/i) !== -1) {
                    isSaved = true;
                    break;
                }
            }
        }

        let blog;
        let blogTitleDirection;
        if (item.origin) {
            // Trying to get the user defined name of the stream
            blog = subscriptionsMap[item.origin.streamId] || item.origin.title || "";

            if (blog.indexOf("direction:rtl") !== -1) {
                //Feedly wraps rtl titles in div, we remove div because desktopNotifications support only text
                blog = item.origin.title.replace(/<\/?div.*?>/gi, "");
                blogTitleDirection = "rtl";
            }
        }

        let categories = [];
        if (item.categories) {
            categories = item.categories.map(function (category){
                return {
                    id: category.id,
                    encodedId: encodeURI(category.id),
                    label: category.label
                };
            });
        }

        let googleFaviconUrl = "https://www.google.com/s2/favicons?domain=" + blogUrl + "%26sz=64%26alt=feed";

        return {
            title: title,
            titleDirection: titleDirection,
            url: (item.alternate ? item.alternate[0] ? item.alternate[0].href : "" : "") || blogUrl,
            blog: blog,
            blogTitleDirection: blogTitleDirection,
            blogUrl: blogUrl,
            blogIcon: "https://i.olsh.me/icon?url=" + blogUrl + "&size=16..64..300&fallback_icon_url=" + googleFaviconUrl,
            id: item.id,
            content: content,
            contentDirection: contentDirection,
            isoDate: item.crawled ? new Date(item.crawled).toISOString() : "",
            date: item.crawled ? new Date(item.crawled) : "",
            isSaved: isSaved,
            categories: categories,
            author: item.author,
            thumbnail: item.thumbnail && item.thumbnail.length > 0 && item.thumbnail[0].url ? item.thumbnail[0].url : null,
            showEngagement: item.engagement > 0,
            engagement: item.engagement > 1000 ? Math.trunc(item.engagement / 1000) : item.engagement,
            engagementPostfix: item.engagement > 1000 ? "K" : "",
            engagementRate: item.engagementRate || 0,
            isEngagementHot: item.engagement >= 5000 && item.engagement < 100000,
            isEngagementOnFire: item.engagement >= 100000
        };
    });
}

/* Returns feeds from the cache.
 * If the cache is empty, then it will be updated before return
 * forceUpdate, when is true, then cache will be updated
 */
async function getFeeds(forceUpdate) {
    if (appGlobal.cachedFeeds.length > 0 && !forceUpdate) {
        return { feeds: appGlobal.cachedFeeds.slice(0), isLoggedIn: appGlobal.isLoggedIn };
    } else {
        await updateFeeds(true);
        updateCounter();
        return { feeds: appGlobal.cachedFeeds.slice(0), isLoggedIn: appGlobal.isLoggedIn };
    }
}

/* Returns saved feeds from the cache.
 * If the cache is empty, then it will be updated before return
 * forceUpdate, when is true, then cache will be updated
 */
async function getSavedFeeds(forceUpdate) {
    if (appGlobal.cachedSavedFeeds.length > 0 && !forceUpdate) {
        return { feeds: appGlobal.cachedSavedFeeds.slice(0), isLoggedIn: appGlobal.isLoggedIn };
    } else {
        await updateSavedFeeds();
        return { feeds: appGlobal.cachedSavedFeeds.slice(0), isLoggedIn: appGlobal.isLoggedIn };
    }
}

function getUserSubscriptions(updateCache) {
    if (updateCache) {
        appGlobal.getUserSubscriptionsPromise = null;
    }

    if (!appGlobal.getUserSubscriptionsPromise) {
        appGlobal.getUserSubscriptionsPromise = (async () => {
            const response = await apiRequestWrapper("subscriptions");
            if (!response) {
                appGlobal.getUserSubscriptionsPromise = null;
                throw new Error("Empty subscriptions response");
            }
            return response;
        })().catch((e) => {
            appGlobal.getUserSubscriptionsPromise = null;
            throw e;
        });
    }

    return appGlobal.getUserSubscriptionsPromise;
}

/* Marks feed as read, remove it from the cache and decrement badge.
 * array of the ID of feeds
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
async function markAsRead(feedIds) {

    // We should copy the array due to aggressive GC in Firefox
    // When the popup is closed Firefox destroys all objects created there
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Dead_object
    let copyArray = [];
    for (let i = 0; i < feedIds.length; i++) {
        copyArray.push(feedIds[i]);
    }

    try {
        await apiRequestWrapper("markers", {
            body: {
                action: "markAsRead",
                type: "entries",
                entryIds: copyArray
            },
            method: "POST"
        });

        for (let i = 0; i < copyArray.length; i++) {
            removeFeedFromCache(copyArray[i]);
        }

        // Update storage with the modified cached feeds
        await browser.storage.local.set({ cachedFeeds: appGlobal.cachedFeeds }).catch(function () {});

        let feedsCount = await browser.action.getBadgeText({});
        feedsCount = +feedsCount;
        if (feedsCount > 0) {
            feedsCount -= copyArray.length;
            setBadgeCounter(feedsCount);
        }
        return true;
    } catch {
        return false;
    }
}

/* Save feed or un save it.
 * array of the feeds IDs
 * if saveFeed is true, then save the feeds, else unsafe them
 * The callback parameter should specify a function that looks like this:
 * function(boolean isLoggedIn) {...};*/
async function toggleSavedFeed(feedsIds, saveFeed) {
    try {
        if (saveFeed) {
            await apiRequestWrapper("tags/" + encodeURIComponent(appGlobal.savedGroup), {
                method: "PUT",
                body: { entryIds: feedsIds }
            });
        } else {
            await apiRequestWrapper("tags/" + encodeURIComponent(appGlobal.savedGroup) + "/" + encodeURIComponent(feedsIds), {
                method: "DELETE"
            });
        }

        //Update state in the cache
        for (let i = 0; i < feedsIds.length; i++) {
            let feedId = feedsIds[i];
            for (let j = 0; j < appGlobal.cachedFeeds.length; j++) {
                if (appGlobal.cachedFeeds[j].id === feedId) {
                    appGlobal.cachedFeeds[j].isSaved = saveFeed;
                    break;
                }
            }
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Authenticates the user and stores the access token to browser storage.
 */
async function getAccessToken() {
    let state = (new Date()).getTime();
    let redirectUri = "https://olsh.github.io/Feedly-Notifier/";
    let url = appGlobal.feedlyApiClient.getMethodUrl("auth/auth", {
        response_type: "code",
        client_id: appGlobal.clientId,
        redirect_uri: redirectUri,
        scope: "https://cloud.feedly.com/subscriptions",
        state: state
    });

    await browser.tabs.create({url: url});

    const code = await new Promise((resolve) => {
        function processCode(tabId, information, tab) {
            if (!information || !information.url) {
                return;
            }
            let checkStateRegex = new RegExp("state=" + state);
            if (!checkStateRegex.test(information.url)) {
                return;
            }

            let codeParse = /code=(.+?)(?:&|$)/i;
            let matches = codeParse.exec(information.url);
            if (matches) {
                if (browser.tabs && browser.tabs.onUpdated && typeof browser.tabs.onUpdated.removeListener === "function") {
                    browser.tabs.onUpdated.removeListener(processCode);
                }
                resolve(matches[1]);
            }
        }
        browser.tabs.onUpdated.addListener(processCode);
    });

    const response = await appGlobal.feedlyApiClient.request("auth/token", {
        method: "POST",
        skipAuthentication: true,
        parameters: {
            code: code,
            client_id: appGlobal.clientId,
            client_secret: appGlobal.clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code"
        }
    });

    // Update runtime variables immediately to prevent race conditions
    appGlobal.options.accessToken = response.access_token;
    appGlobal.options.refreshToken = response.refresh_token;
    appGlobal.options.feedlyUserId = response.id;
    appGlobal.feedlyApiClient.accessToken = response.access_token;
    appGlobal.isLoggedIn = true;

    // Also save to storage for persistence
    await appGlobal.syncStorage.set({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        feedlyUserId: response.id
    });

    setActiveStatus();
}

/**
 * Refreshes the access token.
 *
 * A whole update cycle can fail with 401 at once, so the grant is shared: the first caller
 * performs it and the rest wait on the same promise. Without that, one expired token turns
 * into one auth/token request per in-flight call.
 */
function refreshAccessToken() {
    if (!appGlobal.refreshAccessTokenPromise) {
        appGlobal.refreshAccessTokenPromise = requestNewAccessToken().finally(function () {
            appGlobal.refreshAccessTokenPromise = null;
        });
    }

    return appGlobal.refreshAccessTokenPromise;
}

async function requestNewAccessToken(){
    if(!appGlobal.options.refreshToken) {
        setInactiveStatus();
        throw new Error("No refresh token available");
    }

    try {
        const response = await appGlobal.feedlyApiClient.request("auth/token", {
            method: "POST",
            skipAuthentication: true,
            parameters: {
                refresh_token: appGlobal.options.refreshToken,
                client_id: appGlobal.clientId,
                client_secret: appGlobal.clientSecret,
                grant_type: "refresh_token"
            }
        });

        // A grant that answers 200 without a token must not be stored, writing undefined
        // over the token would make the failure permanent.
        if (!response?.access_token) {
            throw new Error("The refresh response contained no access token");
        }

        // Update runtime variables immediately to prevent race conditions
        appGlobal.options.accessToken = response.access_token;
        appGlobal.options.feedlyUserId = response.id;
        appGlobal.feedlyApiClient.accessToken = response.access_token;
        appGlobal.isLoggedIn = true;

        // Awaited, so the retry cannot run before the new token is persisted
        await appGlobal.syncStorage.set({
            accessToken: response.access_token,
            feedlyUserId: response.id
        });

        setActiveStatus();
        return response;
    } catch (response) {
        if (response?.status === 429) {
            await startRateLimitCooldown(response);
        } else if (response && appGlobal.deadRefreshTokenStatuses.includes(response.status)) {
            console.info("The refresh token was rejected, signing out.", response.status);
            await clearStoredTokens();
        }
        throw response;
    }
}

/* Feedly answers 429 (HAP429) once the account has spent its API quota, and it counts
   against the whole account, so the feedly website starts failing too. Polling through it
   only prolongs the ban. */
function isRateLimited() {
    return appGlobal.rateLimitedUntil > Date.now();
}

async function startRateLimitCooldown(response) {
    const cooldown = parseRateLimitCooldown(response);
    appGlobal.rateLimitedUntil = Date.now() + cooldown;

    console.info("Feedly rate limited the account, pausing requests for "
        + Math.round(cooldown / 60000) + " minutes.");

    await browser.storage.local.set({ rateLimitedUntil: appGlobal.rateLimitedUntil })
        .catch(function () {});
}

/* Feedly reports the seconds left in the current window in X-RateLimit-Reset, Retry-After
   is the standard fallback and may hold either seconds or a date. The bounds guard against
   a missing header on one side and a value that would mute the extension on the other. */
function parseRateLimitCooldown(response) {
    let cooldown = Number.NaN;
    const headers = response?.headers;

    if (headers && typeof headers.get === "function") {
        const reset = headers.get("X-RateLimit-Reset") || headers.get("Retry-After");
        if (reset) {
            cooldown = Number(reset) * 1000;
            if (Number.isNaN(cooldown)) {
                cooldown = Date.parse(reset) - Date.now();
            }
        }
    }

    if (Number.isNaN(cooldown) || cooldown <= 0) {
        cooldown = rateLimitDefaultCooldownMs;
    }

    return Math.min(Math.max(cooldown, rateLimitMinCooldownMs), rateLimitMaxCooldownMs);
}

/* Writes all application options in chrome storage and runs callback after it */
async function writeOptions() {
    let options = {};
    for (let option in appGlobal.options) {
        // Do not store private fields in the options
        if (option.startsWith("_")) {
            continue;
        }

        options[option] = appGlobal.options[option];
    }
    await appGlobal.syncStorage.set(options);
}

/* Reads all options from chrome storage and runs callback after it */
async function readOptions() {
    const local = await browser.storage.local.get(null);
    appGlobal.options.disableOptionsSync = local.disableOptionsSync || false;

    const options = await appGlobal.syncStorage.get(null);
    for (let optionName in options) {
        // Do not read private fields in the options
        if (optionName.startsWith("_")) {
            continue;
        }

        if (typeof appGlobal.options[optionName] === "boolean") {
            appGlobal.options[optionName] = Boolean(options[optionName]);
        } else if (typeof appGlobal.options[optionName] === "number") {
            appGlobal.options[optionName] = Number(options[optionName]);
        } else {
            appGlobal.options[optionName] = options[optionName];
        }
    }

    appGlobal.options.currentUiLanguage = browser.i18n.getUILanguage();

    // Preload cached feeds from local storage to serve immediately on popup open
    const cache = await browser.storage.local.get(["cachedFeeds", "cachedSavedFeeds", "rateLimitedUntil"]).catch(function () { return {}; });
    appGlobal.cachedFeeds = Array.isArray(cache.cachedFeeds) ? cache.cachedFeeds : [];
    appGlobal.cachedSavedFeeds = Array.isArray(cache.cachedSavedFeeds) ? cache.cachedSavedFeeds : [];

    // The alarm wakes a fresh worker, so the cooldown has to come back from storage
    appGlobal.rateLimitedUntil = Number(cache.rateLimitedUntil) || 0;

    // If we have a token, treat as logged in until a request proves otherwise
    appGlobal.isLoggedIn = Boolean(appGlobal.options.accessToken);
}

async function apiRequestWrapper(methodName, settings) {
    if (!appGlobal.options.accessToken) {
        setInactiveStatus();
        throw new Error("No access token available");
    }

    settings = settings || {};

    /*
     * Only reads are held back. They are the polling traffic that spends the quota, and
     * updateCounter, updateFeeds and updateSavedFeeds all stop before reaching this. A
     * write is something the user just asked for, so refusing it without trying would
     * make the extension look broken for the whole cooldown -- and if feedly really is
     * still refusing, the 429 that comes back refreshes the deadline anyway.
     */
    if ((!settings.method || settings.method === "GET") && isRateLimited()) {
        throw createRateLimitError();
    }

    try {
        const response = await appGlobal.feedlyApiClient.request(methodName, settings);
        setActiveStatus();
        return response;
    } catch (response) {
        // Ahead of the 401 branch, so a 429 can never be mistaken for an expired token
        if (response?.status === 429) {
            await startRateLimitCooldown(response);
            throw response;
        }

        if (response?.status !== 401) {
            throw response;
        }

        await refreshAccessToken();

        return await retryAfterRefresh(methodName, settings);
    }
}

/*
 * The retry deliberately bypasses the wrapper, so it cannot loop, but it still needs the
 * cooldown: a token can expire while the account is already close to its quota, which
 * would otherwise leave the 429 unnoticed.
 */
async function retryAfterRefresh(methodName, settings) {
    try {
        return await appGlobal.feedlyApiClient.request(methodName, settings);
    } catch (response) {
        if (response?.status === 429) {
            await startRateLimitCooldown(response);
        }

        throw response;
    }
}

/* Carries the status, so callers branch on it the way they do for a real api response. */
function createRateLimitError() {
    const error = new Error("Rate limited by feedly");
    error.status = 429;

    return error;
}
