const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ZipWebpackPlugin = require('zip-webpack-plugin');
const RemoveEmptyScriptsPlugin = require('webpack-remove-empty-scripts');
const webpack = require("webpack");

module.exports = (env, argv) => {
    const clientSecret = process.env.CLIENT_SECRET || '';
    const clientId = process.env.CLIENT_ID || '';
    const browser = env.browser || 'chrome';
    const buildPath = path.resolve(__dirname, 'build');
    const zip = env.zip;
    const isProduction = env.env == 'production';

    return {
        mode: env.env,
        devtool: 'source-map',
        stats: {
            all: false,
            errors: true,
            builtAt: true,
        },
        entry: {
            'js/popup': './src/popup.tsx',
            'js/options': './src/options.tsx',
            'js/background': './src/background.ts',
            'mainfest:': './src/manifest.json',
        },
        output: {
            path: buildPath,
            filename: "[name].js",
            clean: true
        },
        optimization: {
            removeEmptyChunks: true,
            splitChunks: {
                name: "js/vendor",
                chunks(chunk) {
                    return chunk.name !== 'js/background';
                }
            },
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: "ts-loader",
                    exclude: /node_modules/,
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                },
                {
                    test: /\.json$/,
                    exclude: /node_modules/,
                    type: 'asset/resource',
                    generator: {
                        filename: '[name][ext]'
                    },
                    use: [
                        {
                            loader: 'webpack-preprocessor-loader',
                            options: {
                                params: {
                                    BROWSER: browser
                                }
                            }
                        }
                    ]
                }
            ]
        },
        plugins: [
            new RemoveEmptyScriptsPlugin({
                extensions: /\.(json)([?].*)?$/
            }),
            new webpack.DefinePlugin({
                ClientId: JSON.stringify(clientId),
                ClientSecret: JSON.stringify(clientSecret),
                Browser: JSON.stringify(browser),
                IsProduction: JSON.stringify(isProduction),
            }),
            new CopyWebpackPlugin({
                patterns: [
                    { from: '**/*', to: buildPath, context: 'public'},
                ]
            }),
            zip == 'true' && new ZipWebpackPlugin({
                filename: `feedly-notifier-${browser}.zip`,
                fileOptions: {
                    compress: true
                }
            })
        ],
        resolve: {
            extensions: [".ts", ".tsx", ".js"],
        }
    }
};
