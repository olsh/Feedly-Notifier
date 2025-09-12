"use strict";
/* exported FeedlyApiClient */

let FeedlyApiClient = function (accessToken) {

    this.accessToken = accessToken;

    let apiUrl = "https://cloud.feedly.com/v3/";
    let extensionVersion = browser.runtime.getManifest().version;

    this.getMethodUrl = function (methodName, parameters) {
        if (methodName === undefined) {
            return "";
        }
        let methodUrl = apiUrl + methodName;

        let queryString = "?";
        for (let parameterName in parameters) {
            queryString += parameterName + "=" + parameters[parameterName] + "&";
        }

        let browserPrefix;
        // @if BROWSER='chrome'
        // noinspection JSUnusedAssignment
        browserPrefix = "c";
        // @endif

        // @if BROWSER='opera'
        // noinspection JSUnusedAssignment
        browserPrefix = "o";
        // @endif

        // @if BROWSER='firefox'
        browserPrefix = "f";
        // @endif

        queryString += "av=" + browserPrefix + extensionVersion;

        methodUrl += queryString;

        return methodUrl;
    };

    this.request = async function (methodName, settings) {
        function status(response) {
            if (response.status === 200) {
                return Promise.resolve(response);
            } else {
                return Promise.reject(response);
            }
        }

        async function json(response) {
            try {
                return await response.json();
            } catch {
                return {};
            }
        }

        let url = this.getMethodUrl(methodName, settings.parameters);
        let verb = settings.method || "GET";

        // For bypassing the cache
        if (verb === "GET") {
            url += ((/\?/).test(url) ? "&" : "?") + "ck=" + (new Date()).getTime();
        }

        let headers = {};
        if (this.accessToken && !settings.skipAuthentication) {
            headers.Authorization = "OAuth " + this.accessToken;
        }

        let requestParameters = {
            method: verb,
            headers: headers
        };

        if (settings.body) {
            requestParameters.body = JSON.stringify(settings.body);
        }

        const response = await fetch(url, requestParameters);
        const validResponse = await status(response);
        return await json(validResponse);
    };
};
