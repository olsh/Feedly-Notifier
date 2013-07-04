var FeedlyApiClient = function (accessToken) {

    this.accessToken = accessToken;
    var apiUrl = "http://cloud.feedly.com/v3/";

    var getMethodUrl = function (methodName, parameters) {
        if (methodName === undefined) {
            return "";
        }
        var methodUrl = apiUrl + methodName;
        var queryString;
        if (parameters !== undefined) {
            queryString = "?";
            for (parameterName in parameters) {
                queryString += parameterName + "=" + parameters[parameterName] + "&";
            }
            queryString = queryString.replace(/&$/, "");
        }

        if (queryString.length > 0) {
            methodUrl += queryString;
        }

        return methodUrl;
    };

	
    this.get = function (methodName, parameters) {
        var methodUrl = getMethodUrl(methodName, parameters);
        //Create chrome.webRequest
        //Add access token to headers
        //Get data & parse JSON to object
        return methodUrl;
    }

    this.post = function (methodName, parameters) {
        var methodUrl = getMethodUrl(methodName, parameters);
        //Create chrome.webRequest
        //Add access token to headers        
        //Post data & parse JSON to object
        return methodUrl;
    }
};