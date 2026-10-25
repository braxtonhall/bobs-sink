import type { AppPolicyOverrides } from "../../src/apps/AppPolicy.js";
import type { Config } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { createSink, type Sink } from "../../src/server.js";
import type { RegistrySettings } from "../../src/documents/LiveDocumentRegistry.js";
import { SoftwarePasskey } from "@bobs-sink/test-support";
import { TestDevice } from "./TestDevice.js";

export const testApp = "example.com";
export const testOrigin = "https://example.com";

export const testConfig: Config = {
	port: 0,
	host: "127.0.0.1",
	databasePath: ":memory:",
	trustProxy: false,
	allowLocalhost: false,
	adminToken: "test-admin-token",
	logLevel: "silent",
	operator: undefined,
};

export type TestSinkOptions = {
	/** Registered before the service starts listening. */
	apps?: Record<string, AppPolicyOverrides>;
	registry?: RegistrySettings;
	config?: Partial<Config>;
};

export type CreatedDocument = { id: string; epoch: number; sizeBytes: number; visibility: string; lifecycle: string };

export type SignedIn = { identityId: string; device: TestDevice; passkey: SoftwarePasskey };

/** A running service on a random port, with helpers that act like a browser client. */
export class TestSink {
	private constructor(
		readonly sink: Sink,
		readonly baseUrl: string,
	) {}

	static async start(options: TestSinkOptions = {}): Promise<TestSink> {
		const sink = createSink({
			config: { ...testConfig, ...options.config },
			logger: createLogger("silent"),
			registry: options.registry,
		});
		for (const [rpId, overrides] of Object.entries(options.apps ?? {})) {
			sink.apps.register(rpId, overrides);
		}
		const address = await sink.listen();
		return new TestSink(sink, `http://127.0.0.1:${address.port}`);
	}

	get wsUrl(): string {
		return this.baseUrl.replace(/^http/, "ws");
	}

	stop(): Promise<void> {
		return this.sink.close();
	}

	/** An unsigned JSON request from a page on `origin`. */
	async post(path: string, body: unknown, origin = testOrigin): Promise<Response> {
		return fetch(this.baseUrl + path, {
			method: "POST",
			headers: { "content-type": "application/json", origin },
			body: JSON.stringify(body),
		});
	}

	/** A device-signed request. */
	async signed(device: TestDevice, method: string, path: string, body?: unknown): Promise<Response> {
		const text = body === undefined ? "" : JSON.stringify(body);
		return fetch(this.baseUrl + path, {
			method,
			headers: { "content-type": "application/json", ...device.requestHeaders(method, path, text) },
			...(body === undefined ? {} : { body: text }),
		});
	}

	/** Turns on cloud saves: registers a new passkey and device key. */
	async register(app = testApp, origin = `https://${app}`): Promise<SignedIn> {
		const device = new TestDevice();
		const passkey = new SoftwarePasskey(app, origin);
		const start = await json<{ ceremonyId: string; options: never }>(
			await this.post("/v1/registrations", { app, deviceKey: device.publicKey }, origin),
		);
		const finish = await json<{ identityId: string }>(
			await this.post(`/v1/registrations/${start.ceremonyId}`, { response: passkey.register(start.options) }, origin),
		);
		return { identityId: finish.identityId, device, passkey };
	}

	/** Signs in on a new device with an existing passkey. */
	async signIn(passkey: SoftwarePasskey): Promise<{ identityId: string; device: TestDevice; documents: unknown[] }> {
		const device = new TestDevice();
		const start = await json<{ ceremonyId: string; options: never }>(
			await this.post("/v1/sign-ins", { app: passkey.rpId, deviceKey: device.publicKey }, passkey.origin),
		);
		const result = await json<{ identityId: string; documents: unknown[] }>(
			await this.post(`/v1/sign-ins/${start.ceremonyId}`, { response: passkey.assert(start.options) }, passkey.origin),
		);
		return { ...result, device };
	}

	async createDocument(device: TestDevice, initialState?: string): Promise<CreatedDocument> {
		return json(await this.signed(device, "POST", "/v1/documents", initialState === undefined ? {} : { initialState }));
	}
}

export async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new Error(`${response.status} ${await response.text()}`);
	}
	return (await response.json()) as T;
}
