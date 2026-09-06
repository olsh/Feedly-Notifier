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
