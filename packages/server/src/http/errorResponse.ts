import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Logger } from "../logger.js";
import type { ErrorKind } from "@bobs-sink/protocol";
import { SinkError } from "../shared/errors.js";

export const statusByKind: Record<ErrorKind, ContentfulStatusCode> = {
	bad_request: 400,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	payload_too_large: 413,
	rate_limited: 429,
};

/** Turns thrown errors into `{ error, message }` JSON responses; unexpected errors are logged and hidden. */
export function errorResponse(logger: Logger) {
	return (error: Error, c: Context): Response => {
		if (error instanceof SinkError) {
			return c.json({ error: error.kind, message: error.message }, statusByKind[error.kind]);
		}
		if (error instanceof ZodError) {
			return c.json({ error: "bad_request", message: "invalid request body" }, 400);
		}
		if (error instanceof HTTPException) {
			return error.getResponse();
		}
		logger.error({ err: error, path: c.req.path }, "request failed");
		return c.json({ error: "internal", message: "internal error" }, 500);
	};
}
