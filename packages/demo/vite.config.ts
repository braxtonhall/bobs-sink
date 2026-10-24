import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
	// Use the workspace packages' TypeScript sources, as tests do.
	resolve: { conditions: ["source", ...defaultClientConditions] },
	server: { port: 5173, strictPort: true },
	build: { target: "es2022" },
});
