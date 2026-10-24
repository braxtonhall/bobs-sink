/**
 * The exact strings device keys sign. Clients must build these byte-for-byte; changing one is a protocol
 * version bump.
 */

export const requestHeaders = {
	key: "sink-key",
	timestamp: "sink-timestamp",
	nonce: "sink-nonce",
	signature: "sink-signature",
} as const;

export type RequestSigningInput = {
	method: string;
	/** Path and query string, e.g. "/v1/documents?x=1". */
	pathAndQuery: string;
	/** Milliseconds since the Unix epoch, as sent in the timestamp header. */
	timestamp: string;
	nonce: string;
	/** base64url SHA-256 of the raw request body (of the empty string when there is none). */
	bodySha256: string;
};

export function requestSigningMessage(input: RequestSigningInput): string {
	return [
		"bobs-sink-request-v1",
		input.method.toUpperCase(),
		input.pathAndQuery,
		input.timestamp,
		input.nonce,
		input.bodySha256,
	].join("\n");
}

export type ConnectionSigningInput = {
	documentId: string;
	/** Challenge the server sent on this connection. */
	challenge: string;
};

export function connectionSigningMessage(input: ConnectionSigningInput): string {
	return ["bobs-sink-connect-v1", input.documentId, input.challenge].join("\n");
}
