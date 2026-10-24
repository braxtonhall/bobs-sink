import type { Clock } from "../shared/clock.js";

export type RateRule = {
	/** Maximum burst size. */
	capacity: number;
	/** Time for one token to refill. */
	refillMs: number;
};

type Bucket = { tokens: number; updatedAt: number; rule: RateRule };

/** Token-bucket rate limiting keyed by arbitrary strings. */
export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>();

	constructor(private readonly clock: Clock) {}

	/** Takes one token for `key`; returns false when the bucket is empty. */
	tryTake(key: string, rule: RateRule): boolean {
		const now = this.clock.now().getTime();
		const bucket = this.refilled(key, rule, now);
		if (bucket.tokens < 1) {
			return false;
		}
		bucket.tokens -= 1;
		return true;
	}

	/** Drops buckets that have refilled completely, since they behave like new ones. */
	sweep(): void {
		const now = this.clock.now().getTime();
		for (const [key, bucket] of this.buckets) {
			if (this.tokensAt(bucket, now) >= bucket.rule.capacity) {
				this.buckets.delete(key);
			}
		}
	}

	private refilled(key: string, rule: RateRule, now: number): Bucket {
		const existing = this.buckets.get(key);
		if (existing === undefined) {
			const bucket = { tokens: rule.capacity, updatedAt: now, rule };
			this.buckets.set(key, bucket);
			return bucket;
		}
		existing.tokens = this.tokensAt(existing, now);
		existing.updatedAt = now;
		existing.rule = rule;
		return existing;
	}

	private tokensAt(bucket: Bucket, now: number): number {
		const refilled = (now - bucket.updatedAt) / bucket.rule.refillMs;
		return Math.min(bucket.rule.capacity, bucket.tokens + refilled);
	}
}
