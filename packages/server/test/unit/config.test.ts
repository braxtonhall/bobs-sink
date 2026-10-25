import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const operatorEnv = {
	PUBLIC_URL: "https://sink.example.com",
	SSO_URL: "https://example.com/sso",
	SSO_EXCHANGE_URL: "http://server/api/sso/exchange",
	SSO_EXCHANGE_SECRET: "secret",
	OPERATOR_EMAILS: " Me@Example.com,, you@example.com ",
};

describe("loadConfig", () => {
	it("leaves the operator console off when none of its settings are set", () => {
		expect(loadConfig({}).operator).toBeUndefined();
		expect(loadConfig({ PUBLIC_URL: "", OPERATOR_EMAILS: "" }).operator).toBeUndefined();
	});

	it("turns the console on with all of its settings, lowercasing the whitelist", () => {
		expect(loadConfig(operatorEnv).operator).toEqual({
			publicUrl: "https://sink.example.com",
			ssoUrl: "https://example.com/sso",
			ssoExchangeUrl: "http://server/api/sso/exchange",
			ssoExchangeSecret: "secret",
			operatorEmails: new Set(["me@example.com", "you@example.com"]),
		});
	});

	it("refuses some but not all of the console's settings", () => {
		expect(() => loadConfig({ ...operatorEnv, SSO_EXCHANGE_SECRET: "" })).toThrow(/missing SSO_EXCHANGE_SECRET/);
	});

	it("requires PUBLIC_URL to be a bare origin", () => {
		expect(() => loadConfig({ ...operatorEnv, PUBLIC_URL: "https://sink.example.com/" })).toThrow(/origin/);
	});
});
