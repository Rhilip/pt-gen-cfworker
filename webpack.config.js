module.exports = {
  target: 'webworker',
  entry: './index.js',
  module: {
    rules: [
      {
        test: /\.html$/i,
        loader: "html-loader",
      },
    ],
  },
};
