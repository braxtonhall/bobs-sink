import type { Database } from "../db/connection.js";
import { DocumentRepository } from "../documents/DocumentRepository.js";
import { EpochArchiveRepository } from "../documents/EpochArchiveRepository.js";
import type { LiveDocumentRegistry } from "../documents/LiveDocumentRegistry.js";
import type { Clock } from "../shared/clock.js";

const day = 24 * 60 * 60 * 1000;

export type ExpirySettings = {
	/** Ephemeral documents are deleted after this long without use. */
	ephemeralTtlMs: number;
	/** Epoch archives are kept this long, at least as long as a device could stay offline and still matter. */
	archiveRetentionMs: number;
};

export const defaultExpirySettings: ExpirySettings = {
	ephemeralTtlMs: 365 * day,
	archiveRetentionMs: 400 * day,
};

/** Deletes abandoned ephemeral documents and old epoch archives. */
export class DocumentExpiry {
	constructor(
		private readonly db: Database,
		private readonly registry: LiveDocumentRegistry,
		private readonly clock: Clock,
		private readonly settings: ExpirySettings = defaultExpirySettings,
	) {}

	run(): { documents: number; archives: number } {
		const now = this.clock.now().getTime();
		const documents = new DocumentRepository(this.db);
		// A loaded document is in use, even if its last-used time hasn't been written yet.
		const expired = documents
			.listEphemeralUnusedSince(new Date(now - this.settings.ephemeralTtlMs))
			.filter((id) => !this.registry.isLive(id));
		for (const id of expired) {
			documents.delete(id);
		}
		const archives = new EpochArchiveRepository(this.db).deleteCreatedBefore(
			new Date(now - this.settings.archiveRetentionMs),
		);
		return { documents: expired.length, archives };
	}
}
