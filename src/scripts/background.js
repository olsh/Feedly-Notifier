"use strict";

// MV3 background service worker wrapper that loads existing logic
// and exposes message-based APIs for popup/options.

// Load polyfill and core logic (relative to this file in /scripts)
importScripts('browser-polyfill.min.js', 'feedly.api.js', 'core.js');

// Route messages from UI pages to background functions
browser.runtime.onMessage.addListener((message, sender) => {
    try {
        switch (message && message.type) {
            case 'getState':
                return Promise.resolve({
                    options: appGlobal.options,
                    environment: appGlobal.environment,
                    isLoggedIn: appGlobal.isLoggedIn || false
                });
            case 'getOptions':
                return Promise.resolve({ options: appGlobal.options });
            case 'getFeeds':
                return getFeeds(Boolean(message.forceUpdate));
            case 'getSavedFeeds':
                return getSavedFeeds(Boolean(message.forceUpdate));
            case 'markAsRead':
                return markAsRead(message.feedIds || []).then(ok => ({ ok: !!ok }));
            case 'toggleSavedFeed':
                return toggleSavedFeed(message.feedIds || [], !!message.save).then(ok => ({ ok: !!ok }));
            case 'openFeedlyTab':
                return openFeedlyTab().then(() => ({ ok: true }));
            case 'resetCounter':
                return (typeof resetCounter === 'function' ? Promise.resolve(resetCounter()) : Promise.resolve()).then(() => ({ ok: true }));
            case 'getFeedTabId':
                return Promise.resolve({ feedTabId: appGlobal.feedTabId || null });
            case 'setFeedTabId':
                appGlobal.feedTabId = message.tabId;
                return Promise.resolve({ ok: true });
            case 'getAccessToken':
                return getAccessToken().then(() => ({ ok: true }));
            default:
                return Promise.resolve({ error: 'Unknown message type' });
        }
    } catch (e) {
        try { console.error('background message error', e); } catch (_) {}
        return Promise.resolve({ error: 'Internal error' });
    }
});
