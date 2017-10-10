var webpack = require("webpack"),
    path = require("path"),
    fileSystem = require("fs"),
    argv = require('yargs').argv,
    env = require("./utils/env"),
    HtmlWebpackPlugin = require("html-webpack-plugin"),
    WriteFilePlugin = require("write-file-webpack-plugin"),
    CopyWebpackPlugin = require('copy-webpack-plugin'),
    StringReplacePlugin = require("string-replace-webpack-plugin"),
    ZipWebpackPlugin = require('zip-webpack-plugin');

// load the secrets
var alias = {};

var secretsPath = path.join(__dirname, ("secrets." + env.NODE_ENV + ".js"));

var fileExtensions = ["jpg", "jpeg", "png", "gif", "eot", "otf", "svg", "ttf", "woff", "woff2"];

if (fileSystem.existsSync(secretsPath)) {
    alias["secrets"] = secretsPath;
}

var plugins = [
    new StringReplacePlugin(),
    new webpack.DefinePlugin({
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
        "BROWSER": JSON.stringify(argv.browser),
        "CLIENT_ID": JSON.stringify(argv.clientId),
        "CLIENT_SECRET": JSON.stringify(argv.clientSecret)
    }),
    new HtmlWebpackPlugin({
        template: path.join(__dirname, "src", "popup.html"),
        filename: "popup.html",
        chunks: ["popup"]
    }),
    new HtmlWebpackPlugin({
        template: path.join(__dirname, "src", "options.html"),
        filename: "options.html",
        chunks: ["options"]
    }),
    new HtmlWebpackPlugin({
        template: path.join(__dirname, "src", "background.html"),
        filename: "background.html",
        chunks: ["background"]
    }),
    new CopyWebpackPlugin([
        {
            from: path.resolve(__dirname, "src"),
            to: path.resolve(__dirname, "build"),
            ignore: ['**/scripts/**/*', "*.html", "manifest.json"],

            verbose: true
        }
    ]),
    new WriteFilePlugin()
].concat(env.NODE_ENV === 'production' ? [new ZipWebpackPlugin({
    path: path.resolve(__dirname, 'build'),
    filename: "feedly-notifier.zip",
    fileOptions: {
        compress: true
    }
})] : []);

var options = {
    entry: {
        popup: path.join(__dirname, "src", "scripts", "popup.js"),
        options: path.join(__dirname, "src", "scripts", "options.js"),
        background: path.join(__dirname, "src", "scripts", "background.js")
    },
    output: {
        path: path.join(__dirname, "build"),
        filename: "scripts/[name].js"
    },
    module: {
        rules: [
            {
                test: /.js$/,
                exclude: /node_modules/,
                use: [
                    // {
                    //     loader: "echo-loader",
                    // },
                    {
                        loader: 'preprocess-loader',
                        options: {
                            BROWSER: argv.browser
                        }
                    },
                    {
                        loader: StringReplacePlugin.replace({
                            replacements: [
                                {
                                    pattern: /http(?:s)?:\/\/(?:www\.)?cloud\.feedly\.com/gi,
                                    replacement: function (match, p1, offset, string) {
                                        return argv.sandbox ? "http://sandbox7.feedly.com" : match;
                                    }
                                }
                            ]
                        })
                    }
                ]
            },
            {
                test: /\.css$/,
                loader: "style-loader!css-loader",
                exclude: /node_modules/
            },
            {
                test: new RegExp('\.(' + fileExtensions.join('|') + ')$'),
                loader: "file-loader?name=[name].[ext]",
                exclude: /node_modules/
            },
            {
                test: /\.html$/,
                exclude: /node_modules/,
                use: [
                    // {
                    //     loader: "echo-loader",
                    // },
                    {
                        loader: 'preprocess-loader',
                        options: {
                            BROWSER: argv.browser
                        }
                    },
                    {
                        loader: "html-loader",
                    }
                ]
            }
        ]
    },
    resolve: {
        alias: alias
    },
    plugins: plugins
};

// if (env.NODE_ENV === "development") {
//   options.devtool = "cheap-module-eval-source-map";
// }

module.exports = options;
