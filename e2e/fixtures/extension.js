const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const base = require("@playwright/test");

const { FeedlyMockServer } = require("./feedly-server");
const { USER_ID } = require("./feed-items");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const BUILD_DIR = path.join(PROJECT_ROOT, "build");

/**
 * Rewrites the API scheme in the built extension from https to http, so the
 * plain-HTTP mock server can answer.
 *
 * Only the scheme changes -- the host stays cloud.feedly.com, which is what
 * lets the shipped `*://*.feedly.com/*` host permission keep working and keeps
 * the manifest untouched. `--host-resolver-rules` then sends that host to the
 * mock. Idempotent, so repeated runs over one build are safe.
 */
function pointBuildAtMockServer() {
    const apiFile = path.join(BUILD_DIR, "scripts", "feedly.api.js");

    if (!fs.existsSync(apiFile)) {
        throw new Error(
            `Built extension not found at ${BUILD_DIR}. Run \`npm run build:e2e\` first.`
        );
    }

    const source = fs.readFileSync(apiFile, "utf8");
    // Downgrading to plain HTTP is the point: it lets the loopback mock answer
    // without a self-signed certificate. Test builds only, never shipped.
    const rewritten = source.replace("https://cloud.feedly.com/v3/", "http://cloud.feedly.com/v3/"); // NOSONAR

    if (rewritten !== source) {
        fs.writeFileSync(apiFile, rewritten);
    }
}

