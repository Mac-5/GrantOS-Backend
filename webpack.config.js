module.exports = function (options) {
  return {
    ...options,
    externals: [
      ...(options.externals || []),
      { '@aztec/bb.js': 'commonjs @aztec/bb.js' },
    ],
  };
};
