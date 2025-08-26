import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.amd,
        ...globals.jest,
        ...globals.mocha,
        Parsimmon: true,
        testSetScenario: true,
        assert: true,
      }
    },
    rules: {
      eqeqeq: "error",
      strict: ["error", "global"],
      "dot-notation": "warn",
      "linebreak-style": ["error", "unix"],
      "no-alert": "error",
      "no-caller": "error",
      "no-eval": "error",
      "no-multiple-empty-lines": "warn",
      "no-unused-vars": ["error", { caughtErrorsIgnorePattern: "^_" }],
      "no-useless-concat": "warn",
      "no-useless-escape": "warn",
      "no-with": "error",
      curly: ["warn", "all"],
      "one-var": ["warn", "never"],
      "quote-props": ["warn", "as-needed"],
      "no-prototype-builtins": "warn",
      "no-global-assign": "warn",
    },
    ignores: [
      "build/**"
    ]
  }
];
