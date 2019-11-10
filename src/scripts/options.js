"use strict";

var optionsGlobal = {
    backgroundPermission: {
        permissions: ["background"]
    },
    allSitesPermission: {
        origins: ["<all_urls>"]
    }
};

$(document).ready(function () {
    loadOptions();
    loadUserCategories();
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
    chrome.extension.getBackgroundPage().appGlobal.options.refreshToken = "";
    chrome.extension.getBackgroundPage().appGlobal.syncStorage.remove(["accessToken", "refreshToken"], function () {});
    $("#userInfo, #filters-settings").hide();
});

$("#options").on("change", "input", function (e) {
    $("[data-disable-parent]").each(function(key, value){
        var child = $(value);
        var parent = $("input[data-option-name='" + child.data("disable-parent") + "']");
        parent.is(":checked") ? child.attr("disabled", "disable") : child.removeAttr("disabled");
    });

    $("[data-enable-parent]").each(function(key, value){
        var child = $(value);
        var parent = $("input[data-option-name='" + child.data("enable-parent") + "']");
        !parent.is(":checked") ? child.attr("disabled", "disable") : child.removeAttr("disabled");
    });
});

function loadProfileData() {
    chrome.extension.getBackgroundPage().apiRequestWrapper("profile", {
        useSecureConnection: chrome.extension.getBackgroundPage().appGlobal.options.useSecureConnection
    }).then(function (result) {
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
    }, function () {
        $("#userInfo, #filters-settings").hide();
    });
}

function loadUserCategories(){
    chrome.extension.getBackgroundPage().apiRequestWrapper("categories")
        .then(function (result) {
            result.forEach(function(element){
                appendCategory(element.id, element.label);
            });
            appendCategory(chrome.extension.getBackgroundPage().appGlobal.globalFavorites, "Global Favorites");
            appendCategory(chrome.extension.getBackgroundPage().appGlobal.globalUncategorized, "Global Uncategorized");
            chrome.extension.getBackgroundPage().appGlobal.syncStorage.get("filters", function(items){
                let filters = items.filters || [];
                filters.forEach(function(id){
                    $("#categories").find("input[data-id='" + id +"']").attr("checked", "checked");
                });
            });
        });
}

function appendCategory(id, label){
    var categories = $("#categories");
    var label = $("<label for='" + id + "' class='label' />").text(label);
    var checkbox = $("<input id='" + id + "' type='checkbox' />").attr("data-id", id);
    categories.append(label);
    categories.append(checkbox);
    categories.append("<br/>");
}

function parseFilters() {
    var filters = [];
    $("#categories").find("input[type='checkbox']:checked").each(function (key, value) {
        var checkbox = $(value);
        filters.push(checkbox.data("id"));
    });
    return filters;
}

/* Save all option in the chrome storage */
function saveOptions() {
    var options = {};
    $("#options").find("[data-option-name]").each(function (optionName, value) {
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
    options.filters = parseFilters();

    // @if BROWSER='chrome'
    setBackgroundMode($("#enable-background-mode").is(":checked"));
    // @endif

    setAllSitesPermission($("#showBlogIconInNotifications").is(":checked")
        || $("#showThumbnailInNotifications").is(":checked"), options, function () {
        chrome.extension.getBackgroundPage().appGlobal.syncStorage.set(options, function () {
            alert(chrome.i18n.getMessage("OptionsSaved"));
        });
    });
}

function loadOptions() {
    // @if BROWSER='chrome'
    chrome.permissions.contains(optionsGlobal.backgroundPermission, function (enabled){
        $("#enable-background-mode").prop("checked", enabled);
    });
    // @endif

    chrome.extension.getBackgroundPage().appGlobal.syncStorage.get(null, function (items) {
        var optionsForm = $("#options");
        for (var option in items) {
            var optionControl = optionsForm.find("[data-option-name='" + option + "']");
            if (optionControl.attr("type") === "checkbox") {
                optionControl.attr("checked", items[option]);
            } else {
                optionControl.val(items[option]);
            }
        }

        // @if BROWSER!='firefox'
        chrome.permissions.contains(optionsGlobal.allSitesPermission, function (enabled){
            $("#showBlogIconInNotifications").prop("checked", enabled && items.showBlogIconInNotifications);
            $("#showThumbnailInNotifications").prop("checked", enabled && items.showThumbnailInNotifications);

            optionsForm.find("input").trigger("change");
        });
        // @endif
    });
    $("#header").text(chrome.i18n.getMessage("FeedlyNotifierOptions"));
    $("#options").find("[data-locale-value]").each(function () {
        var textBox = $(this);
        var localValue = textBox.data("locale-value");
        textBox.text(chrome.i18n.getMessage(localValue));
    });
}

// @if BROWSER='chrome'
function setBackgroundMode(enable) {
    if (enable) {
        chrome.permissions.request(optionsGlobal.backgroundPermission, function () {
        });
    } else {
        chrome.permissions.remove(optionsGlobal.backgroundPermission, function () {
        });
    }
}
// @endif

function setAllSitesPermission(enable, options, callback) {
    if (enable) {
        browser.permissions.request(optionsGlobal.allSitesPermission)
            .then(function (granted) {
                if ($("#showThumbnailInNotifications").is(":checked")) {
                    $("#showThumbnailInNotifications").prop('checked', granted);
                    options.showThumbnailInNotifications = granted;
                }

                if ($("#showBlogIconInNotifications").is(":checked")) {
                    $("#showBlogIconInNotifications").prop('checked', granted);
                    options.showBlogIconInNotifications = granted;
                }

                callback();
            });
    } else {
        callback();
    }
}
