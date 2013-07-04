
chrome.storage.sync.get(null, function(items){

    var feedlyApiClient = new FeedlyApiClient(items.accessToken);

    chrome.browserAction.onClicked.addListener(function(tab) {	
	    updateToken();
    });

    function updateToken(){
	    chrome.tabs.create( {url: "http://cloud.feedly.com" }, function (feedlytab){
		    //Execute code in feedly page context
		    chrome.tabs.executeScript(feedlytab.id, { code : "localStorage.getItem('session@cloud')"}, function(results){
			    if(results.length !== 1){
				    return;
			    }
			    var accessToken = JSON.parse(results[0])['feedlyToken'];
			    if(accessToken !== undefined){				
				    chrome.storage.sync.set( { accessToken : accessToken}, function(){});
			    }
		    });
	    });
    };

    chrome.storage.onChanged.addListener(function(changes, areaName) {
	    var accessTokenChange = changes[accessToken];
	    chrome.storage.sync.set( {accessToken : accessTokenChange.newValue}, function(){});
	    feedlyApiClient.accessToken = accessTokenChange.newValue;
    });

    function updateNews(){	
	    var result = feedlyApiClient.get("markers/counts", null, function(data){
		    var response = JSON.parse(data);
			unreadcounts = response.unreadcounts;
			if(unreadcounts !== undefined){
				var max = 0;
				for	(var i = 0; i < unreadcounts.length; i++){
					if(max < unreadcounts[i].count){
						max = unreadcounts[i].count;
					}
				}
				chrome.browserAction.setBadgeText({ text : String(max)});
			}			
	    });
    };

    updateNews();
});