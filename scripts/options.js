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