const test = base.test.extend({
    /** A mock Feedly API on an ephemeral port, reset for every test. */
    mockApi: async ({}, use) => {
        const server = new FeedlyMockServer();
        await server.start();
        await use(server);
        await server.stop();
    },

    /**
     * A persistent context with the unpacked extension loaded.
     *
     * Extensions require a persistent context and Playwright's bundled
     * Chromium: Chrome and Edge have removed the side-loading flags. This does
     * work headless, so CI needs no xvfb.
     */
    context: async ({ mockApi }, use) => {
        pointBuildAtMockServer();

        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "feedly-notifier-e2e-"));
        const context = await base.chromium.launchPersistentContext(userDataDir, {
            channel: "chromium",
            args: [
                `--disable-extensions-except=${BUILD_DIR}`,
                `--load-extension=${BUILD_DIR}`,
                /*
                 * Send the API host to the mock, and fail every other lookup so
                 * the suite can never reach the real network. example-blog.com
                 * is the host in the feed fixtures; pointing it at the mock too
                 * means article tabs actually navigate, so their URLs stay
                 * assertable instead of collapsing to chrome-error://.
                 */
                "--host-resolver-rules=" + [
                    `MAP cloud.feedly.com 127.0.0.1:${mockApi.port}`,
                    `MAP example-blog.com 127.0.0.1:${mockApi.port}`,
                    "MAP * ~NOTFOUND",
                    "EXCLUDE 127.0.0.1"
                ].join(",")
            ]
        });

        await use(context);
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    },

    /**
     * The extension's service worker.
     *
     * Exposed as a wrapper rather than the raw handle because MV3 recycles
     * workers: a handle captured at the start of a test goes stale the moment
     * Chrome restarts the worker, and every later evaluate() on it throws. That
     * failure is invisible inside a toPass() loop, which just retries until its
     * budget expires. So re-acquire the live worker on each call and retry once
     * if it dies mid-evaluate.
     */
    serviceWorker: async ({ context }, use) => {
        const current = async () => {
            const [worker] = context.serviceWorkers();
            return worker || context.waitForEvent("serviceworker");
        };

        const initial = await current();
        const isGone = (error) => /destroyed|closed|Target|Execution context/i.test(String(error));

        await use({
            // The extension id is fixed for the profile, so this stays valid.
            url: () => initial.url(),
            evaluate: async (fn, arg) => {
                const worker = await current();
                try {
                    return await worker.evaluate(fn, arg);
                } catch (error) {
                    if (!isGone(error)) {
                        throw error;
                    }
                    const restarted = await current();
                    return restarted.evaluate(fn, arg);
                }
            }
        });
    },

    extensionId: async ({ serviceWorker }, use) => {
        await use(serviceWorker.url().split("/")[2]);
    },

    /**
     * Signs the extension in by seeding storage, then waits for the background
     * to notice. Seeding accessToken fires storage.onChanged, which re-reads
     * the options and restarts the schedule, so the extension starts calling
     * the mock immediately -- prime `mockApi` before using this.
     */
    signIn: async ({ serviceWorker }, use) => {
        const signIn = async (options = {}) => {
            /*
             * On a fresh profile the extension's runtime.onInstalled handler
             * runs readOptions() then writeOptions(), which persists the whole
             * default option set -- including an empty accessToken. Seeding
             * before that lands gets silently overwritten, so wait for the
             * defaults to appear first. `updateInterval` is only ever written by
             * writeOptions(), which makes it a reliable sentinel.
             */
            await base.expect.poll(
                () => serviceWorker.evaluate(async () => {
                    const stored = await chrome.storage.sync.get("updateInterval");
                    return stored.updateInterval !== undefined;
                }),
                { message: "extension never wrote its default options" }
            ).toBe(true);

            const written = await serviceWorker.evaluate(async (values) => {
                await chrome.storage.local.set({ disableOptionsSync: false });

                /*
                 * chrome.storage.sync can also silently drop writes while its
                 * backend starts up in a fresh profile: set() resolves, but a
                 * following get() returns nothing. Write until it sticks.
                 */
                for (let attempt = 0; attempt < 20; attempt++) {
                    await chrome.storage.sync.set(values);
                    const stored = await chrome.storage.sync.get("accessToken");
                    if (stored.accessToken === values.accessToken) {
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                return false;
            }, {
                accessToken: "e2e-access-token",
                refreshToken: "e2e-refresh-token",
                feedlyUserId: USER_ID,
                ...options
            });

            base.expect(written, "chrome.storage.sync never accepted the seeded options").toBe(true);

            await base.expect.poll(
                () => serviceWorker.evaluate(() => globalThis.appGlobal.options.accessToken),
                { message: "background never picked up the seeded access token" }
            ).toBe("e2e-access-token");
        };

        await use(signIn);
    },

    /**
     * Opens the popup page the way the toolbar button would.
     *
     * `beforeNavigate` runs against the blank page before goto(), which is the
     * only way to observe events raised during navigation itself.
     */
    popupPage: async ({ context, extensionId }, use) => {
        const open = async (query = "", beforeNavigate) => {
            const page = await context.newPage();
            beforeNavigate?.(page);
            await page.goto(`chrome-extension://${extensionId}/popup.html${query}`);
            return page;
        };

        await use(open);
    },

    /**
     * Opens the options page and waits until it has finished populating.
     *
     * loadOptions() fills the form asynchronously after DOMContentLoaded, so a
     * test that types into a control before that completes has its input
     * overwritten by the stored value. options.js sets `optionsGlobal.loaded`
     * once all three loaders resolve, which is the signal to wait on.
     */
    optionsPage: async ({ context, extensionId }, use) => {
        const open = async () => {
            const page = await context.newPage();
            page.on("dialog", dialog => dialog.accept());
            await page.goto(`chrome-extension://${extensionId}/options.html`);
            await page.waitForFunction(() => window.optionsGlobal && window.optionsGlobal.loaded === true);
            return page;
        };

        await use(open);
    }
});

const expect = base.expect;

/*
 * `toPass()` defaults to no timeout, so a failing condition would spin until the
 * test's own 30s limit and report the timeout rather than the assertion. Give
 * every retry loop the same budget as the other assertions.
 */
const RETRY = { timeout: 10000 };

module.exports = { test, expect, RETRY, BUILD_DIR, PROJECT_ROOT };
