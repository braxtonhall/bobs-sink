import type { EpochArchiveResult } from "@bobs-sink/protocol";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { DocumentService } from "../../documents/DocumentService.js";
import { fromBase64Url, toBase64Url } from "../../shared/base64url.js";
import type { HttpEnv } from "../HttpEnv.js";
import { readJson } from "../readJson.js";

const createDocumentSchema = z.object({
	/** A base64url Yjs update to start the document from, e.g. the device's local state. */
	initialState: z.base64url().optional(),
});

/** The signing identity's documents. Device-signed. */
export function documentRoutes(documents: DocumentService, requireDevice: MiddlewareHandler<HttpEnv>) {
	const app = new Hono<HttpEnv>();
	app.use(requireDevice);

	app.get("/", (c) => c.json({ documents: documents.listOwned(c.get("authority").identityId) }));

	app.post("/", async (c) => {
		const { initialState } = await readJson(c, createDocumentSchema);
		const created = documents.create(
			c.get("authority"),
			initialState === undefined ? undefined : fromBase64Url(initialState),
		);
		return c.json(created, 201);
	});

	app.delete("/:id", (c) => {
		documents.delete(c.get("authority"), c.req.param("id"));
		return c.body(null, 204);
	});

	app.get("/:id/epochs/:epoch", (c) => {
		const epoch = z.coerce.number().int().nonnegative().parse(c.req.param("epoch"));
		const finalSnapshot = documents.epochFinalSnapshot(c.get("authority"), c.req.param("id"), epoch);
		return c.json({ epoch, finalSnapshot: toBase64Url(finalSnapshot) } satisfies EpochArchiveResult);
	});

	return app;
}
