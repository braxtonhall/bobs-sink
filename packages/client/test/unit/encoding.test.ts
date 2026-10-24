import { verify } from "node:crypto";
import { requestHeaders, requestSigningMessage } from "@bobs-sink/protocol";
import { describe, expect, it } from "vitest";
import { signedHeaders } from "../../src/api/signedHeaders.js";
import { DeviceKey } from "../../src/identity/DeviceKey.js";
import { fromBase64Url, toBase64Url } from "../../src/shared/base64url.js";
import { Backoff } from "../../src/sync/Backoff.js";

describe("base64url", () => {
	it("matches Node's encoding for every length", () => {
		for (let length = 0; length < 40; length++) {
			const bytes = Uint8Array.from({ length }, (_, index) => (index * 73 + 250) % 256);
			const encoded = toBase64Url(bytes);
			expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
			expect(fromBase64Url(encoded)).toEqual(bytes);
		}
	});
});

describe("DeviceKey", () => {
	it("signs with a non-extractable key and a raw base64url public key", async () => {
		const key = await DeviceKey.generate();
		const signature = await key.sign("hello");

		expect(key.keyPair.privateKey.extractable).toBe(false);
		expect(fromBase64Url(key.publicKey)).toHaveLength(32);
		const publicKey = { key: { kty: "OKP", crv: "Ed25519", x: key.publicKey }, format: "jwk" } as const;
		expect(verify(null, Buffer.from("hello"), publicKey, fromBase64Url(signature))).toBe(true);
	});
});

describe("signedHeaders", () => {
	it("signs the request's method, path, timestamp, nonce, and body hash", async () => {
		const key = await DeviceKey.generate();
		const body = JSON.stringify({ a: 1 });

		const headers = await signedHeaders(key, { method: "post", pathAndQuery: "/v1/documents?x=1", body });
		const message = requestSigningMessage({
			method: "POST",
			pathAndQuery: "/v1/documents?x=1",
			timestamp: headers[requestHeaders.timestamp] ?? "",
			nonce: headers[requestHeaders.nonce] ?? "",
			bodySha256: Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(body))).toString("base64url"),
		});

		expect(headers[requestHeaders.key]).toBe(key.publicKey);
		const publicKey = { key: { kty: "OKP", crv: "Ed25519", x: key.publicKey }, format: "jwk" } as const;
		const signature = fromBase64Url(headers[requestHeaders.signature] ?? "");
		expect(verify(null, Buffer.from(message), publicKey, signature)).toBe(true);
	});
});

describe("Backoff", () => {
	it("grows exponentially up to the cap, and resets", () => {
		const backoff = new Backoff({ initialMs: 100, maxMs: 1000 });
		const delays = Array.from({ length: 8 }, () => backoff.next());

		expect(delays.every((delay) => delay >= 0 && delay <= 1000)).toBe(true);
		backoff.reset();
		expect(backoff.next()).toBeLessThanOrEqual(100);
	});
});
