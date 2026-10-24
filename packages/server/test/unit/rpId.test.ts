import { describe, expect, it } from "vitest";
import { isValidRpId, originMatchesRpId } from "../../src/apps/rpId.js";

describe("isValidRpId", () => {
	it.each(["example.com", "a.b.example.co.uk", "localhost"])("accepts %s", (rpId) => {
		expect(isValidRpId(rpId)).toBe(true);
	});

	it.each(["https://example.com", "example.com:443", "Example.com", "127.0.0.1", "", "-bad.com"])(
		"rejects %s",
		(rpId) => {
			expect(isValidRpId(rpId)).toBe(false);
		},
	);
});

describe("originMatchesRpId", () => {
	it("accepts the RP ID's own origin and its subdomains over https", () => {
		expect(originMatchesRpId("https://example.com", "example.com", false)).toBe(true);
		expect(originMatchesRpId("https://www.example.com", "example.com", false)).toBe(true);
	});

	it("rejects other hosts, look-alikes, and plain http", () => {
		expect(originMatchesRpId("https://evil.com", "example.com", false)).toBe(false);
		expect(originMatchesRpId("https://notexample.com", "example.com", false)).toBe(false);
		expect(originMatchesRpId("http://example.com", "example.com", false)).toBe(false);
		expect(originMatchesRpId("https://example.com/path", "example.com", false)).toBe(false);
	});

	it("accepts http://localhost only when allowed", () => {
		expect(originMatchesRpId("http://localhost:5173", "localhost", true)).toBe(true);
		expect(originMatchesRpId("http://localhost:5173", "localhost", false)).toBe(false);
	});
});
