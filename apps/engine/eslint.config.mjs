import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**", "coverage/**", "**/*.d.ts", "**/generated/**"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-expressions": "warn",
            "no-control-regex": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
            "no-empty": "warn",
            "require-yield": "warn",
        },
    },
    {
        files: ["**/*.mjs"],
        rules: { "no-undef": "warn" },
    },
);
