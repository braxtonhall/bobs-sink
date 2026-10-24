import { randomBytes } from "node:crypto";
import { toBase64Url } from "./base64url.js";

/** A URL-safe random identifier with 256 bits of entropy (43 characters). */
export function randomId(): string {
	return toBase64Url(randomBytes(32));
}
