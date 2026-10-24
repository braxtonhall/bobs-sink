import { defineProject } from "vitest/config";
import { sourceConditions } from "../../vitest.shared.js";

export default defineProject({
	resolve: { conditions: sourceConditions },
	ssr: { resolve: { conditions: sourceConditions } },
	test: {
		name: "client",
		include: ["test/**/*.test.ts"],
		environment: "node",
		setupFiles: ["fake-indexeddb/auto"],
	},
});
