
var match = location.pathname.match(/\/[^/]+(\/[^/]+)/);
$(".nav > li").children("a[href^='" + match ? match[1] : "" +"']").parent().addClass("active");