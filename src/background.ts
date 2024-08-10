import { AppOptions } from "./options/appOptions";
import { Badge } from "./services/badge";
import { FeedlyService } from "./services/feedlyService";
import { OptionsService } from "./services/optionsService";

console.log('Background script loaded');
const optionsService = await OptionsService.createAsync();
const feedlyService = await FeedlyService.createAsync();
await loadStateAsync();

chrome.runtime.onInstalled.addListener(async function () {
    const options = optionsService.getOptions();
    await initialize(options);
});

chrome.runtime.onStartup.addListener(async function () {
    const options = optionsService.getOptions();
    await initialize(options);
});

chrome.storage.onChanged.addListener(async function (changes, areaName) {
    if (changes.auth?.newValue == null) {
        await chrome.alarms.clearAll();
    } else {
        const options = optionsService.getOptions();
        await initialize(options);
    }

    if (changes.options?.newValue) {
        const newOptions = changes.options.newValue as AppOptions;
        const oldOptions = changes.options.oldValue as AppOptions;

        setPopup(!newOptions.openSiteOnIconClick);

        if (oldOptions.updateInterval !== newOptions.updateInterval ||
            oldOptions.showCounter !== newOptions.showCounter ||
            oldOptions.openSiteOnIconClick !== newOptions.openSiteOnIconClick ||
            oldOptions.showDesktopNotifications !== newOptions.showDesktopNotifications ||
            oldOptions.playSound !== newOptions.playSound
        ) {
            await initAlarms(newOptions)
        }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'getOptions': {
            sendResponse(optionsService.getOptions());
            return true;
        }
        case 'setOptions': {
            optionsService.setOptions(message.data).then(sendResponse);
            return true;
        }
        case 'clearStorage': {
            optionsService.clearStorage();
            return true;
        }
        case 'login': {
            feedlyService.getAccessToken().then(sendResponse);
            return true;
        }
        case 'logout': {
            feedlyService.logout();
            return true;
        }
        case 'getOptionsFeedlyData': {
            feedlyService.getCategoriesAndProfileAsync().then(sendResponse);
            return true;
        }
        case 'getFeeds': {
            feedlyService.getCachedFeedsAsync(true).then(sendResponse);
            return true;
        }
    }
});

/* Listener for adding or removing feeds on the feedly website */
chrome.webRequest.onCompleted.addListener(function (details) {
    if (details.method === "POST" || details.method === "DELETE") {
        //TODO: implement
        updateCounter();
        //updateFeeds();
        //appGlobal.getUserSubscriptionsPromise = null;
    }
}, { urls: ["*://*.feedly.com/v3/subscriptions*", "*://*.feedly.com/v3/markers?*ct=feedly.desktop*"] });

/* Listener for adding or removing saved feeds */
chrome.webRequest.onCompleted.addListener(function (details) {
    if (details.method === "PUT" || details.method === "DELETE") {
        //TODO: implement
        //updateSavedFeeds();
    }
}, { urls: ["*://*.feedly.com/v3/tags*global.saved*"] });

chrome.action.onClicked.addListener(async function () {
    if (feedlyService.isLoggedIn()) {
        chrome.tabs.create({url: "https://feedly.com"});
        if(optionsService.getOptions().resetCounterOnClick){
            resetCounter();
        }
    } else {
        await feedlyService.getAccessToken();
    }
});

chrome.notifications.onClicked.addListener(function (notificationId) {
    chrome.notifications.clear(notificationId);

    //TODO: implement
    // if (appGlobal.notifications[notificationId]) {
    //     openUrlInNewTab(appGlobal.notifications[notificationId], true);
    //     if (appGlobal.options.markReadOnClick) {
    //         markAsRead([notificationId]);
    //     }
    // }

    // appGlobal.notifications[notificationId] = undefined;
});

