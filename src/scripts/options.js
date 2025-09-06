"use strict";

var optionsGlobal = {
    allSitesPermission: {
        origins: ["<all_urls>"]
    },
    loaded: false
};

var feedlyClient = new FeedlyApiClient();

function getSyncArea(disableOptionsSync) {
    return disableOptionsSync ? browser.storage.local : browser.storage.sync;
}

function computeGlobalFavorites(feedlyUserId) {
    return "user/" + feedlyUserId + "/category/global.must";
}
function computeGlobalUncategorized(feedlyUserId) {
    return "user/" + feedlyUserId + "/category/global.uncategorized";
}

$(document).ready(async function () {
    await Promise.all([
        loadOptions(),
        loadUserCategories(),
        loadProfileData()
    ]);

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

$("body").on("click", "#logout", async function () {
    // Clear tokens in both storage areas to ensure background picks it up
    await browser.storage.local.set({ accessToken: "", refreshToken: "" });
    await browser.storage.sync.set({ accessToken: "", refreshToken: "" });
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

async function loadProfileData() {
    // Load token from storage and request profile via client
    const local = await browser.storage.local.get(null);
    const disableSync = local.disableOptionsSync || false;
    const area = getSyncArea(disableSync);
    const items = await area.get(null);
    feedlyClient.accessToken = items.accessToken || "";
    if (!feedlyClient.accessToken) { $("#userInfo, #filters-settings").hide(); return; }
    try {
        const result = await feedlyClient.request("profile", { parameters: {} });
        var userInfo = $("#userInfo");
        userInfo.find("[data-locale-value]").each(function () {
            var textBox = $(this);
            var localValue = textBox.data("locale-value");
            textBox.text(browser.i18n.getMessage(localValue));
        });
        userInfo.show();
        for (var profileData in result) {
            userInfo.find("span[data-value-name='" + profileData + "']").text(result[profileData]);
        }
    } catch (_) {
        $("#userInfo, #filters-settings").hide();
    }
}

async function loadUserCategories(){
    const local = await browser.storage.local.get(null);
    const disableSync = local.disableOptionsSync || false;
    const area = getSyncArea(disableSync);
    const items = await area.get(null);
    const userId = items.feedlyUserId || "";
    feedlyClient.accessToken = items.accessToken || "";
    if (!feedlyClient.accessToken) { return; }
    const result = await feedlyClient.request("categories", { parameters: {} });
    result.forEach(function(element){
        appendCategory(element.id, element.label);
    });
    appendCategory(computeGlobalFavorites(userId), "Global Favorites");
    appendCategory(computeGlobalUncategorized(userId), "Global Uncategorized");
    const filtersItems = await area.get("filters");
    let filters = filtersItems.filters || [];
    filters.forEach(function(id){
        $("#categories").find("input[data-id='" + id +"']").attr("checked", "checked");
    });
}

function appendCategory(id, label){
    var categories = $("#categories");
    var labelEl = $("<label for='" + id + "' class='label' />").text(label);
    var checkbox = $("<input id='" + id + "' type='checkbox' />").attr("data-id", id);
    categories.append(labelEl);
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
async function saveOptions() {
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
    await setAllSitesPermission($("#showBlogIconInNotifications").is(":checked")
        || $("#showThumbnailInNotifications").is(":checked"), options);
    const area = getSyncArea(disableSync);
    await area.set(options);
    alert(browser.i18n.getMessage("OptionsSaved"));
}

async function loadOptions() {
    const local = await browser.storage.local.get(null);
    const disableSync = local.disableOptionsSync || false;
    const area = getSyncArea(disableSync);
    const items = await area.get(null);
    var optionsForm = $("#options");
    for (var option in items) {
        var optionControl = optionsForm.find("[data-option-name='" + option + "']");
        if (optionControl.attr("type") === "checkbox") {
            optionControl.attr("checked", items[option]);
        } else {
            optionControl.val(items[option]);
        }
    }

    const enabled = await browser.permissions.contains(optionsGlobal.allSitesPermission);
    $("#showBlogIconInNotifications").prop("checked", enabled && items.showBlogIconInNotifications);
    $("#showThumbnailInNotifications").prop("checked", enabled && items.showThumbnailInNotifications);

    optionsForm.find("input").trigger("change");
    $("#header").text(browser.i18n.getMessage("FeedlyNotifierOptions"));
    $("#options").find("[data-locale-value]").each(function () {
        var textBox = $(this);
        var localValue = textBox.data("locale-value");
        textBox.text(browser.i18n.getMessage(localValue));
    });
}

async function setAllSitesPermission(enable, options) {
    if (enable) {
        const granted = await browser.permissions.request(optionsGlobal.allSitesPermission);
        if ($("#showThumbnailInNotifications").is(":checked")) {
            $("#showThumbnailInNotifications").prop("checked", granted);
            options.showThumbnailInNotifications = granted;
        }

        if ($("#showBlogIconInNotifications").is(":checked")) {
            $("#showBlogIconInNotifications").prop("checked", granted);
            options.showBlogIconInNotifications = granted;
        }
    }
}
