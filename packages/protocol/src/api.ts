/** JSON bodies of the HTTP API under `/v1`. Dates are ISO 8601 strings. */

export const rootTypes = ["map", "array", "text"] as const;
/** The kind of a document's top-level shared type. */
export type RootType = (typeof rootTypes)[number];

export const visibilities = ["private", "public-read", "public-write"] as const;
export type Visibility = (typeof visibilities)[number];

export const lifecycles = ["ephemeral", "pinned"] as const;
export type Lifecycle = (typeof lifecycles)[number];

export type ErrorKind =
	"bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "payload_too_large" | "rate_limited";

export type ErrorBody = { error: ErrorKind | "internal"; message: string };

export type DocumentInfo = {
	id: string;
	appId: string;
	ownerId: string;
	visibility: Visibility;
	lifecycle: Lifecycle;
	epoch: number;
	sizeBytes: number;
	createdAt: string;
	lastUsedAt: string;
};

/** The first half of a passkey ceremony. `Options` is the WebAuthn options JSON for the browser. */
export type CeremonyStart<Options> = { ceremonyId: string; options: Options };

export type RegistrationStartBody = { app: string; deviceKey: string; userName?: string };
export type SignInStartBody = { app: string; deviceKey: string };
export type RevocationStartBody = { app: string; deviceKeys: string[] };
/** `Response` is the browser's WebAuthn response JSON. */
export type CeremonyFinishBody<Response> = { response: Response };

export type RegistrationResult = { identityId: string };
export type SignInResult = { identityId: string; documents: DocumentInfo[] };
export type RevocationResult = { revoked: number };

export type MeResult = {
	identityId: string;
	app: string;
	deviceKey: string;
	deviceKeys: { publicKey: string; createdAt: string; lastUsedAt: string }[];
};

export type DocumentListResult = { documents: DocumentInfo[] };
/** `initialState` is a base64url Yjs update. */
export type CreateDocumentBody = { initialState?: string };
/** `finalSnapshot` is a base64url `Y.encodeSnapshot` of the server's state when the epoch ended. */
export type EpochArchiveResult = { epoch: number; finalSnapshot: string };