chrome.notifications.onButtonClicked.addListener(function (notificationId, button) {
    //TODO: implement
    // if (button !== 0) {
    //     // Unknown button index
    //     return;
    // }

    // // The "Mark as read button has been clicked"
    // if (appGlobal.notifications[notificationId]) {
    //     markAsRead([notificationId]);
    //     chrome.notifications.clear(notificationId);
    // }

    // appGlobal.notifications[notificationId] = undefined;
});


async function initialize(options: AppOptions) {
    console.log('Initializing....');
    setPopup(!options.openSiteOnIconClick);

    //TODO: save OS in options
    // chrome.runtime.getPlatformInfo(function (platformInfo) {
    //     appGlobal.environment.os = platformInfo.os;
    // });

    updateCounter();

    await chrome.alarms.clearAll();

    if (options.showCounter) {
        await chrome.alarms.create('update-counter', {
            periodInMinutes: options.updateInterval
        });
    }

    if (options.showDesktopNotifications || options.playSound || !options.openSiteOnIconClick) {
        await chrome.alarms.create('update-feeds', {
            periodInMinutes: options.updateInterval
        });
    }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'update-feeds') {
        console.log(`${new Date()} Updating feed....`);
    }

    if (alarm.name === 'update-counter') {
        console.log(`${new Date()} Updating counter....`);
        updateCounter();
    }
});

async function setPopup(enabled: boolean) {
    if (enabled) {
        chrome.action.setPopup({ popup: "popup.html" });
    } else {
        chrome.action.setPopup({ popup: "" });
    }
}

async function initAlarms(options: AppOptions) {
    await chrome.alarms.clearAll();

    if (options.showCounter) {
        await chrome.alarms.create('update-counter', {
            periodInMinutes: options.updateInterval,
        });
    }

    if (options.showDesktopNotifications || options.playSound || !options.openSiteOnIconClick) {
        await chrome.alarms.create('update-feeds', {
            periodInMinutes: options.updateInterval
        });
    }
}

function resetCounter(){
    Badge.setBadgeCount(0, optionsService.getOptions());
    chrome.storage.local.set({ lastCounterResetTime: new Date().getTime() });
}

function updateCounter() {
    const options = optionsService.getOptions();
    let parameters = new URLSearchParams();

    if (options.resetCounterOnClick) {
        chrome.storage.local.get("lastCounterResetTime", function (options) {
            if (options.lastCounterResetTime) {
                parameters = new URLSearchParams({
                    newerThan: options.lastCounterResetTime
                });
            }
        });
    } else {
        chrome.storage.local.set({lastCounterResetTime: new Date(0).getTime()});
    }

    getUnreadCountAsync(parameters, options).then(function (unreadCount) {
        Badge.setBadgeCount(unreadCount, options);
    });
}

async function getUnreadCountAsync(parameters: URLSearchParams, options: AppOptions) {
    const counts = await feedlyService.getCountsAsync(parameters);
    const subscriptions = await feedlyService.getSubscriptionsAsync();
    let unreadFeedsCount = 0;

    counts.unreadcounts.forEach(function (element) {
        if (options.filters.indexOf(element.id) !== -1) {
            unreadFeedsCount += element.count;
        }
    });

    // When feed consists in more than one category, we remove feed which was counted twice or more
    subscriptions.forEach(function (subscription) {
        let numberOfDupesCategories = 0;
        subscription.categories.forEach(function(category){
            if(options.filters.indexOf(category.id) !== -1){
                numberOfDupesCategories++;
            }
        });

        if(numberOfDupesCategories > 1){
            for (let i = 0; i < counts.unreadcounts.length; i++) {
                if (subscription.id === counts.unreadcounts[i].id) {
                    unreadFeedsCount -= counts.unreadcounts[i].count * --numberOfDupesCategories;
                    break;
                }
            }
        }
    });

    return unreadFeedsCount;
}

async function loadStateAsync() {
    chrome.storage.local.get("unreadFeedsCount", function (options) {
        if (options.unreadFeedsCount) {
            Badge.setBadgeCount(options.unreadFeedsCount as number, optionsService.getOptions());
        } else {
            updateCounter();
        }
    });
}
