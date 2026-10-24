import { SoftwarePasskey } from "@bobs-sink/test-support";
import type { PasskeyAuthenticator } from "../../src/identity/Passkeys.js";
import { SinkClient } from "../../src/SinkClient.js";
import { TestNetwork } from "./TestNetwork.js";
import { testApp, testOrigin, testRoots, type TestServer } from "./TestServer.js";

/** A passkey the user's devices share, as a synced passkey would be. */
export function newPasskey(): SoftwarePasskey {
	return new SoftwarePasskey(testApp, testOrigin);
}

export function softwarePasskeys(passkey: SoftwarePasskey): PasskeyAuthenticator {
	return {
		register: (options) => Promise.resolve(passkey.register(options)),
		authenticate: (options) => Promise.resolve(passkey.assert(options)),
	};
}

let deviceCount = 0;

/** One browser: its own storage and network, and access to the user's passkey. */
export class TestDevice {
	readonly network = new TestNetwork();
	private readonly storagePrefix = `device-${++deviceCount}`;

	constructor(
		private readonly server: TestServer,
		readonly passkey: SoftwarePasskey = newPasskey(),
	) {}

	open(): Promise<SinkClient> {
		return SinkClient.open({
			serviceUrl: this.server.baseUrl,
			app: testApp,
			roots: testRoots,
			storagePrefix: this.storagePrefix,
			passkeys: softwarePasskeys(this.passkey),
			// Browsers send the page's origin themselves.
			fetch: (input, init) => {
				const headers = new Headers(init?.headers);
				headers.set("origin", testOrigin);
				return fetch(input, { ...init, headers });
			},
			WebSocket: this.network.WebSocket,
			reconnect: { initialMs: 10, maxMs: 50 },
			batchMs: 5,
		});
	}
}

export function items(client: SinkClient): Record<string, unknown> {
	return client.doc.getMap("items").toJSON();
}
