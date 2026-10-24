import { createMiddleware } from "hono/factory";
import type { RequestVerifier } from "../../identity/RequestVerifier.js";
import { requestHeaders } from "@bobs-sink/protocol";
import { rateRules } from "../../limits/rateRules.js";
import type { RateLimiter } from "../../limits/RateLimiter.js";
import { SinkError } from "../../shared/errors.js";
import type { HttpEnv } from "../HttpEnv.js";

/** Requires a valid device signature (see signedMessages.ts) and sets the `authority` variable. */
export function requireDevice(verifier: RequestVerifier, limiter: RateLimiter) {
	return createMiddleware<HttpEnv>(async (c, next) => {
		const url = new URL(c.req.url);
		const authority = verifier.verify({
			method: c.req.method,
			pathAndQuery: url.pathname + url.search,
			body: new Uint8Array(await c.req.arrayBuffer()),
			key: c.req.header(requestHeaders.key),
			timestamp: c.req.header(requestHeaders.timestamp),
			nonce: c.req.header(requestHeaders.nonce),
			signature: c.req.header(requestHeaders.signature),
		});
		if (!limiter.tryTake(`requests:${authority.publicKey}`, rateRules.requestsPerDevice)) {
			throw new SinkError("rate_limited", "too many requests");
		}
		c.set("authority", authority);
		await next();
	});
}
