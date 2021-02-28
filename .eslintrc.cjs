module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'airbnb-base',
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    'import/extensions': 'off',
    'import/order': ['error', {'alphabetize': {'order': 'asc'}}],
    'import/prefer-default-export': 'off',
    'no-console': 'off',
  },
};
