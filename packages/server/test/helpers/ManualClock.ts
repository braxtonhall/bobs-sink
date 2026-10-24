import type { Clock } from "../../src/shared/clock.js";

export class ManualClock implements Clock {
	constructor(private time = new Date("2026-01-01T00:00:00Z").getTime()) {}

	now(): Date {
		return new Date(this.time);
	}

	advance(ms: number): void {
		this.time += ms;
	}
}
