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
browser.runtime.onMessage.addListener(async (message, sender) => {
    try {
        await ensureInitialized();
        
        switch (message && message.type) {
            case "getState":
                return {
                    options: appGlobal.options,
                    environment: appGlobal.environment,
                    isLoggedIn: appGlobal.isLoggedIn || false
                };
            case "getOptions":
                return { options: appGlobal.options };
            case "getFeeds":
                return await getFeeds(Boolean(message.forceUpdate));
            case "getSavedFeeds":
                return await getSavedFeeds(Boolean(message.forceUpdate));
            case "markAsRead": {
                const markResult = await markAsRead(message.feedIds || []);
                return { ok: !!markResult };
            }
            case "toggleSavedFeed": {
                const toggleResult = await toggleSavedFeed(message.feedIds || [], !!message.save);
                return { ok: !!toggleResult };
            }
            case "openFeedlyTab":
                await openFeedlyTab();
                return { ok: true };
            case "resetCounter":
                if (typeof resetCounter === "function") {
                    await Promise.resolve(resetCounter());
                }
                return { ok: true };
            case "getFeedTabId":
                return { feedTabId: appGlobal.feedTabId || null };
            case "setFeedTabId":
                appGlobal.feedTabId = message.tabId;
                return { ok: true };
            case "getAccessToken":
                await getAccessToken();
                return { ok: true };
            default:
                return { error: "Unknown message type" };
        }
    } catch (e) {
        console.error("background message error", e);
        return { error: "Internal error" };
    }
});
