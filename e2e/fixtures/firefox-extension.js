const base = require("@playwright/test");

const { mockApiFixture } = require("./feedly-server");
const { USER_ID } = require("./feed-items");
const { FIREFOX_BUILD_DIR, pointBuildAtMockServer } = require("./build");
const {
    ADDON_ID,
    EXTENSION_UUID,
    WIDGET_ID,
    extensionUrl,
    createDriver,
    evaluateInPage,
    evaluateInBackground,
    evaluateInChrome
} = require("./firefox-driver");

/*
 * Where signIn() seeds the options.
 *
 * storage.sync is what the extension itself writes at install, so it is what the suite
 * mirrors. If it ever turns out to be unreliable for a temporarily installed add-on --
 * which is the one part of this harness with no documented guarantee -- flipping this to
 * true seeds storage.local instead and sets disableOptionsSync, which makes
 * appGlobal.syncStorage (core.js) read local. That is a shipped option, not a test hook,
 * so the extension under test stays the extension users get.
 */
const SEED_INTO_LOCAL = false;

/* The event page takes a beat longer to answer than a service worker, and every step here
   crosses geckodriver rather than a devtools socket. */
const POLL = { timeout: 15000 };

const test = base.test.extend({
    /** A mock Feedly API on an ephemeral port, reset for every test. */
    mockApi: mockApiFixture,

    /**
     * A firefox session with the unpacked firefox build installed as a temporary add-on.
     *
     * `headless` is playwright's own option, so --headed reaches this project too even
     * though nothing here is a playwright browser.
     */
    driver: async ({ mockApi, headless }, use) => {
        pointBuildAtMockServer(FIREFOX_BUILD_DIR);

        const driver = await createDriver({ mockPort: mockApi.port, headless });

        await use(driver);
        await driver.quit();
    },

    extension: async ({}, use) => {
        await use({ id: ADDON_ID, uuid: EXTENSION_UUID, widgetId: WIDGET_ID, url: extensionUrl });
    },

    /**
     * Opens an extension page in its own tab and hands back a handle on it.
     *
     * Selenium has one focus for the whole session rather than a page object per tab, so
     * every method switches to its own tab first. Reading the DOM goes through evaluate()
     * as well: the xray the injected script sees is the real document, and one mechanism
     * is easier to reason about than two.
     */
    openExtensionPage: async ({ driver }, use) => {
        const open = async (page) => {
            await driver.switchTo().newWindow("tab");
            const handle = await driver.getWindowHandle();
            await driver.get(extensionUrl(page));

            const focus = () => driver.switchTo().window(handle);

            return {
                handle,
                focus,
                evaluate: async (fn, arg) => {
                    await focus();
                    return evaluateInPage(driver, fn, arg);
                },
                count: async (selector) => {
                    await focus();
                    return evaluateInPage(driver, (browser, css) =>
                        document.querySelectorAll(css).length, selector);
                },
                visible: async (selector) => {
                    await focus();
                    return evaluateInPage(driver, (browser, css) => {
                        const element = document.querySelector(css);
                        return Boolean(element?.getClientRects().length);
                    }, selector);
                }
            };
        };

        await use(open);
    },

    /**
     * The extension page every fixture below evaluates through.
     *
     * popup.html rather than options.html: options.js only marks itself loaded once
     * loadOptions, loadUserCategories and loadProfileData have all resolved, and signed
     * out the last two reject, so waiting for it the way the chromium harness does would
     * hang. The popup renders its login prompt signed out, and its DOMContentLoaded sends
     * getState, which boots the event page before anything polls for it.
     */
    controlPage: async ({ driver }, use) => {
        //The session already has a tab; use it rather than leaving a blank one behind.
        await driver.get(extensionUrl("popup.html"));
        const handle = await driver.getWindowHandle();
        const focus = () => driver.switchTo().window(handle);

        await use({
            handle,
            focus,
            evaluate: async (fn, arg) => {
                await focus();
                return evaluateInPage(driver, fn, arg);
            }
        });
    },

    /**
     * The event page, reached the way the chromium harness reaches its service worker.
     *
     * `evaluate` goes through runtime.getBackgroundPage(), which firefox still supports in
     * MV3 and which starts a suspended event page -- convenient everywhere except
     * sidebar-cold-start.spec.js, which must not wake it by accident. `send` goes through
     * the runtime.onMessage router background.js already exposes, and is the one to prefer
     * where it suffices: it is the public surface, so a firefox that dropped
     * getBackgroundPage would cost far less.
     */
    background: async ({ driver, controlPage }, use) => {
        await use({
            evaluate: async (fn, arg) => {
                await controlPage.focus();
                return evaluateInBackground(driver, fn, arg);
            },
            send: (message) => controlPage.evaluate(
                (browser, payload) => browser.runtime.sendMessage(payload), message)
        });
    },

    /**
     * Signs the extension in by seeding storage, then waits for the event page to notice.
     * Seeding accessToken fires storage.onChanged, which re-reads the options and restarts
     * the schedule, so the extension starts calling the mock immediately -- prime `mockApi`
     * before using this.
     */
    signIn: async ({ controlPage, background }, use) => {
        const signIn = async (options = {}) => {
            /*
             * On a fresh profile the extension's runtime.onInstalled handler runs
             * readOptions() then writeOptions(), which persists the whole default option
             * set -- including an empty accessToken. Seeding before that lands gets
             * silently overwritten, so wait for the defaults to appear first.
             * `updateInterval` is only ever written by writeOptions(), which makes it a
             * reliable sentinel. It is always storage.sync here whatever SEED_INTO_LOCAL
             * says: disableOptionsSync is still false when the install-time write runs.
             */
            await base.expect.poll(
                () => controlPage.evaluate(browser =>
                    browser.storage.sync.get("updateInterval")
                        .then(stored => stored.updateInterval !== undefined)),
                { message: "extension never wrote its default options", ...POLL }
            ).toBe(true);

            const written = await controlPage.evaluate(async (browser, payload) => {
                await browser.storage.local.set({ disableOptionsSync: payload.seedIntoLocal });
                const area = payload.seedIntoLocal ? browser.storage.local : browser.storage.sync;

                /*
                 * The storage backend can silently drop writes while it starts up in a
                 * fresh profile: set() resolves, but a following get() returns nothing.
                 * Write until it sticks.
                 */
                for (let attempt = 0; attempt < 20; attempt++) {
                    await area.set(payload.values);
                    const stored = await area.get("accessToken");
                    if (stored.accessToken === payload.values.accessToken) {
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                return false;
            }, {
                seedIntoLocal: SEED_INTO_LOCAL,
                values: {
                    accessToken: "e2e-access-token",
                    refreshToken: "e2e-refresh-token",
                    feedlyUserId: USER_ID,
                    ...options
                }
            });

            base.expect(
                written,
                "storage never accepted the seeded options -- see SEED_INTO_LOCAL in e2e/fixtures/firefox-extension.js"
            ).toBe(true);

            await base.expect.poll(
                () => background.evaluate(bg => bg.appGlobal.options.accessToken),
                { message: "the event page never picked up the seeded access token", ...POLL }
            ).toBe("e2e-access-token");
        };

        await use(signIn);
    },

    /**
     * The browser chrome, and what the sidebar specs need from it.
     *
     * terminateBackground and backgroundState are firefox internals rather than public
     * apis, so each is used in exactly one place and says so plainly if the shape it
     * expects has gone.
     */
    browserChrome: async ({ driver }, use) => {
        await use({
            evaluate: (fn, arg) => evaluateInChrome(driver, fn, arg),

            /* Extension buttons land in the unified extensions panel rather than on the
               toolbar since firefox 109, so there is nothing in the navigation bar to
               click until this runs. It is the call the "Pin to Toolbar" menu item makes.

               CustomizableUI off the browser window rather than imported: the module has
               already moved between resource:/// and moz-src:///, and the window has
               carried the getter throughout. */
            pinToolbarButton: () => evaluateInChrome(driver, widgetId => {
                if (typeof CustomizableUI === "undefined") {
                    throw new TypeError("this firefox no longer exposes CustomizableUI on the browser window");
                }

                CustomizableUI.addWidgetToArea(widgetId, CustomizableUI.AREA_NAVBAR);
                return CustomizableUI.getPlacementOfWidget(widgetId).area;
            }, WIDGET_ID),

            /* The widget CustomizableUI places is a toolbaritem wrapper, and clicking it
               does nothing at all -- the listener firefox attaches for the extension is on
               the toolbarbutton inside it. Get that right and an ordinary click is enough:
               firefox dispatches action.onClicked with user input already being handled, so
               sidebarAction.toggle() accepts the gesture without any event synthesis. */
            clickToolbarButton: () => evaluateInChrome(driver, widgetId => {
                const widget = document.getElementById(widgetId);
                if (!widget) {
                    throw new Error("the toolbar button is not in the navigation bar");
                }

                const button = widget.querySelector(".webextension-browser-action")
                    || widget.querySelector("toolbarbutton");
                if (!button) {
                    throw new Error("the toolbar widget has no button inside it");
                }

                if (!button.getBoundingClientRect().width) {
                    throw new Error("the toolbar button has not been laid out yet");
                }

                button.click();
                return true;
            }, WIDGET_ID),

            /* What about:debugging's "Terminate Background Script" button calls. */
            terminateBackground: () => evaluateInChrome(driver, addonId => {
                const policy = WebExtensionPolicy.getByID(addonId);
                const extension = policy?.extension;

                if (!extension || typeof extension.terminateBackground !== "function") {
                    throw new Error("this firefox no longer exposes Extension#terminateBackground");
                }

                return Promise.resolve(extension.terminateBackground()).then(() => true);
            }, ADDON_ID),

            /* "starting" | "running" | "suspending" | "stopped". Read from the parent
               process, so unlike getBackgroundPage() it never wakes what it is reporting
               on -- which is the whole reason the cold start test can prove anything. */
            backgroundState: () => evaluateInChrome(driver, addonId => {
                const policy = WebExtensionPolicy.getByID(addonId);
                const extension = policy?.extension;

                if (extension?.backgroundState === undefined) {
                    throw new Error("this firefox no longer exposes Extension#backgroundState");
                }

                return extension.backgroundState;
            }, ADDON_ID)
        });
    },

    /**
     * Whether the extension's sidebar is open in the window under test.
     *
     * sidebarAction.isOpen rather than SidebarController or the sidebar-box element: the
     * chrome dom around the sidebar churns between releases (154 has the revamp) while the
     * api does not, and this is a parent-process query, so asking does not wake the event
     * page.
     */
    sidebarIsOpen: async ({ controlPage }, use) => {
        await use(() => controlPage.evaluate(browser =>
            browser.windows.getCurrent()
                .then(current => browser.sidebarAction.isOpen({ windowId: current.id }))));
    },

    /**
     * Playwright's screenshot-on-failure and trace hang off a browser context this project
     * does not have, so the equivalent is done by hand. The request log matters more than
     * the picture: most failures here are the event page not having asked for something,
     * which no screenshot can show.
     */
    artifacts: [async ({ driver, mockApi }, use, testInfo) => {
        await use();

        if (testInfo.status === testInfo.expectedStatus) {
            return;
        }

        /* A test usually fails because the browser is in a state nobody expected, which
           is also the state least likely to answer a screenshot request. Losing the
           picture is survivable; losing the request log below, or replacing the real
           failure with one from the reporting code, is not. */
        try {
            await testInfo.attach("firefox-screenshot", {
                body: Buffer.from(await driver.takeScreenshot(), "base64"),
                contentType: "image/png"
            });
        } catch (error) {
            await testInfo.attach("firefox-screenshot-failed", {
                body: String(error),
                contentType: "text/plain"
            });
        }

        await testInfo.attach("feedly-mock-requests", {
            body: JSON.stringify(mockApi.requests, null, 4),
            contentType: "application/json"
        });
    }, { auto: true }]
});

const expect = base.expect;

/*
 * `toPass()` defaults to no timeout, so a failing condition would spin until the test's own
 * limit and report the timeout rather than the assertion.
 */
const RETRY = { timeout: 15000 };

module.exports = { test, expect, RETRY, POLL };
