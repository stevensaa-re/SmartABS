function assertSafeDemoReset({ databaseName, nodeEnv, confirmed }) {
  if (!confirmed) {
    throw new Error('Reset dibatalkan. Tambahkan --confirm-destructive-reset untuk mengonfirmasi penghapusan data demo.');
  }
  if (databaseName !== 'smartabs_demo') {
    throw new Error('Reset hanya diizinkan untuk DB_NAME=smartabs_demo.');
  }
  if (nodeEnv === 'production') {
    throw new Error('Reset tidak diizinkan saat NODE_ENV=production.');
  }
}

function assertSafeDemoSeed({ databaseName, nodeEnv }) {
  if (databaseName !== 'smartabs_demo') {
    throw new Error('Seed demo hanya diizinkan untuk DB_NAME=smartabs_demo.');
  }
  if (nodeEnv === 'production') {
    throw new Error('Seed demo tidak diizinkan saat NODE_ENV=production.');
  }
}

module.exports = { assertSafeDemoReset, assertSafeDemoSeed };
