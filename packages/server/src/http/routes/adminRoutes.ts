import { Hono } from "hono";
import type { DocumentService } from "../../documents/DocumentService.js";
import type { HttpEnv } from "../HttpEnv.js";

/** Operator actions. Mounted behind `requireAdmin`. */
export function adminRoutes(documents: DocumentService) {
	const app = new Hono<HttpEnv>();

	app.post("/documents/:id/epochs", (c) => c.json({ epoch: documents.startNewEpoch(c.req.param("id")) }, 201));

	return app;
}
