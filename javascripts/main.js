$(document).on("click", ".toggle-link", function(){
    $(this).next().slideToggle();
});

$(document).ready(function() {
    $(".fancybox-button").fancybox({
        prevEffect		: 'none',
        nextEffect		: 'none',
        closeBtn		: false,
        helpers		: {
            title	: { type : 'inside' },
            buttons	: {}
        }
    });
});