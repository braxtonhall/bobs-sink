import type { Context } from "hono";
import type { z } from "zod";
import { SinkError } from "../shared/errors.js";

/** Parses the request body as JSON and validates it. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new SinkError("bad_request", "request body must be JSON");
	}
	return schema.parse(body);
}
