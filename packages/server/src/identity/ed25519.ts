import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { fromBase64Url } from "../shared/base64url.js";

const publicKeyBytes = 32;
const signatureBytes = 64;

/** Whether `text` is a base64url-encoded raw Ed25519 public key. */
export function isEd25519PublicKey(text: string): boolean {
	return /^[A-Za-z0-9_-]{43}$/.test(text) && fromBase64Url(text).byteLength === publicKeyBytes;
}

export function verifyEd25519(publicKey: string, message: string, signature: string): boolean {
	if (!isEd25519PublicKey(publicKey)) {
		return false;
	}
	const signatureBuffer = fromBase64Url(signature);
	if (signatureBuffer.byteLength !== signatureBytes) {
		return false;
	}
	return verify(null, Buffer.from(message, "utf8"), toKeyObject(publicKey), signatureBuffer);
}

function toKeyObject(publicKey: string): KeyObject {
	return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
}
