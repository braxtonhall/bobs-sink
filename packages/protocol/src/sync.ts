/**
 * Sync protocol over one WebSocket per document, at `/v1/sync/:documentId`.
 *
 * 1. Server sends a text `challenge`.
 * 2. Client replies with a text `authenticate`, signing the challenge with its device key (see
 *    `connectionSigningMessage`) and naming the epoch its local state belongs to (null if it has none).
 * 3. Server replies with a text `ready`, then both sides exchange binary sync messages: a `messageSync` byte
 *    followed by a y-protocols sync message (step 1, step 2, or update).
 *
 * A rejected update gets a text `rejected` and the connection stays open. The client's Y.Doc now holds
 * something the server will never accept, and every later update from that Y.Doc builds on it, so those are
 * rejected too (`missing_dependencies`). The client must discard that Y.Doc, start a new one from the server's
 * state, and re-apply whatever it wants to keep. Clients should validate locally so this stays rare.
 */

export const messageSync = 0;

export type ClientMessage = {
	type: "authenticate";
	/** base64url raw Ed25519 public key. */
	key: string;
	/** base64url signature of `connectionSigningMessage`. */
	signature: string;
	epoch: number | null;
};

export type Access = "read" | "write";

export type RejectionReason =
	"malformed" | "missing_dependencies" | "too_large" | "unknown_root" | "schema_violation" | "read_only";

export type ServerMessage =
	| { type: "challenge"; challenge: string }
	| { type: "ready"; epoch: number; access: Access }
	| { type: "rejected"; reason: RejectionReason };

export const closeCodes = {
	/** The server is shutting down; reconnect later. */
	goingAway: 1001,
	badMessage: 4400,
	unauthorized: 4401,
	notFound: 4404,
	authenticationTimeout: 4408,
	/** The document is in a newer epoch than the client's state; the reason holds the epoch. */
	epochChanged: 4409,
	/** The document was deleted. */
	gone: 4410,
	rateLimited: 4429,
} as const;
