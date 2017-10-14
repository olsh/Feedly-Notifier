var fileSystem = require("fs"),
    path = require("path"),
    preprocess = require('preprocess'),
    env = require("./env");

var manifest = fileSystem.readFileSync("src/manifest.json").toString();
var manifestPath = path.join(__dirname, "../build/manifest.json");

var processed = preprocess.preprocess(manifest, null, { type: "js" });

var json = JSON.parse(processed);

fileSystem.writeFileSync(
  manifestPath,
  JSON.stringify(json, null, 4)
);
