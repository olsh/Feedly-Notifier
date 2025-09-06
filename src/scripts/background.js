"use strict";

// MV3 background service worker wrapper that loads existing logic
// and exposes message-based APIs for popup/options.

// Load polyfill and core logic (relative to this file in /scripts)
importScripts("browser-polyfill.min.js", "feedly.api.js", "core.js");

// Ensure options/tokens are loaded after each worker start
let __initPromise = null;
function ensureInitialized() {
    if (!__initPromise) {
        __initPromise = (async () => {
            await readOptions();
            await initialize(false);
        })();
    }
    return __initPromise;
}

// Kick off initialization eagerly on worker boot
ensureInitialized();

// Route messages from UI pages to background functions
browser.runtime.onMessage.addListener((message, sender) => {
    const ready = ensureInitialized();
    try {
        switch (message && message.type) {
            case "getState":
                return ready.then(() => ({
                    options: appGlobal.options,
                    environment: appGlobal.environment,
                    isLoggedIn: appGlobal.isLoggedIn || false
                }));
            case "getOptions":
                return ready.then(() => ({ options: appGlobal.options }));
            case "getFeeds":
                return ready.then(() => getFeeds(Boolean(message.forceUpdate)));
            case "getSavedFeeds":
                return ready.then(() => getSavedFeeds(Boolean(message.forceUpdate)));
            case "markAsRead":
                return ready.then(() => markAsRead(message.feedIds || []).then(ok => ({ ok: !!ok })));
            case "toggleSavedFeed":
                return ready.then(() => toggleSavedFeed(message.feedIds || [], !!message.save).then(ok => ({ ok: !!ok })));
            case "openFeedlyTab":
                return ready.then(() => openFeedlyTab().then(() => ({ ok: true })));
            case "resetCounter":
                return ready.then(() => (typeof resetCounter === "function" ? Promise.resolve(resetCounter()) : Promise.resolve()).then(() => ({ ok: true })));
            case "getFeedTabId":
                return ready.then(() => ({ feedTabId: appGlobal.feedTabId || null }));
            case "setFeedTabId":
                return ready.then(() => { appGlobal.feedTabId = message.tabId; return { ok: true }; });
            case "getAccessToken":
                return ready.then(() => getAccessToken().then(() => ({ ok: true })));
            default:
                return Promise.resolve({ error: "Unknown message type" });
        }
    } catch (e) {
        console.error("background message error", e);
        return Promise.resolve({ error: "Internal error" });
    }
});
