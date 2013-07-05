$("body").on("click", "#save", function (e) {
    var form = document.getElementById("options");    
    if (form.checkValidity()) {        
        e.preventDefault();
        saveOptions();
    }    
});

$(document).ready(function () {
    loadOptions();
});

function saveOptions() {
    chrome.storage.sync.set({ updateInterval : $("#interval").val() }, function () { });
}

function loadOptions() {
    chrome.storage.sync.get(null, function (items) {
        var interval = items.updateInterval;
        if (!interval) {
            return;
        }
        $("#interval").val(interval);
    });
}