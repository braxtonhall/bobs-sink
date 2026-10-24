import { getConnInfo } from "@hono/node-server/conninfo";
import { createMiddleware } from "hono/factory";
import type { HttpEnv } from "../HttpEnv.js";

/**
 * Records the client's IP address. Behind a trusted reverse proxy it is the last X-Forwarded-For entry (the
 * one the proxy added); otherwise it is the socket's remote address.
 */
export function clientIp(trustProxy: boolean) {
	return createMiddleware<HttpEnv>(async (c, next) => {
		const forwarded = trustProxy ? c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() : undefined;
		c.set("clientIp", forwarded ?? getConnInfo(c).remote.address ?? "unknown");
		await next();
	});
}
