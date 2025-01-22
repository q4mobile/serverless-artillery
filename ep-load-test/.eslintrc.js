module.exports = {
  env: {
    es6: true,
    node: true
  },
  globals: {
    Atomics: "readonly",
    SharedArrayBuffer: "readonly"
  },
  extends: [
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:security/recommended",
    "plugin:sonarjs/recommended"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module"
  },
  plugins: [
    "@typescript-eslint",
    "prettier",
    "security",
    "sonarjs",
    "unused-imports"
  ],
  rules: {
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/explicit-member-accessibility": "off",
    "@typescript-eslint/explicit-module-boundary-types": ["off"],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { ignoreRestSiblings: true }
    ],
    "@typescript-eslint/no-use-before-define": [
      "error",
      { classes: false, functions: false }
    ],
    "import/order": [
      "error",
      {
        alphabetize: { order: "asc", caseInsensitive: false },
        groups: [
          "builtin",
          "external",
          "internal",
          "index",
          "object",
          "parent",
          "sibling",
          "unknown"
        ],
        "newlines-between": "never"
      }
    ],
    "import/namespace": [2, { allowComputed: true }],
    "import/newline-after-import": ["error", { count: 1 }],
    "import/no-duplicates": ["error", { considerQueryString: true }],
    "import/no-cycle": "error",
    "max-classes-per-file": "off",
    "no-debugger": "warn",
    "no-nested-ternary": ["error"],
    "no-unneeded-ternary": "error",
    "prefer-const": [
      "error",
      {
        destructuring: "any",
        ignoreReadBeforeAssign: false
      }
    ],
    "prettier/prettier": ["error"],
    quotes: [
      "error",
      "double",
      { avoidEscape: true, allowTemplateLiterals: false }
    ],
    "security/detect-non-literal-fs-filename": "off",
    "security/detect-object-injection": "off", // turn back on later
    "sonarjs/cognitive-complexity": "error",
    "unused-imports/no-unused-imports": "error"
  },
  overrides: [
    {
      files: ["**/*.spec.js", "**/*.spec.ts", "**/*.test.js", "**/*.test.ts"],
      env: {
        jest: true
      }
    }
  ]
};
