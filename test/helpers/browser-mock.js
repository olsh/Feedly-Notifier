/**
 * A hand-rolled stub of the promise-based `webextension-polyfill` API surface.
 *
 * Deliberately not `sinon-chrome`: that package models the callback-style
 * `chrome.*` API, whereas this extension is written against the promise-based
 * polyfill. Only the surfaces actually used by src/scripts/*.js are stubbed --
 * see `grep -oh "browser\.[a-zA-Z]*\.[a-zA-Z]*" src/scripts/*.js`.
 */

/* Records its listeners so tests can fire events by hand. */
function createEvent(name, registry) {
    const listeners = [];
    registry[name] = listeners;
    return {
        addListener(fn) {
            listeners.push(fn);
        },
        removeListener(fn) {
            const index = listeners.indexOf(fn);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        },
        hasListener(fn) {
            return listeners.indexOf(fn) !== -1;
        },
        /* Test helper: invoke every registered listener and await them all. */
        async trigger(...args) {
            return Promise.all(listeners.map(fn => fn(...args)));
        }
    };
}

/**
 * A storage area backed by a plain object, honouring the three `get` shapes
 * core.js actually calls: `get(null)`, `get("key")` and `get(["a", "b"])`.
 */
function createStorageArea(initial) {
    const data = Object.assign({}, initial);

    return {
        /* Exposed so tests can seed or assert without going through promises. */
        _data: data,
        async get(keys) {
            if (keys === null || keys === undefined) {
                return Object.assign({}, data);
            }
            const wanted = Array.isArray(keys) ? keys : [keys];
            const result = {};
            for (const key of wanted) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    result[key] = data[key];
                }
            }
            return result;
        },
        async set(items) {
            Object.assign(data, items);
        },
        async remove(keys) {
            const unwanted = Array.isArray(keys) ? keys : [keys];
            for (const key of unwanted) {
                delete data[key];
            }
        },
        async clear() {
            for (const key of Object.keys(data)) {
                delete data[key];
            }
        }
    };
}

/**
 * Builds a fresh `browser` mock.
 *
 * @param {object} [overrides] - `{ version, os, storage: { local, sync, session } }`
 * @returns {object} the mock, with `_events` (listener registry) and `_calls`
 *                   (recorded mutating calls) attached for assertions.
 */
function createBrowserMock(overrides) {
    const options = overrides || {};
    const events = {};
    const calls = {
        setBadgeText: [],
        setIcon: [],
        setPopup: [],
        setBadgeBackgroundColor: [],
        alarmsCreated: [],
        alarmsCleared: [],
        notificationsCreated: [],
        notificationsCleared: [],
        tabsCreated: [],
        tabsUpdated: [],
        windowsCreated: [],
        messagesSent: []
    };

    let badgeText = "";

    const browser = {
        _events: events,
        _calls: calls,

        runtime: {
            getManifest: () => ({ version: options.version || "3.2.0" }),
            getPlatformInfo: async () => ({ os: options.os || "win" }),
            sendMessage: async (message) => {
                calls.messagesSent.push(message);
                return undefined;
            },
            onInstalled: createEvent("runtime.onInstalled", events),
            onStartup: createEvent("runtime.onStartup", events),
            onMessage: createEvent("runtime.onMessage", events)
        },

        storage: {
            local: createStorageArea(options.storage && options.storage.local),
            sync: createStorageArea(options.storage && options.storage.sync),
            session: createStorageArea(options.storage && options.storage.session),
            onChanged: createEvent("storage.onChanged", events)
        },

        tabs: {
            create: async (props) => {
                calls.tabsCreated.push(props);
                return { id: calls.tabsCreated.length, url: props.url };
            },
            update: async (tabId, props) => {
                calls.tabsUpdated.push({ tabId, props });
                return { id: tabId, url: props.url };
            },
            query: async () => [],
            reload: async () => undefined,
            onRemoved: createEvent("tabs.onRemoved", events),
            onUpdated: createEvent("tabs.onUpdated", events)
        },

        windows: {
            create: async (props) => {
                calls.windowsCreated.push(props);
                return { id: calls.windowsCreated.length };
            },
            getAll: async () => []
        },

        webRequest: {
            onCompleted: createEvent("webRequest.onCompleted", events)
        },

        action: {
            getBadgeText: async () => badgeText,
            setBadgeText: async (details) => {
                badgeText = details.text;
                calls.setBadgeText.push(details.text);
            },
            setIcon: async (details) => {
                calls.setIcon.push(details.path);
            },
            setPopup: async (details) => {
                calls.setPopup.push(details.popup);
            },
            setBadgeBackgroundColor: async (details) => {
                calls.setBadgeBackgroundColor.push(details.color);
            },
            onClicked: createEvent("action.onClicked", events)
        },

        alarms: {
            create: (name, info) => {
                calls.alarmsCreated.push({ name, info });
            },
            clear: (name) => {
                calls.alarmsCleared.push(name);
            },
            onAlarm: createEvent("alarms.onAlarm", events)
        },

        notifications: {
            create: (id, notification) => {
                calls.notificationsCreated.push({ id, notification });
            },
            clear: (id) => {
                calls.notificationsCleared.push(id);
            },
            onClicked: createEvent("notifications.onClicked", events),
            onButtonClicked: createEvent("notifications.onButtonClicked", events)
        },

        i18n: {
            getMessage: (key) => key,
            getUILanguage: () => options.uiLanguage || "en"
        },

        permissions: {
            contains: async () => options.hasAllSitesPermission !== false,
            request: async () => options.grantPermission !== false
        }
    };

    /* Chromium-only surfaces. Omitted when simulating Firefox. */
    if (options.sidePanel !== false) {
        browser.sidePanel = {
            setOptions: async () => undefined,
            setPanelBehavior: async () => undefined,
            open: async () => undefined
        };
    }

    if (options.sidebarAction) {
        browser.sidebarAction = {
            isOpen: async () => Boolean(options.sidebarOpen)
        };
    }

    return browser;
}

export { createBrowserMock, createStorageArea, createEvent };
