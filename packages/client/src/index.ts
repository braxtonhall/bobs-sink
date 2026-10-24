export { SinkApiError } from "./api/SinkApiError.js";
export type { Fetch } from "./api/SinkApi.js";
export { keepRemote, mergeDocuments, type ConflictResolver, type MergeConflict } from "./documents/mergeDocuments.js";
export type { Roots } from "./documents/roots.js";
export { browserPasskeys, type PasskeyAuthenticator } from "./identity/Passkeys.js";
export {
	SinkClient,
	type ClientSyncStatus,
	type IdentityStatus,
	type SignInOutcome,
	type SinkClientEvents,
	type SinkClientOptions,
} from "./SinkClient.js";
export type { DocumentBinding } from "./storage/ClientStateStore.js";
export type { BackoffOptions } from "./sync/Backoff.js";
export type { WebSocketConstructor } from "./sync/SyncConnection.js";
export type { StopReason, SyncStatus } from "./sync/SyncProvider.js";
export type { DocumentInfo, RejectionReason, RootType } from "@bobs-sink/protocol";
