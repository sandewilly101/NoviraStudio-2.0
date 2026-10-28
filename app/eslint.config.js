// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // dist: build output; nozila/shared + nozila/three: Nozila's procedural builds, ported as-is
    ignores: ['dist/*', 'src/nozila/shared/**', 'src/nozila/three/**'],
  },
  {
    // React Three Fiber uses three.js props (position, args, map…) on its JSX elements.
    files: ['src/components/three/**', 'src/components/editor/**', 'src/nozila/**'],
    rules: { 'react/no-unknown-property': 'off' },
  },
]);
