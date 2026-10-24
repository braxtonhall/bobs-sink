import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/limits/RateLimiter.js";
import { ManualClock } from "../helpers/ManualClock.js";

describe("RateLimiter", () => {
	const rule = { capacity: 2, refillMs: 1000 };

	it("allows a burst up to capacity, then refills over time", () => {
		const clock = new ManualClock();
		const limiter = new RateLimiter(clock);

		expect(limiter.tryTake("k", rule)).toBe(true);
		expect(limiter.tryTake("k", rule)).toBe(true);
		expect(limiter.tryTake("k", rule)).toBe(false);
		clock.advance(1000);
		expect(limiter.tryTake("k", rule)).toBe(true);
		expect(limiter.tryTake("k", rule)).toBe(false);
	});

	it("keeps keys independent", () => {
		const limiter = new RateLimiter(new ManualClock());
		limiter.tryTake("a", rule);
		limiter.tryTake("a", rule);

		expect(limiter.tryTake("b", rule)).toBe(true);
	});
});
