const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const packageRoot = path.resolve(__dirname, '..');
const appRoot = __dirname;

module.exports = mergeConfig(getDefaultConfig(appRoot), {
  watchFolders: [packageRoot],
  resolver: {
    extraNodeModules: {
      'rn-custom-map-sdk': packageRoot,
    },
  },
});
