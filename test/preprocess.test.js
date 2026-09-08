import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { Script } from "node:vm";
import path from "node:path";
import { preprocess } from "preprocess";

import { preprocessPreservingLines } from "./helpers/preprocess.js";
import { projectRoot, scriptsDir, readManifest } from "./helpers/load-core.js";

/**
 * The unit suites evaluate a line-preserving preprocessing of src/, so that
 * coverage and stack traces line up with the real files. These tests pin that
 * implementation against the `preprocess` package the Grunt build actually
 * uses, so the two can never silently diverge.
 *
 * They are also the only place the build's output is ever inspected. The
 * pipeline is copy -> string-replace -> preprocess -> zip and it parses nothing
 * it produces, so a directive branch that resolves to broken JSON or
 * unparseable JS would be packaged and shipped without complaint.
 */
const BROWSERS = ["chrome", "opera", "firefox"];

const PREPROCESSED_FILES = [
    "src/scripts/core.js",
    "src/scripts/feedly.api.js",
    "src/scripts/popup.js",
    "src/manifest.json",
    // The only file written with the `<!-- @if -->` form, and the only one with
    // an opera-specific branch. popup.html carries no directives at all.
    "src/options.html"
];

/**
 * Every shipped script, read from disk so that one added later is covered
 * without touching this file. src/scripts/ holds only first-party code -- the
 * vendor libraries are copied straight out of node_modules by the Gruntfile.
 */
const SHIPPED_SCRIPTS = readdirSync(scriptsDir).filter(name => name.endsWith(".js"));

/**
 * Mirrors the Gruntfile: `build/scripts/*.js` and `build/*.json` go through the
 * `js` parser, `build/*.html` through the html one.
 */
function preprocessType(relativePath) {
    return relativePath.endsWith(".html") ? "html" : "js";
}

/** Both tools agree only up to the blank lines one of them leaves behind. */
function significantLines(text) {
    return text.split("\n").map(line => line.trimEnd()).filter(line => line !== "");
}

describe("line-preserving preprocessor", () => {
    describe.each(BROWSERS)("for %s", (targetBrowser) => {
        it.each(PREPROCESSED_FILES)("produces the same output as the build tool for %s", (relativePath) => {
            const source = readFileSync(path.join(projectRoot, relativePath), "utf8");

            const ours = preprocessPreservingLines(source, targetBrowser);
            const theirs = preprocess(source, { BROWSER: targetBrowser }, { type: preprocessType(relativePath) });

            expect(significantLines(ours)).toEqual(significantLines(theirs));
        });
    });

    it("keeps the line count of the source", () => {
        const source = readFileSync(path.join(projectRoot, "src/scripts/core.js"), "utf8");

        const ours = preprocessPreservingLines(source, "chrome");

        expect(ours.split("\n")).toHaveLength(source.split("\n").length);
    });

    it("keeps browser-specific statements on their original line numbers", () => {
        const source = readFileSync(path.join(projectRoot, "src/scripts/feedly.api.js"), "utf8");
        const originalLine = source.split("\n").findIndex(line => line.includes("browserPrefix = \"c\""));

        const processed = preprocessPreservingLines(source, "chrome").split("\n");

        expect(processed[originalLine]).toContain("browserPrefix = \"c\"");
    });

    it("selects a different branch for each browser", () => {
        const source = readFileSync(path.join(projectRoot, "src/scripts/feedly.api.js"), "utf8");

        expect(preprocessPreservingLines(source, "chrome")).toContain("browserPrefix = \"c\"");
        expect(preprocessPreservingLines(source, "chrome")).not.toContain("browserPrefix = \"f\"");
        expect(preprocessPreservingLines(source, "opera")).toContain("browserPrefix = \"o\"");
        expect(preprocessPreservingLines(source, "firefox")).toContain("browserPrefix = \"f\"");
    });

    it("rejects unbalanced directives", () => {
        expect(() => preprocessPreservingLines("// @endif\n", "chrome")).toThrow(/Unbalanced/);
        expect(() => preprocessPreservingLines("// @if BROWSER='chrome'\n", "chrome")).toThrow(/Unclosed/);
    });
});

