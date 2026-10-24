import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { SinkError } from "../../shared/errors.js";
import type { HttpEnv } from "../HttpEnv.js";

/** Requires `Authorization: Bearer <ADMIN_TOKEN>`. */
export function requireAdmin(adminToken: string) {
	const expected = Buffer.from(`Bearer ${adminToken}`);
	return createMiddleware<HttpEnv>(async (c, next) => {
		const actual = Buffer.from(c.req.header("authorization") ?? "");
		if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
			throw new SinkError("unauthorized", "admin token required");
		}
		await next();
	});
}
