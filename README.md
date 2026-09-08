Feedly Notifier
===============

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=olsh_Feedly-Notifier&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=olsh_Feedly-Notifier)
---

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/egikgfbhipinieabdmcpigejkaomgjgb)](https://chrome.google.com/webstore/detail/feedly-notifier/egikgfbhipinieabdmcpigejkaomgjgb)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/users/egikgfbhipinieabdmcpigejkaomgjgb)](https://chrome.google.com/webstore/detail/feedly-notifier/egikgfbhipinieabdmcpigejkaomgjgb)
---

[![Mozilla Add-on](https://img.shields.io/amo/v/feedly-notifier)](https://addons.mozilla.org/en-US/firefox/addon/feedly-notifier/)
[![Mozilla Add-on](https://img.shields.io/amo/users/feedly-notifier)](https://addons.mozilla.org/en-US/firefox/addon/feedly-notifier/)
[![Mozilla Add-on](https://img.shields.io/amo/rating/feedly-notifier)](https://addons.mozilla.org/en-US/firefox/addon/feedly-notifier/)
---

Google Chrome, Firefox, Opera and Microsoft Edge extension for reading news from RSS aggregator [Feedly](https://feedly.com/)

## Changelog

Changelog can be found [here](https://github.com/olsh/Feedly-Notifier/releases).

## Translations

[Help us to translate the extension or improve existing translations](https://poeditor.com/join/project?hash=2fZxqOmDJo)

## Build

1. `npm install`
2. `grunt sandbox --clientId=sandbox --clientSecret=R26NGS2Q9NAPSEJHCXM3 --browser=chrome`
You can find actual `clientId` and `clientSecret` [here](https://groups.google.com/g/feedly-cloud)
The browser parameter can be `chrome`, `opera` or `firefox`.
3. The result of the commands will be in `build` folder, now you can load the extension to browser.

### Reproducing a released package

The archives submitted to the stores come from the `build` task rather than `sandbox`,
which rewrites every feedly.com URL to sandbox7.feedly.com and produces no archive:

    npm ci
    ./node_modules/.bin/grunt build --clientId=<id> --clientSecret=<secret> --browser=firefox

Node 22, and the exact dependency versions pinned in `package-lock.json`. The result is
`build/feedly-notifier-firefox.zip`; `--browser` selects the target and accepts `chrome`,
`opera` or `firefox`. The `.xpi` on addons.mozilla.org is that archive's file tree
repacked by `web-ext sign`, so the two contain the same files.

`clientId` and `clientSecret` are the project's Feedly API credentials, and they are the
only difference between a build made this way and the released one: `string-replace:keys`
substitutes them into the empty `clientId: ""` and `clientSecret: ""` literals in
`build/scripts/core.js`, and nothing else in the package reads them. Building with the
sandbox credentials above therefore reproduces the submitted package apart from those two
string literals and the archive's entry timestamps.
