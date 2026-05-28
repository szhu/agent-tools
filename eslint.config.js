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
      "no-restricted-globals": [
        "error",
        { name: "Deno", message: "Use @cross/* or Web APIs instead of Deno.*" },
        { name: "Bun", message: "Use @cross/* or Web APIs instead of Bun.*" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Deno']",
          message: "Use @cross/* or Web APIs instead of Deno.*",
        },
        {
          selector: "MemberExpression[object.name='Bun']",
          message: "Use @cross/* or Web APIs instead of Bun.*",
        },
        {
          selector: "MemberExpression[object.name='process']",
          message: "Use @cross/* or Web APIs instead of process.*",
        },
      ],
    },
  },
];
