export type BackoffOptions = { initialMs: number; maxMs: number };

export const defaultBackoff: BackoffOptions = { initialMs: 500, maxMs: 30_000 };

/** Exponential backoff with full jitter. */
export class Backoff {
	private attempt = 0;

	constructor(private readonly options: BackoffOptions = defaultBackoff) {}

	next(): number {
		const ceiling = Math.min(this.options.maxMs, this.options.initialMs * 2 ** this.attempt);
		this.attempt += 1;
		return Math.random() * ceiling;
	}

	reset(): void {
		this.attempt = 0;
	}
}
