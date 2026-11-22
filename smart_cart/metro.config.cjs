const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);

// SDK 58's development expo/virtual/env imports .env files through require.context,
// independently of EXPO_NO_DOTENV and ahead of shell variables. Exclude these files
// only in isolated Playwright Metro so real project settings never enter its bundle.
if (process.env.SMARTCART_E2E === '1') {
  const root = path.join(__dirname, '.env').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = config.resolver.blockList;
  config.resolver.blockList = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    new RegExp(`^${root}(?:\\..*)?$`),
  ];
}
module.exports = config;