describe("manifest.json", () => {
    const source = readFileSync(path.join(projectRoot, "src/manifest.json"), "utf8");

    it("is not parseable before preprocessing", () => {
        // The raw file carries // comments and directives.
        expect(() => JSON.parse(source)).toThrow();
    });

    /*
     * Dropping a directive branch can leave JSON that is invalid, or merely
     * gutted, and the build zips either without complaint -- so the keys every
     * target has to keep are asserted alongside the parse.
     */
    it.each(BROWSERS)("resolves into valid JSON for %s", (targetBrowser) => {
        const manifest = readManifest(targetBrowser);

        expect(manifest.manifest_version).toBe(3);
        expect(manifest.name).toBe("Feedly Notifier");
        // How the background is declared is per-target; that there is one is not.
        expect(manifest.background).toBeDefined();
        expect(manifest.host_permissions).toContain("*://*.feedly.com/*");
        expect(manifest.action.default_popup).toBe("popup.html");
    });

    /*
     * Every directive in the manifest is keyed on firefox, so the two Chromium
     * targets resolve identically. Opera ships no side panel implementation but
     * gets the keys anyway: core.js guards on `browser.sidePanel` at runtime
     * rather than on BROWSER at build time.
     */
    it.each(["chrome", "opera"])("gives %s the side panel keys", (targetBrowser) => {
        const manifest = readManifest(targetBrowser);

        expect(manifest.permissions).toContain("sidePanel");
        expect(manifest.side_panel).toBeDefined();
        expect(manifest.sidebar_action).toBeUndefined();
        // sidePanel.open() is Chrome 116+, and core.js calls it unguarded.
        expect(manifest.minimum_chrome_version).toBe("116");
    });

    it("gives firefox the sidebar keys instead", () => {
        const manifest = readManifest("firefox");

        expect(manifest.permissions).not.toContain("sidePanel");
        expect(manifest.side_panel).toBeUndefined();
        expect(manifest.sidebar_action).toBeDefined();
        expect(manifest.minimum_chrome_version).toBeUndefined();
    });

    /*
     * A worker and nothing but. The documented cross-browser shape is to declare
     * both keys and let each browser take the one it understands, but chrome
     * refuses to load an MV3 extension carrying background.scripts until 121 and
     * minimum_chrome_version above is 116 -- so following that advice here would
     * break every chromium between the two.
     */
    it.each(["chrome", "opera"])("gives %s a service worker", (targetBrowser) => {
        const manifest = readManifest(targetBrowser);

        expect(manifest.background.service_worker).toBe("scripts/background.js");
        expect(manifest.background.scripts).toBeUndefined();
    });

    /*
     * Firefox has never supported extension service workers, and a service_worker
     * with no scripts fallback is an addons-linter error in its own right.
     */
    it("gives firefox an event page rather than a worker", () => {
        const manifest = readManifest("firefox");

        expect(manifest.background.service_worker).toBeUndefined();
        expect(manifest.background.scripts).toBeDefined();
    });

    /*
     * Three separate addons-linter gates on the AMO submission: `applications` is
     * rejected outright under MV3, data collection has to be declared even when
     * there is none, and 128 is the first release that understands
     * optional_host_permissions, which the manifest asks for above.
     */
    it("declares firefox settings the way addons-linter requires", () => {
        const manifest = readManifest("firefox");

        expect(manifest.applications).toBeUndefined();
        expect(manifest.browser_specific_settings.gecko).toMatchObject({
            id: "jid1-BOjn8b0IM7kH2w@jetpack",
            strict_min_version: "128.0",
            data_collection_permissions: { required: ["none"] }
        });
    });

    /*
     * The panel page is declared once per target -- side_panel.default_path on chromium,
     * sidebar_action.default_panel on firefox -- and once more as SIDE_PANEL_PATH, which
     * chromium reopens it with and which is the only written statement of the ?panel=1
     * marker popup.js lays itself out on. Nothing in the build compares any of them, and
     * a firefox sidebar pointed at a path without the marker would silently render as the
     * toolbar popup inside the sidebar frame. See the note above SIDE_PANEL_PATH.
     */
    it.each([
        ["chrome", (manifest) => manifest.side_panel.default_path],
        ["opera", (manifest) => manifest.side_panel.default_path],
        ["firefox", (manifest) => manifest.sidebar_action.default_panel]
    ])("points %s's panel at the path core.js names", (targetBrowser, declaredPath) => {
        const coreSource = readFileSync(path.join(projectRoot, "src/scripts/core.js"), "utf8");

        expect(coreSource).toContain(`SIDE_PANEL_PATH = "${declaredPath(readManifest(targetBrowser))}"`);
    });
});

