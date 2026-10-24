import * as Y from "yjs";
import type { Database } from "../db/connection.js";
import type { Clock } from "../shared/clock.js";
import { DocumentRepository, type DocumentRecord } from "./DocumentRepository.js";
import { EpochArchiveRepository } from "./EpochArchiveRepository.js";
import { OperationRepository } from "./OperationRepository.js";

export type DocumentMetadata = Omit<DocumentRecord, "snapshot" | "snapshotSeq" | "sizeBytes">;

export type LoadedDocument = {
	metadata: DocumentMetadata;
	doc: Y.Doc;
	/** Seq to assign to the next appended operation. */
	nextSeq: number;
};

/** Durable storage for live documents: a snapshot plus a write-ahead log of updates since it. */
export class DocumentPersistence {
	constructor(
		private readonly db: Database,
		private readonly clock: Clock,
	) {}

	load(id: string): LoadedDocument | undefined {
		const record = new DocumentRepository(this.db).find(id);
		if (record === undefined) {
			return undefined;
		}
		const { snapshot, snapshotSeq, sizeBytes, ...metadata } = record;
		const doc = new Y.Doc({ gc: true });
		Y.applyUpdate(doc, snapshot);
		const operations = new OperationRepository(this.db).listAfter(id, snapshotSeq);
		for (const operation of operations) {
			Y.applyUpdate(doc, operation.payload);
		}
		return { metadata, doc, nextSeq: (operations.at(-1)?.seq ?? snapshotSeq) + 1 };
	}

	append(documentId: string, seq: number, payload: Uint8Array, deviceKey: string): void {
		new OperationRepository(this.db).append({
			documentId,
			seq,
			payload: Buffer.from(payload),
			deviceKey,
			createdAt: this.clock.now(),
		});
	}

	/** Replaces the snapshot and drops the operations it now contains, atomically. */
	compact(documentId: string, snapshot: Uint8Array, throughSeq: number): void {
		this.db.transaction((tx) => {
			new DocumentRepository(tx).saveSnapshot(documentId, { bytes: snapshot, throughSeq, at: this.clock.now() });
			new OperationRepository(tx).deleteThrough(documentId, throughSeq);
		});
	}

	/** Archives the ending epoch's final snapshot and stores the rebuilt document as the new epoch, atomically. */
	startEpoch(
		documentId: string,
		change: { endedEpoch: number; endedSnapshot: Uint8Array; snapshot: Uint8Array; throughSeq: number },
	): void {
		const now = this.clock.now();
		this.db.transaction((tx) => {
			new EpochArchiveRepository(tx).create({
				documentId,
				epoch: change.endedEpoch,
				finalSnapshot: Buffer.from(change.endedSnapshot),
				createdAt: now,
			});
			const documents = new DocumentRepository(tx);
			documents.setEpoch(documentId, change.endedEpoch + 1);
			documents.saveSnapshot(documentId, { bytes: change.snapshot, throughSeq: change.throughSeq, at: now });
			new OperationRepository(tx).deleteThrough(documentId, change.throughSeq);
		});
	}

	touch(documentId: string): void {
		new DocumentRepository(this.db).touch(documentId, this.clock.now());
	}
}
