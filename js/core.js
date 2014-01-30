
var firstLocationPart = location.pathname.match(/(\/[^/]+)/)[1];
$(".nav > li").children("a[href^='" + firstLocationPart +"']").parent().addClass("active");