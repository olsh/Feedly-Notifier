const { defineConfig } = require("@playwright/test");

/*
 * CommonJS on purpose: the package has no `"type": "module"`, and adding one
 * would break Gruntfile.js and eslint.config.js. The e2e specs are CommonJS for
 * the same reason.
 */
module.exports = defineConfig({
    testDir: "./e2e",
    testMatch: "**/*.spec.js",

    // Each test launches its own persistent context with the extension loaded,
    // so they are isolated but not cheap. Serial keeps the profiles apart.
    fullyParallel: false,
    workers: 1,

    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    timeout: 30000,
    expect: { timeout: 10000 },

    outputDir: "test-results",
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }]]
        : [["list"]],

    use: {
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "off"
    },

    projects: [
        {
            name: "chromium-extension",
            // MV3 extensions load only in Playwright's bundled Chromium;
            // Chrome and Edge dropped the side-loading flags.
            use: { channel: "chromium" }
        }
    ]
});
