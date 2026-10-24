import type { RateRule } from "./RateLimiter.js";

const perMinute = (count: number): RateRule => ({ capacity: count, refillMs: 60_000 / count });
const perHour = (count: number): RateRule => ({ capacity: count, refillMs: 3_600_000 / count });

/** Rate rules that don't depend on an app's policy. */
export const rateRules = {
	/** Passkey ceremonies started from one IP address. */
	ceremoniesPerIp: perMinute(30),
	/** Device-signed HTTP requests from one device key. */
	requestsPerDevice: perMinute(120),
	/** Sync connections opened from one IP address. */
	connectionsPerIp: perMinute(60),
	/** Yjs updates sent by one device key: bursts of 100, sustained 10 per second. */
	updatesPerDevice: { capacity: 100, refillMs: 100 },
} as const satisfies Record<string, RateRule>;

export { perHour, perMinute };
