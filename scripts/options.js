"use strict";

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

$("body").on("click", "#logout", function () {
    chrome.extension.getBackgroundPage().appGlobal.options.accessToken = "";
    chrome.storage.sync.remove("accessToken", function () {
        loadProfileData();
    });
});

$("#options").on("change", "input", function (e) {
    if ($("input[data-option-name='showDesktopNotifications']").is(":checked")) {
        $("input[data-option-name='hideNotificationDelay']").removeAttr("disabled");
        $("input[data-option-name='maxNotificationsCount']").removeAttr("disabled");
    } else {
        $("input[data-option-name='hideNotificationDelay']").attr("disabled", "disabled");
        $("input[data-option-name='maxNotificationsCount']").attr("disabled", "disabled");
    }

    if ($("input[data-option-name='openSiteOnIconClick']").is(":checked")) {
        $("input[data-option-name='showFullFeedContent']").attr("disabled", "disabled");
        $("input[data-option-name='abilitySaveFeeds']").attr("disabled", "disabled");
        $("input[data-option-name='maxNumberOfFeeds']").attr("disabled", "disabled");
        $("input[data-option-name='forceUpdateFeeds']").attr("disabled", "disabled");
    } else {
        $("input[data-option-name='showFullFeedContent']").removeAttr("disabled");
        $("input[data-option-name='abilitySaveFeeds']").removeAttr("disabled");
        $("input[data-option-name='maxNumberOfFeeds']").removeAttr("disabled");
        $("input[data-option-name='forceUpdateFeeds']").removeAttr("disabled");
    }
});

function loadProfileData() {
    chrome.storage.sync.get(null, function (items) {
        var feedlyClient = new FeedlyApiClient(items.accessToken);
        feedlyClient.request("profile", {
            onSuccess: function (result) {
                var userInfo = $("#userInfo");
                userInfo.find("[data-locale-value]").each(function () {
                    var textBox = $(this);
                    var localValue = textBox.data("locale-value");
                    textBox.text(chrome.i18n.getMessage(localValue));
                });
                userInfo.show();
                for (var profileData in result) {
                    userInfo.find("span[data-value-name='" + profileData + "']").text(result[profileData]);
                }
            },
            onAuthorizationRequired: function () {
                var userInfo = $("#userInfo");
                userInfo.hide();
            }
        });
    });
}

/* Save all option in the chrome storage */
function saveOptions() {
    var options = {};
    $("#options").find("input[data-option-name]").each(function (optionName, value) {
        var optionControl = $(value);
        var optionValue;
        if (optionControl.attr("type") === "checkbox") {
            optionValue = optionControl.is(":checked");
        } else if (optionControl.attr("type") === "number") {
            optionValue = Number(optionControl.val());
        } else {
            optionValue = optionControl.val();
        }
        options[optionControl.data("option-name")] = optionValue;
    });
    chrome.storage.sync.set(options, function () {
        alert(chrome.i18n.getMessage("OptionsSaved"));
    });
}

function loadOptions() {
    chrome.storage.sync.get(null, function (items) {
        var optionsForm = $("#options");
        for (var option in items) {
            var optionControl = optionsForm.find("input[data-option-name='" + option + "']");
            if (optionControl.attr("type") === "checkbox") {
                optionControl.attr("checked", items[option]);
            } else {
                optionControl.val(items[option]);
            }
        }
        optionsForm.find("input").trigger("change");
    });
    $("#header").text(chrome.i18n.getMessage("FeedlyNotifierOptions"));
    $("#options").find("[data-locale-value]").each(function () {
        var textBox = $(this);
        var localValue = textBox.data("locale-value");
        textBox.text(chrome.i18n.getMessage(localValue));
    });
}