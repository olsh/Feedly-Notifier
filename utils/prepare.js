var fileSystem = require("fs-extra"),
    path = require("path"),
    argv = require('yargs').argv;

// pass args to webpack
console.log(argv);

process.env.BROWSER = argv.browser || 'chrome'; 
process.env.CLIENT_ID = argv.clientId;  
process.env.CLIENT_SECRET = argv.clientSecret;

// clean de dist folder
fileSystem.emptyDirSync(path.join(__dirname, "../build"));

require("./generate_manifest");
