"use strict";

var optionsGlobal = {
    allSitesPermission: {
        origins: ["<all_urls>"]
    },
    loaded: false
};

var feedlyClient = new FeedlyApiClient();

function getSyncArea(disableOptionsSync) {
    return disableOptionsSync ? chrome.storage.local : chrome.storage.sync;
}

function computeSavedGroup(feedlyUserId) {
    return "user/" + feedlyUserId + "/tag/global.saved";
}
function computeGlobalFavorites(feedlyUserId) {
    return "user/" + feedlyUserId + "/category/global.must";
}
function computeGlobalUncategorized(feedlyUserId) {
    return "user/" + feedlyUserId + "/category/global.uncategorized";
}

$(document).ready(function () {
    loadOptions();
    loadUserCategories();
    loadProfileData();

    setTimeout(function () {
        optionsGlobal.loaded = true;
    }, 1000);
});

$("body").on("click", "#save", function (e) {
    var form = document.getElementById("options");
    if (form.checkValidity()) {
        e.preventDefault();
        saveOptions();
    }
});

$("body").on("click", "#logout", function () {
    // Clear tokens in both storage areas to ensure background picks it up
    chrome.storage.local.set({ accessToken: "", refreshToken: "" }, function () {});
    chrome.storage.sync.set({ accessToken: "", refreshToken: "" }, function () {});
    $("#userInfo, #filters-settings").hide();
});

$("#options").on("change", "input, select", function (e) {
    $("[data-enable-parent]").each(function(key, value){
        var child = $(value);
        var parent = $("input[data-option-name='" + child.data("enable-parent") + "']");
        !parent.is(":checked") ? child.attr("disabled", "disable") : child.removeAttr("disabled");
    });

    $("[data-disable-parent]").each(function(key, value){
        var child = $(value);
        var parent = $("input[data-option-name='" + child.data("disable-parent") + "']");
        parent.is(":checked") ? child.attr("disabled", "disable") : child.removeAttr("disabled");
    });

    if (e.target.id === "soundVolume" || e.target.id === "sound") {
        if (!optionsGlobal.loaded) {
            return;
        }

        const volume = Number($("#soundVolume").val());
        const sound = $("#sound").val();
        try {
            var audio = new Audio(sound);
            audio.volume = isNaN(volume) ? 1 : volume;
            audio.play();
        } catch (e) { /* no-op */ }
    }
});

function loadProfileData() {
    // Load token from storage and request profile via client
    chrome.storage.local.get(null, function (local) {
        const disableSync = local.disableOptionsSync || false;
        const area = getSyncArea(disableSync);
        area.get(null, function (items) {
            feedlyClient.accessToken = items.accessToken || "";
            if (!feedlyClient.accessToken) { $("#userInfo, #filters-settings").hide(); return; }
            feedlyClient.request("profile", { parameters: {} }).then(function (result) {
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
        });
    });
}

function loadUserCategories(){
    chrome.storage.local.get(null, function (local) {
        const disableSync = local.disableOptionsSync || false;
        const area = getSyncArea(disableSync);
        area.get(null, function (items) {
            const userId = items.feedlyUserId || "";
            feedlyClient.accessToken = items.accessToken || "";
            if (!feedlyClient.accessToken) { return; }
            feedlyClient.request("categories", { parameters: {} })
                .then(function (result) {
                    result.forEach(function(element){
                        appendCategory(element.id, element.label);
                    });
                    appendCategory(computeGlobalFavorites(userId), "Global Favorites");
                    appendCategory(computeGlobalUncategorized(userId), "Global Uncategorized");
                    area.get("filters", function(items){
                        let filters = items.filters || [];
                        filters.forEach(function(id){
                            $("#categories").find("input[data-id='" + id +"']").attr("checked", "checked");
                        });
                    });
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

    const disableSync = $("#disableOptionsSync").is(":checked");
    setAllSitesPermission($("#showBlogIconInNotifications").is(":checked")
        || $("#showThumbnailInNotifications").is(":checked"), options, function () {
        const area = getSyncArea(disableSync);
        area.set(options, function () {
            alert(chrome.i18n.getMessage("OptionsSaved"));
        });
    });
}

function loadOptions() {
    chrome.storage.local.get(null, function (local) {
        const disableSync = local.disableOptionsSync || false;
        const area = getSyncArea(disableSync);
        area.get(null, function (items) {
        var optionsForm = $("#options");
        for (var option in items) {
            var optionControl = optionsForm.find("[data-option-name='" + option + "']");
            if (optionControl.attr("type") === "checkbox") {
                optionControl.attr("checked", items[option]);
            } else {
                optionControl.val(items[option]);
            }
        }

        chrome.permissions.contains(optionsGlobal.allSitesPermission, function (enabled){
            $("#showBlogIconInNotifications").prop("checked", enabled && items.showBlogIconInNotifications);
            $("#showThumbnailInNotifications").prop("checked", enabled && items.showThumbnailInNotifications);

            optionsForm.find("input").trigger("change");
        });
        });
    });
    $("#header").text(chrome.i18n.getMessage("FeedlyNotifierOptions"));
    $("#options").find("[data-locale-value]").each(function () {
        var textBox = $(this);
        var localValue = textBox.data("locale-value");
        textBox.text(chrome.i18n.getMessage(localValue));
    });
}

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
