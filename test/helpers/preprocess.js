/**
 * A line-preserving stand-in for the `preprocess` package used by grunt-preprocess.
 *
 * The upstream package *removes* the lines it strips, which shifts every line
 * number below a directive (core.js goes from 1158 to ~1141 lines). That would
 * misalign v8 coverage and every stack trace against the real src/ files, so
 * this version blanks lines instead of deleting them. Blank lines are valid in
 * JS, JSON and HTML alike.
 *
 * The directive grammar in this repo is only three forms, with no nesting and
 * no @else -- verified with:
 *   grep -rn "@if\|@endif\|@else" src/
 *
 * `test/preprocess.test.js` pins this implementation against the real
 * `preprocess` package for every source file and browser target, so any future
 * directive that this simplified parser cannot handle fails loudly.
 */

// The trailing `-->` is folded inside its optional group rather than sitting
// between two `\s*` runs, so there is no ambiguity for the engine to backtrack
// over and matching stays linear.
const IF_DIRECTIVE = /^\s*(?:\/\/|<!--)\s*@if\s+BROWSER\s*(!?)=\s*'([^']*)'\s*(?:-->\s*)?$/;
const ENDIF_DIRECTIVE = /^\s*(?:\/\/|<!--)\s*@endif\s*(?:-->\s*)?$/;

/**
 * @param {string} source - file contents.
 * @param {string} targetBrowser - the BROWSER value to resolve against.
 * @returns {string} source with inactive branches blanked out, line count intact.
 */
function preprocessPreservingLines(source, targetBrowser) {
    const lines = source.split("\n");
    const output = [];
    // Stack of booleans: is the branch we are currently inside active?
    const branches = [];

    const isActive = () => branches.every(Boolean);

    for (const line of lines) {
        const ifMatch = IF_DIRECTIVE.exec(line);
        if (ifMatch) {
            const negated = ifMatch[1] === "!";
            const value = ifMatch[2];
            const matches = negated ? targetBrowser !== value : targetBrowser === value;
            branches.push(matches);
            output.push("");
            continue;
        }

        if (ENDIF_DIRECTIVE.test(line)) {
            if (branches.length === 0) {
                throw new Error("Unbalanced @endif in preprocessed source");
            }
            branches.pop();
            output.push("");
            continue;
        }

        output.push(isActive() ? line : "");
    }

    if (branches.length !== 0) {
        throw new Error("Unclosed @if in preprocessed source");
    }

    return output.join("\n");
}

export { preprocessPreservingLines };
