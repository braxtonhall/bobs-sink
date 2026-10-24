import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SoftwarePasskey } from "@bobs-sink/test-support";
import { TestDevice } from "../helpers/TestDevice.js";
import { json, testApp, testOrigin, TestSink } from "../helpers/TestSink.js";

describe("identity", () => {
	let sink: TestSink;

	beforeEach(async () => {
		sink = await TestSink.start();
	});

	afterEach(async () => {
		await sink.stop();
	});

	it("registers a passkey and authorizes the device key that asked", async () => {
		const { identityId, device } = await sink.register();

		const me = await json<{ identityId: string; app: string; deviceKeys: unknown[] }>(
			await sink.signed(device, "GET", "/v1/me"),
		);
		expect(me).toMatchObject({ identityId, app: testApp });
		expect(me.deviceKeys).toHaveLength(1);
	});

	it("signs in on another device with the same passkey", async () => {
		const { identityId, device, passkey } = await sink.register();
		await sink.createDocument(device);

		const second = await sink.signIn(passkey);

		expect(second.identityId).toBe(identityId);
		expect(second.documents).toHaveLength(1);
		expect((await sink.signed(second.device, "GET", "/v1/me")).status).toBe(200);
	});

	it("refuses a ceremony started from an origin outside the app", async () => {
		const response = await sink.post(
			"/v1/registrations",
			{ app: testApp, deviceKey: new TestDevice().publicKey },
			"https://evil.com",
		);
		expect(response.status).toBe(403);
	});

	it("refuses an assertion whose user handle names a different identity", async () => {
		const victim = await sink.register();
		const attacker = await sink.register();
		const device = new TestDevice();
		const start = await json<{ ceremonyId: string; options: never }>(
			await sink.post("/v1/sign-ins", { app: testApp, deviceKey: device.publicKey }),
		);

		// A valid signature from the attacker's own passkey, but claiming the victim's user handle.
		const forged = attacker.passkey.assert(start.options, { userHandle: new TextEncoder().encode(victim.identityId) });
		const response = await sink.post(`/v1/sign-ins/${start.ceremonyId}`, { response: forged });

		expect(response.status).toBe(401);
		expect((await sink.signed(device, "GET", "/v1/me")).status).toBe(401);
	});

	it("refuses a passkey from another app", async () => {
		const other = await sink.register("other.example");
		const device = new TestDevice();
		const start = await json<{ ceremonyId: string; options: never }>(
			await sink.post("/v1/sign-ins", { app: testApp, deviceKey: device.publicKey }),
		);
		const assertion = other.passkey.assert(start.options, { origin: testOrigin });

		expect((await sink.post(`/v1/sign-ins/${start.ceremonyId}`, { response: assertion })).status).toBe(401);
	});

	it("refuses an unknown passkey", async () => {
		const stranger = new SoftwarePasskey(testApp, testOrigin);
		const known = await sink.register();
		const start = await json<{ ceremonyId: string; options: never }>(
			await sink.post("/v1/sign-ins", { app: testApp, deviceKey: new TestDevice().publicKey }),
		);
		// Borrow a real user handle; the credential ID is still unknown.
		const assertion = stranger.assert(start.options, { userHandle: new TextEncoder().encode(known.identityId) });

		expect((await sink.post(`/v1/sign-ins/${start.ceremonyId}`, { response: assertion })).status).toBe(401);
	});

	it("uses each ceremony at most once", async () => {
		const { passkey } = await sink.register();
		const start = await json<{ ceremonyId: string; options: never }>(
			await sink.post("/v1/sign-ins", { app: testApp, deviceKey: new TestDevice().publicKey }),
		);
		const assertion = passkey.assert(start.options);

		expect((await sink.post(`/v1/sign-ins/${start.ceremonyId}`, { response: assertion })).status).toBe(200);
		expect((await sink.post(`/v1/sign-ins/${start.ceremonyId}`, { response: assertion })).status).toBe(401);
	});

	it("revokes another device's key with a passkey", async () => {
		const { passkey } = await sink.register();
		const lost = await sink.signIn(passkey);
		const start = await json<{ ceremonyId: string; options: never }>(
			await sink.post("/v1/revocations", { app: testApp, deviceKeys: [lost.device.publicKey] }),
		);

		const result = await json<{ revoked: number }>(
			await sink.post(`/v1/revocations/${start.ceremonyId}`, { response: passkey.assert(start.options) }),
		);

		expect(result.revoked).toBe(1);
		expect((await sink.signed(lost.device, "GET", "/v1/me")).status).toBe(401);
	});

	it("signs a device out", async () => {
		const { device } = await sink.register();

		expect((await sink.signed(device, "DELETE", "/v1/me/device-key")).status).toBe(204);
		expect((await sink.signed(device, "GET", "/v1/me")).status).toBe(401);
	});
});

describe("request signatures", () => {
	let sink: TestSink;

	beforeEach(async () => {
		sink = await TestSink.start();
	});

	afterEach(async () => {
		await sink.stop();
	});

	it("rejects a replayed request", async () => {
		const { device } = await sink.register();
		const headers = device.requestHeaders("GET", "/v1/me");

		expect((await fetch(`${sink.baseUrl}/v1/me`, { headers })).status).toBe(200);
		expect((await fetch(`${sink.baseUrl}/v1/me`, { headers })).status).toBe(401);
	});

	it("rejects a request whose body was changed after signing", async () => {
		const { device } = await sink.register();
		const headers = device.requestHeaders("POST", "/v1/documents", "{}");

		const response = await fetch(`${sink.baseUrl}/v1/documents`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify({ initialState: "AAA" }),
		});
		expect(response.status).toBe(401);
	});

	it("rejects a stale timestamp", async () => {
		const { device } = await sink.register();
		const headers = device.requestHeaders("GET", "/v1/me", "", Date.now() - 10 * 60_000);

		expect((await fetch(`${sink.baseUrl}/v1/me`, { headers })).status).toBe(401);
	});

	it("rejects a signature for a different path", async () => {
		const { device } = await sink.register();
		const headers = device.requestHeaders("GET", "/v1/documents");

		expect((await fetch(`${sink.baseUrl}/v1/me`, { headers })).status).toBe(401);
	});
});
