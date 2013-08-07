$(document).on("click", ".toggle-link", function(){
    $(this).next().slideToggle();
});

$(document).ready(function() {
    $(".fancybox").fancybox({
        openEffect	: 'none',
        closeEffect	: 'none'
    });
});