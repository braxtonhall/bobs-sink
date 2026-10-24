import { describe, expect, it } from "vitest";
import { ExpiringMap } from "../../src/shared/ExpiringMap.js";
import { ManualClock } from "../helpers/ManualClock.js";

describe("ExpiringMap", () => {
	it("forgets entries after their time to live", () => {
		const clock = new ManualClock();
		const map = new ExpiringMap<string, number>(100, clock);
		map.set("a", 1);

		clock.advance(99);
		expect(map.get("a")).toBe(1);
		clock.advance(1);
		expect(map.get("a")).toBeUndefined();
	});

	it("returns a taken value only once", () => {
		const map = new ExpiringMap<string, number>(100, new ManualClock());
		map.set("a", 1);

		expect(map.take("a")).toBe(1);
		expect(map.take("a")).toBeUndefined();
	});
});
