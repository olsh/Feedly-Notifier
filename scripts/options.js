$(document).ready(function () {
    loadOptions();
    loadProfileData();
});

$("body").on("click", "#save", function (e) {
    var form = document.getElementById("options");
    if (form.checkValidity()) {
        e.preventDefault();
        saveOptions();
    }
});

$("body").on("click", "#logout", function(){
    chrome.extension.getBackgroundPage().appGlobal.options.accessToken = "";
    chrome.storage.sync.remove("accessToken", function(){
        loadProfileData();
    });
});

function loadProfileData() {
    chrome.storage.sync.get(null, function (items) {
        var feedlyClient = new FeedlyApiClient(items.accessToken);
        feedlyClient.get("profile", null, function (result) {
            var userInfo = $("#userInfo");
            console.log(result);
            if (result.errorCode === undefined) {
                userInfo.show();
                for (var profileData in result) {
                    userInfo.find("span[data-value-name='" + profileData + "']").text(result[profileData]);
                }
            } else {
                userInfo.hide();
            }
        });
    });
}

/* Save all option in the chrome storage */
function saveOptions() {
    var options = {};
    $("#options").find("input[data-option-name]").each(function(optionName, value){
          var optionControl = $(value);
          var optionValue;
          if(optionControl.attr("type") === "checkbox"){
              optionValue = optionControl.is(":checked");
          }else{
              optionValue = optionControl.val();
          }
          options[optionControl.data("option-name")] = optionValue;
    });
    chrome.storage.sync.set(options, function () {
        alert("Options was saved");
    });
}

function loadOptions() {
    chrome.storage.sync.get(null, function (items) {
        var optionsForm = $("#options");
        for (option in items){
            var optionControl = optionsForm.find("input[data-option-name='" + option + "']");
            if(optionControl.attr("type") === "checkbox"){
                optionControl.attr("checked", items[option]);
            }else{
                optionControl.val(items[option]);
            }
        }
    });
}