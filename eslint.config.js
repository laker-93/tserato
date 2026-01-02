// eslint.config.js
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.log",
      "*.tmp",
      "*.tsbuildinfo",
      ".vscode/**",
      ".idea/**",
       "eslint.config.js"
    ]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/strict-boolean-expressions": "warn"
    }
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error"
    }
  }
];
