module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        "string-replace": {
            dist: {
                files: {
                    "<%= pkg.buildPath %>/scripts/core.js": "<%= pkg.buildPath %>/scripts/core.js"
                },
                options: {
                    replacements: [
                        {
                            pattern: 'clientSecret: ""',
                            replacement: 'clientSecret: "' + grunt.option("clientSecret")  +  '"'
                        },
                        {
                            pattern: 'clientId: ""',
                            replacement: 'clientId: "' + grunt.option("clientId")  +  '"'
                        }
                    ]
                }
            }
        },
        uglify: {
            dist: {
                files: {
                    "<%= pkg.buildPath %>/scripts/core.js" : ["<%= pkg.buildPath %>/scripts/core.js"],
                    "<%= pkg.buildPath %>/scripts/feedly.api.js" : ["<%= pkg.buildPath %>/scripts/feedly.api.js"],
                    "<%= pkg.buildPath %>/scripts/options.js" : ["<%= pkg.buildPath %>/scripts/options.js"],
                    "<%= pkg.buildPath %>/scripts/popup.js" : ["<%= pkg.buildPath %>/scripts/popup.js"]
                }
            }
        },
        copy: {
            main: {
                files: [
                    {expand: true, cwd: '<%= pkg.sourcePath %>/', src: ['**'], dest: '<%= pkg.buildPath %>/'}
                ]
            }
        }
    });

    grunt.loadNpmTasks('grunt-string-replace');
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks("grunt-contrib-copy");

    grunt.registerTask("default", ["copy", "string-replace", "uglify"]);
    grunt.registerTask("develop", ["copy", "string-replace"]);
};