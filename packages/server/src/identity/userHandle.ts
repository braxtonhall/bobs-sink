import { fromBase64Url } from "../shared/base64url.js";

/** The WebAuthn user handle for an identity: the UTF-8 bytes of its ID. */
export function userHandleFor(identityId: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(identityId);
}

/** Decodes a base64url user handle from an assertion back into an identity ID. */
export function identityIdFromUserHandle(userHandle: string): string {
	return new TextDecoder().decode(fromBase64Url(userHandle));
}