/*
 * background.js's dependency list is written twice: as importScripts() for the
 * chromium service worker, and as background.scripts for the firefox event page,
 * which has no importScripts at all. Nothing in the build compares them. A file
 * added to one alone breaks only at runtime -- and on firefox that means the
 * background never boots, because readOptions is simply not defined by the time
 * background.js calls it. The two also resolve from different bases: importScripts
 * against /scripts/, the manifest against the extension root.
 */
describe("background dependencies", () => {
    const backgroundSource = readFileSync(path.join(scriptsDir, "background.js"), "utf8");

    /** The filenames importScripts is called with, or null if it is not called. */
    function importedScripts(targetBrowser) {
        const processed = preprocess(backgroundSource, { BROWSER: targetBrowser }, { type: "js" });
        const call = /^\s*importScripts\((.*)\);\s*$/m.exec(processed);

        return call ? call[1].split(",").map(argument => JSON.parse(argument.trim())) : null;
    }

    it.each(["chrome", "opera"])("%s pulls them in through importScripts", (targetBrowser) => {
        expect(importedScripts(targetBrowser)).toEqual([
            "browser-polyfill.min.js",
            "feedly.api.js",
            "core.js"
        ]);
    });

    it("leaves firefox no importScripts call, because an event page has none", () => {
        expect(importedScripts("firefox")).toBeNull();
    });

    /*
     * The assertion this suite exists for. Order included: feedly.api.js defines the
     * client core.js constructs while loading, and background.js calls into core.js
     * while it is still evaluating, so it has to come last.
     */
    it("lists the same files, in the same order, in firefox's background.scripts", () => {
        expect(readManifest("firefox").background.scripts).toEqual([
            ...importedScripts("chrome").map(name => `scripts/${name}`),
            "scripts/background.js"
        ]);
    });

    /* A name the build never puts in build/scripts/ is a background that never starts. */
    it("names only files the build actually ships", () => {
        const gruntfile = readFileSync(path.join(projectRoot, "Gruntfile.js"), "utf8");

        for (const script of readManifest("firefox").background.scripts) {
            const name = path.basename(script);
            const shipped = SHIPPED_SCRIPTS.includes(name) || gruntfile.includes(`/scripts/${name}"`);

            expect(shipped, `${script} is neither in src/scripts nor copied by the Gruntfile`).toBe(true);
        }
    });
});

/*
 * Nothing in the build parses the JavaScript it ships, and the rest of this
 * suite only ever compiles the chrome target, because loadCore and
 * loadBackground default `targetBrowser` to "chrome". So this is the only check
 * that the opera and firefox packages contain valid JS.
 *
 * Unlike every other suite, this one runs the real `preprocess` package rather
 * than the line-preserving helper: the point is to parse the exact bytes the
 * zip would carry. The two are pinned together above, so this cannot drift, and
 * a failure here means the shipped file is broken rather than the stand-in.
 */
describe("preprocessed scripts", () => {
    it("found the shipped scripts", () => {
        expect(SHIPPED_SCRIPTS).toContain("core.js");
    });

    describe.each(BROWSERS)("for %s", (targetBrowser) => {
        it.each(SHIPPED_SCRIPTS)("compiles %s", (name) => {
            const filename = path.join(scriptsDir, name);
            const source = readFileSync(filename, "utf8");
            const processed = preprocess(source, { BROWSER: targetBrowser }, { type: "js" });

            /*
             * Compiling this repository's own source: checked-in input, never
             * user input, and compiled without ever being run. Suppression must
             * sit on the reported line itself.
             */
            expect(() => new Script(processed, { filename })).not.toThrow(); // NOSONAR
        });
    });
});

