// @ts-check
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

const sqlSecurityPlugin = {
  rules: {
    "no-raw-sql-concatenation": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prevent SQL injection by forbidding raw string concatenation in database query calls.",
        },
        schema: [],
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee;
            let isQueryCall = false;

            if (
              callee.type === "Identifier" &&
              ["queryRead", "queryWrite", "querySmart"].includes(callee.name)
            ) {
              isQueryCall = true;
            } else if (callee.type === "MemberExpression") {
              const prop = callee.property;
              if (prop && prop.type === "Identifier" && prop.name === "query") {
                isQueryCall = true;
              }
            }

            if (isQueryCall && node.arguments.length > 0) {
              const firstArg = node.arguments[0];

              if (
                firstArg.type === "BinaryExpression" &&
                firstArg.operator === "+"
              ) {
                context.report({
                  node: firstArg,
                  message:
                    "Raw string concatenation in SQL query call detected. Use parameterized variables ($1, $2, etc.) instead.",
                });
              }
            }
          },
          VariableDeclarator(node) {
            if (
              node.id &&
              node.id.type === "Identifier" &&
              /^(?:sql|query|selectQuery|updateQuery|insertQuery|countQuery)$/i.test(
                node.id.name,
              ) &&
              node.init
            ) {
              if (
                node.init.type === "BinaryExpression" &&
                node.init.operator === "+"
              ) {
                context.report({
                  node: node.init,
                  message:
                    `Raw string concatenation in SQL query variable '${node.id.name}' detected. Use parameterized queries with placeholder variables.`,
                });
              }
            }
          },
        };
      },
    },
  },
};

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  // Apply to all TypeScript source files
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/__tests__/**/*.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        // Node.js globals
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        // Jest globals
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "sql-security": sqlSecurityPlugin,
    },
    rules: {
      // eslint:recommended equivalents
      "no-unused-vars": "off", // handled by @typescript-eslint version below
      "no-undef": "off", // TypeScript handles this
      "no-console": "off",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-empty": "warn",
      "no-extra-semi": "error",
      "no-unreachable": "error",

      // @typescript-eslint/recommended rules
      ...tsPlugin.configs["flat/recommended"].rules,

      // Project-specific overrides (matching .eslintrc.json)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "sql-security/no-raw-sql-concatenation": "error",
    },
  },
  // Test files — disable type-aware linting (tests excluded from tsconfig.json)
  {
    files: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/__tests__/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        // No "project" here — avoids parserOptions.project errors for test files
      },
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "sql-security": sqlSecurityPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "sql-security/no-raw-sql-concatenation": "error",
    },
  },
  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "jest.config.js",
      "**/*.js",
    ],
  },
];
