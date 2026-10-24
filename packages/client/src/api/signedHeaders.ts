import { requestHeaders, requestSigningMessage } from "@bobs-sink/protocol";
import type { DeviceSigner } from "../identity/DeviceKey.js";
import { toBase64Url } from "../shared/base64url.js";

/** The headers that authenticate one request as coming from `signer`. */
export async function signedHeaders(
	signer: DeviceSigner,
	request: { method: string; pathAndQuery: string; body: string },
): Promise<Record<string, string>> {
	const timestamp = String(Date.now());
	const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.body));
	const message = requestSigningMessage({
		method: request.method,
		pathAndQuery: request.pathAndQuery,
		timestamp,
		nonce,
		bodySha256: toBase64Url(new Uint8Array(digest)),
	});
	return {
		[requestHeaders.key]: signer.publicKey,
		[requestHeaders.timestamp]: timestamp,
		[requestHeaders.nonce]: nonce,
		[requestHeaders.signature]: await signer.sign(message),
	};
}
