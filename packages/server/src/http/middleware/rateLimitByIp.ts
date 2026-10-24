import { createMiddleware } from "hono/factory";
import type { RateLimiter, RateRule } from "../../limits/RateLimiter.js";
import { SinkError } from "../../shared/errors.js";
import type { HttpEnv } from "../HttpEnv.js";

export function rateLimitByIp(limiter: RateLimiter, name: string, rule: RateRule) {
	return createMiddleware<HttpEnv>(async (c, next) => {
		if (!limiter.tryTake(`${name}:${c.get("clientIp")}`, rule)) {
			throw new SinkError("rate_limited", "too many requests");
		}
		await next();
	});
}
