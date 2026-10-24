import * as Y from "yjs";
import type { AppPolicies } from "../apps/AppPolicies.js";
import type { Database } from "../db/connection.js";
import type { DeviceAuthority } from "../identity/DeviceKeyRepository.js";
import { perHour } from "../limits/rateRules.js";
import type { RateLimiter } from "../limits/RateLimiter.js";
import type { Clock } from "../shared/clock.js";
import { SinkError } from "../shared/errors.js";
import { randomId } from "../shared/randomId.js";
import { documentAccess, type Access } from "./documentAccess.js";
import { DocumentRepository, type DocumentSummary } from "./DocumentRepository.js";
import type { DocumentRulesProvider } from "./DocumentRules.js";
import { EpochArchiveRepository } from "./EpochArchiveRepository.js";
import type { LiveDocumentRegistry } from "./LiveDocumentRegistry.js";
import { validateUpdate } from "./validateUpdate.js";

/** Document lifecycle operations outside of live sync: listing, creating, deleting, and epoch archives. */
export class DocumentService {
	constructor(
		private readonly db: Database,
		private readonly registry: LiveDocumentRegistry,
		private readonly policies: AppPolicies,
		private readonly rules: DocumentRulesProvider,
		private readonly limiter: RateLimiter,
		private readonly clock: Clock,
	) {}

	listOwned(identityId: string): DocumentSummary[] {
		return new DocumentRepository(this.db).listForOwner(identityId);
	}

	/** Creates a private, ephemeral document, optionally seeded with a Yjs update (e.g. the device's local state). */
	create(authority: DeviceAuthority, initialState: Uint8Array | undefined): DocumentSummary {
		const policy = this.policies.get(authority.appId);
		const documents = new DocumentRepository(this.db);
		if (documents.countForOwner(authority.identityId) >= policy.maxDocumentsPerIdentity) {
			throw new SinkError("forbidden", "document limit reached");
		}
		if (documents.totalBytesForApp(authority.appId) >= policy.maxStorageBytes) {
			throw new SinkError("forbidden", "app storage limit reached");
		}
		const snapshot = this.initialSnapshot(authority.appId, initialState);
		if (!this.limiter.tryTake(`documents:${authority.appId}`, perHour(policy.documentsPerHour))) {
			throw new SinkError("rate_limited", "too many new documents for this app");
		}
		const now = this.clock.now();
		const record = {
			id: randomId(),
			appId: authority.appId,
			ownerId: authority.identityId,
			visibility: "private" as const,
			lifecycle: "ephemeral" as const,
			epoch: 0,
			snapshot: Buffer.from(snapshot),
			snapshotSeq: 0,
			sizeBytes: snapshot.byteLength,
			createdAt: now,
			lastUsedAt: now,
		};
		documents.create(record);
		const { snapshot: _, snapshotSeq, ...summary } = record;
		return summary;
	}

	delete(authority: DeviceAuthority, id: string): void {
		this.requireAccess(authority, id, "write");
		this.registry.discard(id);
		new DocumentRepository(this.db).delete(id);
	}

	/** The server's final state for an ended epoch, as an encoded Y.Snapshot. */
	epochFinalSnapshot(authority: DeviceAuthority, id: string, epoch: number): Uint8Array {
		this.requireAccess(authority, id, "read");
		const archive = new EpochArchiveRepository(this.db).find(id, epoch);
		if (archive === undefined) {
			throw new SinkError("not_found", "no archive for that epoch");
		}
		return archive.finalSnapshot;
	}

	/** Rebuilds a document into a new epoch. Administrative; callers must already be trusted. */
	startNewEpoch(id: string): number {
		const document = this.registry.load(id);
		if (document === undefined) {
			throw new SinkError("not_found", "document not found");
		}
		return document.startNewEpoch();
	}

	/** Looks up a document and checks the device's access; private documents look missing to others. */
	requireAccess(authority: DeviceAuthority | undefined, id: string, needed: Exclude<Access, "none">): DocumentSummary {
		const document = new DocumentRepository(this.db).findSummary(id);
		const access = document === undefined ? "none" : documentAccess(document, authority);
		if (document === undefined || access === "none") {
			throw new SinkError("not_found", "document not found");
		}
		if (needed === "write" && access !== "write") {
			throw new SinkError("forbidden", "document is read-only");
		}
		return document;
	}

	private initialSnapshot(appId: string, initialState: Uint8Array | undefined): Uint8Array {
		const empty = new Y.Doc({ gc: true });
		if (initialState === undefined) {
			return Y.encodeStateAsUpdate(empty);
		}
		const validation = validateUpdate(empty, initialState, this.rules.get(appId));
		if (!validation.accepted) {
			throw new SinkError(
				validation.reason === "too_large" ? "payload_too_large" : "bad_request",
				`initial state rejected: ${validation.reason}`,
			);
		}
		return Y.encodeStateAsUpdate(validation.result);
	}
}
