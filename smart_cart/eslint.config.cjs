const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([expo, { ignores: ['.expo/**', 'test-results/**', 'playwright-report/**', 'dist/**'] }]);
