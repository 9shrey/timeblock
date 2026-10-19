import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const dateBan = [
  "error",
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "Read local time only via domain/time/clock.ts (nowFrom) or platform/.",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Use Env.nowMs instead of Date.now() in domain/UI code.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(get(FullYear|Month|Date|Day|Hours|Minutes|Seconds)|getTimezoneOffset|set(FullYear|Month|Date|Hours|Minutes))$/]",
    message: "Local-time Date accessors are banned; use the UTC variants (wall-clock model) or time/clock.ts.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "src-tauri/gen", "node_modules", ".planning"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": dateBan,
    },
  },
  {
    // Places allowed to read the wall clock.
    files: ["src/domain/time/clock.ts", "src/platform/**", "src/main.tsx", "src/data/**", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // shadcn-generated files: keep upstream code untouched.
    files: ["src/components/ui/**"],
    rules: { "react-hooks/purity": "off" },
  },
);
