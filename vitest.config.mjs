import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        // Most suites evaluate the background scripts in a `vm` sandbox and need
        // no DOM. The two page-script suites opt in with a
        // `@vitest-environment jsdom` docblock.
        environment: "node",
        include: ["test/**/*.test.js"],
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: "v8",
            include: ["src/scripts/**/*.js"],
            /*
             * popup.js and options.js are exercised by test/popup.test.js and
             * test/options.test.js, but they are loaded with indirect eval into
             * jsdom (they need a real DOM and the real jQuery). v8 cannot
             * attribute eval'd code back to a source file, so leaving them in
             * would report a misleading 0%. Their behaviour is covered by those
             * two suites plus the Playwright specs in e2e/.
             */
            exclude: ["src/scripts/popup.js", "src/scripts/options.js"],
            reporter: ["text", "lcov"],
            reportsDirectory: "coverage"
        }
    }
});
