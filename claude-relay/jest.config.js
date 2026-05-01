module.exports = {
  transformIgnorePatterns: [
    '/node_modules/(?!(uuid|open)/)'
  ],
  transform: {
    '^.+\\.js$': ['babel-jest', { plugins: ['@babel/plugin-transform-modules-commonjs'] }]
  }
};
