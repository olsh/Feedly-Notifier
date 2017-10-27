"use strict";

let FeedlyApiClient = function(accessToken) {

    this.accessToken = accessToken;

    let apiUrl = "http://cloud.feedly.com/v3/";
    let secureApiUrl = "https://cloud.feedly.com/v3/";
    let extensionVersion = chrome.runtime.getManifest().version;

    this.getMethodUrl = function (methodName, parameters, useSecureConnection) {
        if (methodName === undefined) {
            return "";
        }
        let methodUrl = (useSecureConnection ? secureApiUrl : apiUrl) + methodName;

        let queryString = "?";
        for (let parameterName in parameters) {
            queryString += parameterName + "=" + parameters[parameterName] + "&";
        }

        let browserPrefix;
        // @if BROWSER='chrome'
        browserPrefix = "c";
        // @endif

        // @if BROWSER='opera'
        browserPrefix = "o";
        // @endif

        // @if BROWSER='firefox'
        browserPrefix = "f";
        // @endif

        queryString += "av=" + browserPrefix + extensionVersion;

        methodUrl += queryString;

        return methodUrl;
    };

    this.request = function (methodName, settings) {
        function status(response) {
            if (response.status === 200) {
                return Promise.resolve(response);
            } else {
                return Promise.reject(response);
            }
        }

        function json(response) {
            return response.json();
        }

        let url = this.getMethodUrl(methodName, settings.parameters, settings.useSecureConnection);
        let verb = settings.method || "GET";

        // For bypassing the cache
        if (verb === "GET") {
            url += ((/\?/).test(url) ? "&" : "?") + "ck=" + (new Date()).getTime();
        }

        let headers = {};
        if (this.accessToken) {
            headers.Authorization = "OAuth " + this.accessToken;
        }

        let requestParameters = {
            method: verb,
            headers: headers
        };

        if (settings.body) {
            requestParameters.body = JSON.stringify(settings.body);
        }

        return fetch(url, requestParameters)
            .then(status)
            .then(json);
    };
};

export default FeedlyApiClient;
