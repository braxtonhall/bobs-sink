import { createMiddleware } from "hono/factory";
import { SinkError } from "../../shared/errors.js";
import type { HttpEnv } from "../HttpEnv.js";

/** Refuses changes (anything but GET and HEAD) unless the `Origin` header is the service's own. */
export function requireSameOrigin(origin: string) {
	return createMiddleware<HttpEnv>(async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== origin) {
			throw new SinkError("forbidden", "changes must come from the operator console itself");
		}
		await next();
	});
}
