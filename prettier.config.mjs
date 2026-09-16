/** @type {import('prettier').Config} */
const config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.md', '*.mdx'],
      options: { proseWrap: 'preserve' },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: { singleQuote: false },
    },
  ],
};

export default config;
