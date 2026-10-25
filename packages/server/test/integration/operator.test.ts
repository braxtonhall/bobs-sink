import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEmails, type Config, type OperatorConfig } from "../../src/config.js";
import { FakeSso } from "../helpers/FakeSso.js";
import { testApp, TestSink } from "../helpers/TestSink.js";

const publicUrl = "https://sink.test";
const callbackUrl = `${publicUrl}/operator/callback`;
const secret = "test-exchange-secret";
const operatorEmail = "operator@example.com";

describe("operator console", () => {
	let sso: FakeSso;
	let sink: TestSink;
	let directory: string;

	function operatorConfig(emails = "Operator@Example.com, other@example.com"): OperatorConfig {
		return {
			publicUrl,
			ssoUrl: sso.ssoUrl,
			ssoExchangeUrl: sso.exchangeUrl,
			ssoExchangeSecret: secret,
			operatorEmails: parseEmails(emails),
		};
	}

	function config(emails?: string): Partial<Config> {
		return { databasePath: join(directory, "sink.sqlite"), operator: operatorConfig(emails) };
	}

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "bobs-sink-operator-"));
		sso = await FakeSso.start(secret);
		sink = await TestSink.start({ config: config() });
	});

	afterEach(async () => {
		await sink.stop();
		await sso.stop();
		await rm(directory, { recursive: true, force: true });
	});

	function get(path: string, cookie?: string): Promise<Response> {
		return fetch(sink.baseUrl + path, { redirect: "manual", headers: cookie === undefined ? {} : { cookie } });
	}

	function post(path: string, cookie: string, form: Record<string, string> = {}, origin = publicUrl) {
		return fetch(sink.baseUrl + path, {
			method: "POST",
			redirect: "manual",
			headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(form).toString(),
		});
	}

	/** Starts sign-in; returns the state bobs-server was given and the browser's state cookie. */
	async function startSignIn(): Promise<{ state: string; cookie: string }> {
		const response = await get("/operator/sign-in");
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get("location") ?? "");
		expect(`${location.origin}${location.pathname}`).toBe(sso.ssoUrl);
		expect(location.searchParams.get("redirect")).toBe(callbackUrl);
		return { state: location.searchParams.get("state") ?? "", cookie: cookies(response) };
	}

	async function signIn(email = operatorEmail): Promise<string> {
		const { state, cookie } = await startSignIn();
		const code = sso.issue(email, callbackUrl);
		const response = await get(`/operator/callback?code=${code}&state=${state}`, cookie);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/operator");
		return cookies(response);
	}

	it("sends signed-out visitors to bobs-server and back", async () => {
		const response = await get("/operator");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/operator/sign-in");

		const session = await signIn();
		expect(sso.exchanges).toEqual([{ code: expect.any(String) as string, redirect: callbackUrl }]);
		const page = await get("/operator", session);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(await page.text()).toContain(operatorEmail);
	});

	it("sets the session cookie HttpOnly, Secure and SameSite=Lax, scoped to the console", async () => {
		const { state, cookie } = await startSignIn();
		const response = await get(
			`/operator/callback?code=${sso.issue(operatorEmail, callbackUrl)}&state=${state}`,
			cookie,
		);
		const session = response.headers.getSetCookie().find((header) => header.startsWith("sink_operator="));
		expect(session).toMatch(/HttpOnly/);
		expect(session).toMatch(/Secure/);
		expect(session).toMatch(/SameSite=Lax/);
		expect(session).toMatch(/Path=\/operator/);
	});

	it("refuses a callback whose state didn't start in this browser", async () => {
		const { state } = await startSignIn();
		const other = await startSignIn();
		const code = sso.issue(operatorEmail, callbackUrl);

		const response = await get(`/operator/callback?code=${code}&state=${state}`, other.cookie);
		expect(response.status).toBe(400);
		expect(sso.exchanges).toEqual([]);
	});

	it("refuses codes bobs-server won't exchange", async () => {
		const { state, cookie } = await startSignIn();
		const response = await get(`/operator/callback?code=made-up&state=${state}`, cookie);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("refused");
	});

	it("turns away people who aren't operators", async () => {
		const { state, cookie } = await startSignIn();
		const code = sso.issue("someone@example.com", callbackUrl);
		const response = await get(`/operator/callback?code=${code}&state=${state}`, cookie);
		expect(response.status).toBe(403);
		expect(response.headers.getSetCookie().some((header) => header.startsWith("sink_operator="))).toBe(false);
	});

	it("checks the whitelist on every request", async () => {
		const session = await signIn();
		await sink.stop();
		sink = await TestSink.start({ config: config("other@example.com") });

		const response = await get("/operator", session);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/operator/sign-in");
	});

	it("registers and edits an app from the form", async () => {
		const session = await signIn();
		const registered = await post("/operator/apps", session, {
			rpId: "Example.com",
			maxDocumentsPerIdentity: "5",
			maxDocumentBytes: "",
			schema: JSON.stringify({ roots: { items: "map" } }),
		});
		expect(registered.status).toBe(303);
		expect(registered.headers.get("location")).toBe(`/operator/apps/${testApp}?saved`);
		expect(sink.sink.apps.find(testApp)?.policy).toEqual({
			maxDocumentsPerIdentity: 5,
			schema: { roots: { items: "map" } },
		});

		const again = await post("/operator/apps", session, { rpId: testApp });
		expect(again.status).toBe(400);
		expect(await again.text()).toContain("registered already");

		const edited = await post(`/operator/apps/${testApp}`, session, { maxStorageBytes: "1000", schema: "" });
		expect(edited.status).toBe(303);
		expect(sink.sink.apps.find(testApp)?.policy).toEqual({ maxStorageBytes: 1000 });

		const page = await get(`/operator/apps/${testApp}?saved`, session);
		const text = await page.text();
		expect(text).toContain("Saved.");
		expect(text).toContain('value="1000"');

		const unregistered = await post(`/operator/apps/${testApp}/unregister`, session);
		expect(unregistered.status).toBe(303);
		expect(sink.sink.apps.find(testApp)?.policy).toBeUndefined();
	});

	it("shows the form again with the problem when a policy is refused", async () => {
		const session = await signIn();
		const badJson = await post("/operator/apps", session, { rpId: testApp, schema: "{ roots:" });
		expect(badJson.status).toBe(400);
		const text = await badJson.text();
		expect(text).toContain("valid JSON");
		expect(text).toContain("{ roots:");

		const badSchema = await post("/operator/apps", session, {
			rpId: testApp,
			schema: JSON.stringify({ roots: { items: "map" }, jsonSchema: { type: "nonsense" } }),
		});
		expect(badSchema.status).toBe(400);
		expect(await badSchema.text()).toContain("invalid JSON Schema");
		expect(sink.sink.apps.list()).toEqual([]);
	});

	it("refuses changes from other origins", async () => {
		const session = await signIn();
		const response = await post("/operator/apps", session, { rpId: testApp }, "https://evil.test");
		expect(response.status).toBe(403);
		expect(sink.sink.apps.list()).toEqual([]);
	});

	it("ends the session on sign-out", async () => {
		const session = await signIn();
		const response = await post("/operator/sign-out", session);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/operator/signed-out");

		const after = await get("/operator", session);
		expect(after.status).toBe(303);
	});
});

describe("operator console, unconfigured", () => {
	it("isn't mounted", async () => {
		const sink = await TestSink.start();
		const response = await fetch(`${sink.baseUrl}/operator`, { redirect: "manual" });
		expect(response.status).toBe(404);
		await sink.stop();
	});
});

/** The `name=value` pairs of every Set-Cookie, as a Cookie header. */
function cookies(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((header) => header.split(";")[0] ?? "")
		.join("; ");
}
