import type { Clock } from "./clock.js";

type Entry<V> = { value: V; expiresAt: number };

/** An in-memory map whose entries disappear after a fixed time to live. */
export class ExpiringMap<K, V> {
	private readonly entries = new Map<K, Entry<V>>();

	constructor(
		private readonly ttlMs: number,
		private readonly clock: Clock,
	) {}

	set(key: K, value: V): void {
		this.sweep();
		this.entries.set(key, { value, expiresAt: this.clock.now().getTime() + this.ttlMs });
	}

	has(key: K): boolean {
		return this.get(key) !== undefined;
	}

	get(key: K): V | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) {
			return undefined;
		}
		if (entry.expiresAt <= this.clock.now().getTime()) {
			this.entries.delete(key);
			return undefined;
		}
		return entry.value;
	}

	/** Returns the value and removes it, so it can be used at most once. */
	take(key: K): V | undefined {
		const value = this.get(key);
		this.entries.delete(key);
		return value;
	}

	private sweep(): void {
		const now = this.clock.now().getTime();
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt <= now) {
				this.entries.delete(key);
			}
		}
	}
}
