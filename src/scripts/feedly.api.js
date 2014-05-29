"use strict";

var FeedlyApiClient = function (accessToken) {

    this.accessToken = accessToken;

    var apiUrl = "http://cloud.feedly.com/v3/";
    var secureApiUrl = "https://cloud.feedly.com/v3/";
    var extensionVersion = chrome.runtime.getManifest().version;

    this.getMethodUrl = function (methodName, parameters, useSecureConnection) {
        if (methodName === undefined) {
            return "";
        }
        var methodUrl = (useSecureConnection ? secureApiUrl : apiUrl) + methodName;

        var queryString = "?";
        for (var parameterName in parameters) {
            queryString += parameterName + "=" + parameters[parameterName] + "&";
        }
        queryString += "av=c" + extensionVersion;

        methodUrl += queryString;

        return methodUrl;
    };

    this.request = function (methodName, settings) {
        var url = this.getMethodUrl(methodName, settings.parameters, settings.useSecureConnection);
        var verb = settings.method || "GET";

        // For bypassing the cache
        if (verb === "GET"){
            url += ((/\?/).test(url) ? "&" : "?") + "ck=" + (new Date()).getTime();
        }

        var request = new XMLHttpRequest();
        if (settings.timeout){
            request.timeout = settings.timeout;
        }
        request.open(verb, url, true);

        if (this.accessToken) {
            request.setRequestHeader("Authorization", "OAuth " + this.accessToken);
        }

        request.onload = function (e) {
            var json;
            try {
                json = JSON.parse(e.target.response);
            } catch (exception) {
                json = {
                    parsingError: exception.message,
                    response: e.target.response
                }
            }
            if (e.target.status === 200) {
                if (typeof settings.onSuccess === "function") {
                    settings.onSuccess(json);
                }
            } else if (e.target.status === 401) {
                if (typeof settings.onAuthorizationRequired === "function") {
                    settings.onAuthorizationRequired(settings.accessToken);
                }
            } else if (e.target.status === 400) {
                if (typeof settings.onError === "function") {
                    settings.onError(json);
                }
            }

            if (typeof settings.onComplete === "function"){
                settings.onComplete(json);
            }
        };

        request.ontimeout = function (e) {
            if (typeof settings.onComplete === "function"){
                settings.onComplete(e);
            }
        };

        var body;
        if (settings.body) {
            body = JSON.stringify(settings.body);
        }
        request.send(body);
    };
};