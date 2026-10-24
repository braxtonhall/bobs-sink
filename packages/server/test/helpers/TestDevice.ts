import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { toBase64Url } from "../../src/shared/base64url.js";
import { connectionSigningMessage, requestHeaders, requestSigningMessage } from "@bobs-sink/protocol";

/** A browser's device key: an Ed25519 key pair that signs requests and sync connections. */
export class TestDevice {
	readonly publicKey: string;
	private readonly privateKey: KeyObject;

	constructor() {
		const pair = generateKeyPairSync("ed25519");
		this.privateKey = pair.privateKey;
		this.publicKey = pair.publicKey.export({ format: "jwk" }).x ?? "";
	}

	sign(message: string): string {
		return toBase64Url(sign(null, Buffer.from(message), this.privateKey));
	}

	requestHeaders(method: string, pathAndQuery: string, body = "", timestamp = Date.now()): Record<string, string> {
		const nonce = toBase64Url(randomBytes(16));
		const message = requestSigningMessage({
			method,
			pathAndQuery,
			timestamp: String(timestamp),
			nonce,
			bodySha256: toBase64Url(createHash("sha256").update(body).digest()),
		});
		return {
			[requestHeaders.key]: this.publicKey,
			[requestHeaders.timestamp]: String(timestamp),
			[requestHeaders.nonce]: nonce,
			[requestHeaders.signature]: this.sign(message),
		};
	}

	signConnection(documentId: string, challenge: string): string {
		return this.sign(connectionSigningMessage({ documentId, challenge }));
	}
}
