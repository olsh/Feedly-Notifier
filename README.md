Feedly-Notifier
===============

[![Build Status](https://travis-ci.org/olsh/Feedly-Notifier.svg?branch=master)](https://travis-ci.org/olsh/Feedly-Notifier)
[![Quality Gate](https://sonarqube.com/api/badges/gate?key=feedly-notifier)](https://sonarqube.com/dashboard/index/feedly-notifier)
[![Dependency Status](https://gemnasium.com/badges/github.com/olsh/Feedly-Notifier.svg)](https://gemnasium.com/github.com/olsh/Feedly-Notifier)

Google chrome, Firefox and Opera extension for reading news from rss aggregator [Feedly](https://feedly.com)

## Changelog

Changelog can be found [here](https://github.com/olsh/Feedly-Notifier/releases).

## Build

1. `yarn`
2. build extension
* run `yarn run dev:chrome --clientId=sandbox --clientSecret=R26NGS2Q9NAPSEJHCXM3` to debug extension in Google Chrome
* run `yarn run dev:firefox --clientId=sandbox --clientSecret=R26NGS2Q9NAPSEJHCXM3` to debug extension in Firefox
* run `yarn run dev:opera --clientId=sandbox --clientSecret=R26NGS2Q9NAPSEJHCXM3` to debug extension in Firefox

> You can find actual `clientId` and `clientSecret` here https://groups.google.com/forum/#!topic/feedly-cloud/3izrTbT7FDQ

3. The result of the commands will be in `build` folder, now you can load the extension to browser.

## Acknowledgments

Made with  
[![WebStorm](https://github.com/olsh/Feedly-Notifier/raw/master/logos/ws-logo.png)](https://www.jetbrains.com/webstorm/)
