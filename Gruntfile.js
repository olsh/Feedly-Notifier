module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        copy: {
            main: {
                files: [
                    {expand: true, cwd: '<%= pkg.sourcePath %>/', src: ['**'], dest: '<%= pkg.buildPath %>/'}
                ]
            },
            bower: {
                files: [
                    {src: '<%= pkg.bowerPath %>/jquery/dist/jquery.min.js', dest: '<%= pkg.buildPath %>/scripts/jquery.min.js'},

                    {src: '<%= pkg.bowerPath %>/mustache/mustache.min.js', dest: '<%= pkg.buildPath %>/scripts/mustache.min.js'},

                    {src: '<%= pkg.bowerPath %>/jquery-timeago/jquery.timeago.js', dest: '<%= pkg.buildPath %>/scripts/timeago/jquery.timeago.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.ar.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.ar.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.cs.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.cs.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.da.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.da.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.de.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.de.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.es.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.es.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.fr.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.fr.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.ja.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.ja.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.id.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.id.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.it.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.it.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.nl.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.nl.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.ko.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.ko.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.pt-br.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.pt-br.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.ru.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.ru.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.sr.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.sr.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.tr.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.tr.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.uk.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.uk.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.zh-CN.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.zh-CN.js'},
                    {src: '<%= pkg.bowerPath %>/jquery-timeago/locales/jquery.timeago.zh-TW.js', dest: '<%= pkg.buildPath %>/scripts/timeago/locales/jquery.timeago.zh-TW.js'}
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
                            replacement: "http://sandbox.feedly.com"
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
                            replacement: "http://sandbox.feedly.com"
                        },
                        {
                            pattern: /var\s+redirectUri\s+=\s+[^;]*/gi,
                            replacement: "var redirectUri = 'http://localhost'"
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
                dest: '<%= pkg.buildPath %>/feedly-notifier.zip',
                compression: 'DEFLATE'
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
    grunt.loadNpmTasks('grunt-string-replace');
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks('grunt-zip');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-preprocess');

    grunt.registerTask("build", ["clean:pre-build", "copy", "string-replace:keys", "preprocess", "zip", "clean:build"]);
    grunt.registerTask("build-uglify", ["clean:pre-build", "copy", "string-replace:keys", "preprocess", "uglify", "zip", "clean:build"]);
    grunt.registerTask("sandbox", ["copy", "string-replace", "preprocess"]);
    grunt.registerTask("default", ["copy", "string-replace:keys", "preprocess"]);
};