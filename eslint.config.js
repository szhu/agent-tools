import typescript_eslint__eslint_plugin from "@typescript-eslint/eslint-plugin";
import typescript_eslint__parser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescript_eslint__parser,
    },
    plugins: {
      "@typescript-eslint": typescript_eslint__eslint_plugin,
    },
    rules: {
      ...typescript_eslint__eslint_plugin.configs["recommended"]?.rules,
      "no-restricted-imports": [
        "error",
        { name: "node:path", message: "Use @std/path instead of node:path" },
        {
          name: "node:os",
          message: "Use @cross/dir or @cross/env instead of node:os",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Deno", message: "Use @cross/* or Web APIs instead of Deno.*" },
        { name: "Bun", message: "Use @cross/* or Web APIs instead of Bun.*" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // Should match: import foo from "./foo"
          selector: "ImportDeclaration[source.value=/^\\..*(?<!\\.ts)$/]",
          message:
            "Relative imports must include the .ts extension for Deno compatibility",
        },
        {
          // Should match: Deno.readFile(...)
          selector: "MemberExpression[object.name='Deno']",
          message: "Use @cross/* or Web APIs instead of Deno.*",
        },
        {
          // Should match: Bun.file(...)
          selector: "MemberExpression[object.name='Bun']",
          message: "Use @cross/* or Web APIs instead of Bun.*",
        },
      ],
    },
  },
];
