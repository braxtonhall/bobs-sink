import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["**/dist", "**/node_modules", "packages/server/drizzle"] },
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["packages/*/vitest.config.ts", "packages/*/vite.config.ts"] },
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
			"@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
		},
	},
	{
		files: ["eslint.config.js"],
		extends: [tseslint.configs.disableTypeChecked],
	},
);
