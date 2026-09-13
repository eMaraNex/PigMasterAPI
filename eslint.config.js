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
      },
    },
    rules: {},
  },
];