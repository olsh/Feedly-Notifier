import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { Script } from "node:vm";
import path from "node:path";
import { preprocess } from "preprocess";

import { preprocessPreservingLines } from "./helpers/preprocess.js";
import { projectRoot, scriptsDir } from "./helpers/load-core.js";

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
        const manifest = parseManifest(source, targetBrowser);

        expect(manifest.manifest_version).toBe(3);
        expect(manifest.name).toBe("Feedly Notifier");
        expect(manifest.background.service_worker).toBe("scripts/background.js");
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
        const manifest = parseManifest(source, targetBrowser);

        expect(manifest.permissions).toContain("sidePanel");
        expect(manifest.side_panel).toBeDefined();
        expect(manifest.sidebar_action).toBeUndefined();
        // sidePanel.open() is Chrome 116+, and core.js calls it unguarded.
        expect(manifest.minimum_chrome_version).toBe("116");
    });

    it("gives firefox the sidebar keys instead", () => {
        const manifest = parseManifest(source, "firefox");

        expect(manifest.permissions).not.toContain("sidePanel");
        expect(manifest.side_panel).toBeUndefined();
        expect(manifest.sidebar_action).toBeDefined();
        expect(manifest.minimum_chrome_version).toBeUndefined();
        expect(manifest.applications.gecko.strict_min_version).toBe("115.0");
    });

    /*
     * The side panel page is named twice -- once for the browser to read before
     * the worker has ever run, once for core.js to reopen it afterwards -- and
     * nothing in the build compares the two. See the note above SIDE_PANEL_PATH.
     */
    it("points the side panel at the path core.js opens", () => {
        const coreSource = readFileSync(path.join(projectRoot, "src/scripts/core.js"), "utf8");
        const manifest = parseManifest(source, "chrome");

        expect(coreSource).toContain(`SIDE_PANEL_PATH = "${manifest.side_panel.default_path}"`);
    });
});

/*
 * Nothing in the build parses the JavaScript it ships, and the rest of this
 * suite only ever compiles the chrome target, because loadCore and
 * loadBackground default `targetBrowser` to "chrome". So this is the only check
 * that the opera and firefox packages contain valid JS.
 */
describe("preprocessed scripts", () => {
    it("found the shipped scripts", () => {
        expect(SHIPPED_SCRIPTS).toContain("core.js");
    });

    describe.each(BROWSERS)("for %s", (targetBrowser) => {
        it.each(SHIPPED_SCRIPTS)("compiles %s", (name) => {
            const filename = path.join(scriptsDir, name);
            const processed = preprocessPreservingLines(readFileSync(filename, "utf8"), targetBrowser);

            /*
             * Compiling this repository's own source: checked-in input, never
             * user input, and compiled without ever being run. Suppression must
             * sit on the reported line itself.
             */
            expect(() => new Script(processed, { filename })).not.toThrow(); // NOSONAR
        });
    });
});

function parseManifest(source, targetBrowser) {
    return JSON.parse(stripComments(preprocessPreservingLines(source, targetBrowser)));
}

/** manifest.json keeps plain `//` comments outside the directives. */
function stripComments(json) {
    return json
        .split("\n")
        .map(line => (/^\s*\/\//.test(line) ? "" : line))
        .join("\n");
}
