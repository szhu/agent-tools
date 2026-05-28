import typescript_eslint__eslint_plugin from "@typescript-eslint/eslint-plugin";
import typescript_eslint__parser from "@typescript-eslint/parser";

const restrictedImports = [
  { name: "node:path", message: "Use @std/path instead of node:path" },
  {
    name: "node:os",
    message: "Use @cross/dir or @cross/env instead of node:os",
  },
];

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
      "no-restricted-imports": ["error", { paths: restrictedImports }],
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
        {
          // Should match: const msg = ..., function foo(msg) {}, getMsgText
          selector: "Identifier[name=/msg/i]",
          message: "Don't abbreviate: use 'message' instead of 'msg'",
        },
        {
          // Should match: colonIdx, slashIdx
          selector: "Identifier[name=/idx/i]",
          message:
            "Don't abbreviate: use 'i', 'index', 'pos', 'position', 'loc', or 'location' instead of 'idx'",
        },
        {
          // Should match: ctx, getCtx
          selector: "Identifier[name=/ctx/i]",
          message: "Don't abbreviate: use 'context' instead of 'ctx'",
        },
        {
          // Should match: arr.map(({ id }) => id)
          selector:
            "ArrowFunctionExpression > ObjectPattern, FunctionExpression > ObjectPattern",
          message:
            "Don't destructure in callback parameters; use a named parameter instead",
        },
        {
          // Should match: const [, g1] = s.match(...); m[1]
          selector: "MemberExpression[object.name='m'][computed=true]",
          message:
            "Use array destructuring for regex match groups instead of m[n]",
        },
        {
          // Should match: const shortId = (uuid) => uuid.slice(0, 8)
          selector:
            "Program > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression'], Program > VariableDeclaration > VariableDeclarator[init.type='FunctionExpression']",
          message:
            "Use a named function declaration instead of const = function",
        },
      ],
    },
  },
  {
    files: ["chats/platforms/claudeCode/identifiers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: restrictedImports, patterns: ["**/operations/**"] },
      ],
    },
  },
];
