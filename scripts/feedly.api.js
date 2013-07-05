var FeedlyApiClient = function (accessToken) {

    this.accessToken = accessToken;
    var apiUrl = "http://cloud.feedly.com/v3/";

    var getMethodUrl = function (methodName, parameters) {
        if (methodName === undefined) {
            return "";
        }
        var methodUrl = apiUrl + methodName;
        var queryString;
        if (parameters !== null) {
            queryString = "?";
            for (parameterName in parameters) {
                queryString += parameterName + "=" + parameters[parameterName] + "&";
            }
            queryString = queryString.replace(/&$/, "");
        }

        if (queryString !== undefined) {
            methodUrl += queryString;
        }

        return methodUrl;
    };

	
    this.get = function (methodName, parameters, callback) {
        var methodUrl = getMethodUrl(methodName, parameters);
		createRequest("GET", methodUrl, callback, this.accessToken, null);
    };

    this.post = function (methodName, parameters, body,callback) {
        var methodUrl = getMethodUrl(methodName, parameters);
		createRequest("POST", methodUrl, callback, this.accessToken, JSON.stringify(body));
    };
	
	var createRequest = function(verb, url, callback, accessToken, body){
		var request = new XMLHttpRequest();	
		request.open(verb, url, true);
		if(accessToken !== undefined){
			request.setRequestHeader("Authorization", "OAuth " + accessToken);
		}		
		request.onload = function(e){

            var json;
            try{
                json = JSON.parse(e.target.response);
            }catch(exception) {
                json = {
                    Error : exception.message,
                    errorCode : 500
                }
            }
			callback(json);
		};
		request.send(body);
	}
};