import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", "src/database/migrations/**", "coverage/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tests/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        describe: "readonly",
        beforeEach: "readonly",
        test: "readonly",
        expect: "readonly",
        afterAll: "readonly",
        beforeAll: "readonly",
      },
    },
  },
];