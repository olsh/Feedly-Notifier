"use strict";

// MV3 background service worker wrapper that loads existing logic
// and exposes message-based APIs for popup/options.

// Load polyfill and core logic (relative to this file in /scripts)
importScripts('browser-polyfill.min.js', 'feedly.api.js', 'core.js');

// Route messages from UI pages to background functions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        switch (message && message.type) {
            case 'getState': {
                sendResponse({
                    options: appGlobal.options,
                    environment: appGlobal.environment,
                    isLoggedIn: appGlobal.isLoggedIn || false
                });
                return false;
            }
            case 'getOptions': {
                sendResponse({ options: appGlobal.options });
                return false;
            }
            case 'getFeeds': {
                getFeeds(Boolean(message.forceUpdate), function (feeds, isLoggedIn) {
                    sendResponse({ feeds, isLoggedIn });
                });
                return true;
            }
            case 'getSavedFeeds': {
                getSavedFeeds(Boolean(message.forceUpdate), function (feeds, isLoggedIn) {
                    sendResponse({ feeds, isLoggedIn });
                });
                return true;
            }
            case 'markAsRead': {
                markAsRead(message.feedIds || [], function (ok) {
                    sendResponse({ ok: !!ok });
                });
                return true;
            }
            case 'toggleSavedFeed': {
                toggleSavedFeed(message.feedIds || [], !!message.save, function (ok) {
                    sendResponse({ ok: !!ok });
                });
                return true;
            }
            case 'openFeedlyTab': {
                openFeedlyTab();
                sendResponse({ ok: true });
                return false;
            }
            case 'resetCounter': {
                if (typeof resetCounter === 'function') {
                    resetCounter();
                }
                sendResponse({ ok: true });
                return false;
            }
            case 'getFeedTabId': {
                sendResponse({ feedTabId: appGlobal.feedTabId || null });
                return false;
            }
            case 'setFeedTabId': {
                appGlobal.feedTabId = message.tabId;
                sendResponse({ ok: true });
                return false;
            }
            case 'getAccessToken': {
                getAccessToken(function () {
                    sendResponse({ ok: true });
                });
                return true;
            }
            default: {
                sendResponse({ error: 'Unknown message type' });
                return false;
            }
        }
    } catch (e) {
        try { console.error('background message error', e); } catch (_) {}
        sendResponse({ error: 'Internal error' });
        return false;
    }
});
