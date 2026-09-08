const path = require("node:path");
const fs = require("node:fs");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

/* The two unpacked builds npm run build:e2e leaves behind. They cannot share a directory:
   the manifests differ, and the firefox one would overwrite the chromium one. */
const BUILD_DIR = path.join(PROJECT_ROOT, "build");
const FIREFOX_BUILD_DIR = path.join(PROJECT_ROOT, "build-firefox");

/**
 * Rewrites the API scheme in the built extension from https to http, so the
 * plain-HTTP mock server can answer.
 *
 * Only the scheme changes -- the host stays cloud.feedly.com, which is what
 * lets the shipped `*://*.feedly.com/*` host permission keep working and keeps
 * the manifest untouched. `--host-resolver-rules` then sends that host to the
 * mock. Idempotent, so repeated runs over one build are safe.
 *
 * Firefox has no resolver rule and reaches the mock through proxy prefs instead, but it
 * needs the same rewrite: the mock speaks plain http and cannot answer a CONNECT.
 */
function pointBuildAtMockServer(buildDir) {
    const apiFile = path.join(buildDir, "scripts", "feedly.api.js");

    if (!fs.existsSync(apiFile)) {
        throw new Error(
            `Built extension not found at ${buildDir}. Run \`npm run build:e2e\` first.`
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

module.exports = { PROJECT_ROOT, BUILD_DIR, FIREFOX_BUILD_DIR, pointBuildAtMockServer };
