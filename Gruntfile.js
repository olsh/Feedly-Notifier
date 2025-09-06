module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),
        copy: {
            main: {
                files: [
                    {expand: true, cwd: "<%= pkg.sourcePath %>/", src: ["**"], dest: "<%= pkg.buildPath %>/"}
                ]
            },
            bower: {
                files: [
                    {src: "<%= pkg.libPath %>/jquery/dist/jquery.min.js", dest: "<%= pkg.buildPath %>/scripts/jquery.min.js"},

                    {src: "<%= pkg.libPath %>/webextension-polyfill/dist/browser-polyfill.min.js", dest: "<%= pkg.buildPath %>/scripts/browser-polyfill.min.js"},

                    {src: "<%= pkg.libPath %>/mustache/mustache.min.js", dest: "<%= pkg.buildPath %>/scripts/mustache.min.js"},

                    {src: "<%= pkg.libPath %>/dompurify/dist/purify.min.js", dest: "<%= pkg.buildPath %>/scripts/purify.min.js"},

                    {src: "<%= pkg.libPath %>/timeago.js/dist/timeago.full.min.js", dest: "<%= pkg.buildPath %>/scripts/timeago.full.min.js"},
                ]
            }
        },
        "string-replace": {
            keys: {
                files: {
                    "<%= pkg.buildPath %>/scripts/core.js": "<%= pkg.buildPath %>/scripts/core.js"
                },
                options: {
                    replacements: [
                        {
                            pattern: 'clientSecret: ""',
                            replacement: 'clientSecret: "' + grunt.option("clientSecret") + '"'
                        },
                        {
                            pattern: 'clientId: ""',
                            replacement: 'clientId: "' + grunt.option("clientId") + '"'
                        }
                    ]
                }
            },
            sandboxApi: {
                files: {
                    "<%= pkg.buildPath %>/scripts/feedly.api.js": "<%= pkg.buildPath %>/scripts/feedly.api.js"
                },
                options: {
                    replacements: [
                        {
                            pattern: /http(?:s)?:\/\/(?:www\.)?cloud\.feedly\.com/gi,
                            replacement: "https://sandbox7.feedly.com"
                        }
                    ]
                }
            },
            sandboxLink: {
                files: {
                    "<%= pkg.buildPath %>/scripts/core.js": "<%= pkg.buildPath %>/scripts/core.js"
                },
                options: {
                    replacements: [
                        {
                            pattern: /http(?:s)?:\/\/(?:www\.)?feedly\.com/gi,
                            replacement: "https://sandbox7.feedly.com"
                        },
                        {
                            pattern: /let\s+redirectUri\s+=\s+[^;]*/gi,
                            replacement: "let redirectUri = 'http://localhost'"
                        }
                    ]
                }
            }
        },
        uglify: {
            dist: {
                files: {
                    "<%= pkg.buildPath %>/scripts/core.js": ["<%= pkg.buildPath %>/scripts/core.js"],
                    "<%= pkg.buildPath %>/scripts/feedly.api.js": ["<%= pkg.buildPath %>/scripts/feedly.api.js"],
                    "<%= pkg.buildPath %>/scripts/options.js": ["<%= pkg.buildPath %>/scripts/options.js"],
                    "<%= pkg.buildPath %>/scripts/popup.js": ["<%= pkg.buildPath %>/scripts/popup.js"]
                }
            }
        },
        zip: {
            build: {
                cwd: "<%= pkg.buildPath %>/",
                src: ["<%= pkg.buildPath %>/**"],
                dest: "<%= pkg.buildPath %>/feedly-notifier-" + grunt.option("browser") + ".zip",
                compression: "DEFLATE"
            }
        },
        clean: {
            "pre-build": ["<%= pkg.buildPath %>"],
            build: {
                files: [
                    {expand: true, cwd: "<%= pkg.buildPath %>", src: ["*", "!*.zip"]}
                ]
            }
        },
        preprocess: {
            js: {
                files: [
                    {src: ["<%= pkg.buildPath %>/scripts/*.js"]},
                    {src: ["<%= pkg.buildPath %>/*.json"]}
                ],
                options: {
                    inline: true,
                    context: {
                        BROWSER: grunt.option("browser")
                    },
                    type: "js"
                }
            },
            html: {
                files: [
                    {src: ["<%= pkg.buildPath %>/*.html"]}
                ],
                options: {
                    inline: true,
                    context: {
                        BROWSER: grunt.option("browser")
                    }
                }
            }
        }
    });

    grunt.loadNpmTasks("grunt-contrib-copy");
    grunt.loadNpmTasks("grunt-string-replace");
    grunt.loadNpmTasks("grunt-zip");
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks("grunt-preprocess");

    grunt.registerTask("build", ["clean:pre-build", "copy", "string-replace:keys", "preprocess", "zip", "clean:build"]);
    grunt.registerTask("sandbox", ["copy", "string-replace", "preprocess"]);
    grunt.registerTask("default", ["copy", "string-replace:keys", "preprocess"]);
};
