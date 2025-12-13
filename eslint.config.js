const js = require("@eslint/js");
const globals = require("globals");
const { fixupPluginRules } = require("@eslint/compat");
const jqueryPlugin = require("eslint-plugin-jquery");

module.exports = [
    // Ignore patterns
    {
        ignores: [
            "node_modules/**",
            "build/**",
            "test-results/**",
            "logos/**",
            "translations/**",
            "src/styles/**",
            "src/images/**",
            "src/_locales/**",
            "src/sound/**"
        ]
    },

    // Base configuration for all JS files
    {
        files: ["**/*.js"],
        ...js.configs.recommended,
        plugins: {
            jquery: fixupPluginRules(jqueryPlugin)
        },
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "script",
            globals: {
                ...globals.browser,
                ...globals.es2021,
                browser: "readonly",
                chrome: "readonly",
                $: "readonly",
                jQuery: "readonly",
                Mustache: "readonly",
                DOMPurify: "readonly",
                timeago: "readonly",
                importScripts: "readonly"
            }
        },
        rules: {
            indent: ["error", 4, { SwitchCase: 1 }],
            quotes: ["error", "double", { avoidEscape: true }],
            semi: ["error", "always"],
            curly: ["error", "all"],
            "no-console": "off",
            "no-unused-vars": ["warn", { args: "none" }],
            "no-var": "off",
            "no-empty": ["warn", { allowEmptyCatch: false }],
            "jquery/no-ready": "warn"
        }
    },

    // Background script overrides
    {
        files: ["src/scripts/background.js"],
        languageOptions: {
            globals: {
                appGlobal: "readonly",
                getFeeds: "readonly",
                getSavedFeeds: "readonly",
                markAsRead: "readonly",
                toggleSavedFeed: "readonly",
                openFeedlyTab: "readonly",
                resetCounter: "readonly",
                getAccessToken: "readonly",
                readOptions: "readonly",
                initialize: "readonly"
            }
        }
    },

    // Gruntfile configuration
    {
        files: ["Gruntfile.js"],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },

    // Core and options scripts
    {
        files: ["src/scripts/core.js", "src/scripts/options.js"],
        languageOptions: {
            globals: {
                FeedlyApiClient: "readonly"
            }
        }
    }
];
