import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { preprocess } from "preprocess";

import { preprocessPreservingLines } from "./helpers/preprocess.js";
import { projectRoot } from "./helpers/load-core.js";

/**
 * The unit suites evaluate a line-preserving preprocessing of src/, so that
 * coverage and stack traces line up with the real files. These tests pin that
 * implementation against the `preprocess` package the Grunt build actually
 * uses, so the two can never silently diverge.
 */
const BROWSERS = ["chrome", "opera", "firefox"];

const PREPROCESSED_FILES = [
    "src/scripts/core.js",
    "src/scripts/feedly.api.js",
    "src/scripts/popup.js",
    "src/manifest.json"
];

/** Both tools agree only up to the blank lines one of them leaves behind. */
function significantLines(text) {
    return text.split("\n").map(line => line.trimEnd()).filter(line => line !== "");
}

describe("line-preserving preprocessor", () => {
    describe.each(BROWSERS)("for %s", (targetBrowser) => {
        it.each(PREPROCESSED_FILES)("produces the same output as the build tool for %s", (relativePath) => {
            const source = readFileSync(path.join(projectRoot, relativePath), "utf8");

            const ours = preprocessPreservingLines(source, targetBrowser);
            const theirs = preprocess(source, { BROWSER: targetBrowser }, { type: "js" });

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

    it("resolves manifest.json into valid JSON", () => {
        const source = readFileSync(path.join(projectRoot, "src/manifest.json"), "utf8");

        // The raw file is not parseable: it carries // comments and directives.
        expect(() => JSON.parse(source)).toThrow();

        const chromeManifest = JSON.parse(stripComments(preprocessPreservingLines(source, "chrome")));
        const firefoxManifest = JSON.parse(stripComments(preprocessPreservingLines(source, "firefox")));

        expect(chromeManifest.manifest_version).toBe(3);
        expect(chromeManifest.permissions).toContain("sidePanel");
        expect(chromeManifest.side_panel).toBeDefined();
        // sidePanel.open() is Chrome 116+, and core.js calls it unguarded.
        expect(chromeManifest.minimum_chrome_version).toBe("116");

        expect(firefoxManifest.permissions).not.toContain("sidePanel");
        expect(firefoxManifest.sidebar_action).toBeDefined();
        expect(firefoxManifest.applications.gecko.strict_min_version).toBe("115.0");
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

/** manifest.json keeps plain `//` comments outside the directives. */
function stripComments(json) {
    return json
        .split("\n")
        .map(line => (/^\s*\/\//.test(line) ? "" : line))
        .join("\n");
}
