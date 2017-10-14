var fileSystem = require("fs-extra"),
    path = require("path"),
    argv = require('yargs').argv;

    // pass args to webpack
process.env.BROWSER = argv.browser || 'chrome'; 

// clean de dist folder
fileSystem.emptyDirSync(path.join(__dirname, "../build"));

require("./generate_manifest");
