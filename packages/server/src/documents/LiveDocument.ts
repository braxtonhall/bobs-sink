import * as Y from "yjs";
import { SinkError } from "../shared/errors.js";
import type { DocumentMetadata, DocumentPersistence, LoadedDocument } from "./DocumentPersistence.js";
import type { DocumentRules } from "./DocumentRules.js";
import { rebuildDocument } from "./rebuildDocument.js";
import { validateUpdate, type RejectionReason } from "./validateUpdate.js";

export type CompactionSettings = {
	/** Compact after this many updates since the last snapshot. */
	maxUpdates: number;
	/** Compact after this long without updates. */
	idleMs: number;
};

export type DocumentSubscriber = {
	/** An accepted update from another subscriber (or the server). */
	onUpdate(update: Uint8Array): void;
	/** The document was rebuilt; the subscriber's state belongs to an old epoch. */
	onEpochChanged(epoch: number): void;
	/** The document was unloaded while subscribed. */
	onClosed(reason: CloseReason): void;
};

export type CloseReason = "deleted" | "unloaded";

export type ApplyResult = { accepted: true } | { accepted: false; reason: RejectionReason };

/**
 * The in-memory copy of one document while anyone is using it. It is the source of truth while loaded:
 * every accepted update is validated, written to the operation log, applied, and then broadcast.
 *
 * Methods are synchronous, including storage, so each update runs to completion before the next one starts.
 * That ordering is what keeps seq assignment and compaction consistent without an explicit lock.
 */
export class LiveDocument {
	private readonly subscribers = new Set<DocumentSubscriber>();
	private doc: Y.Doc;
	private nextSeq: number;
	private updatesSinceSnapshot = 0;
	private idleTimer: NodeJS.Timeout | undefined;

	constructor(
		loaded: LoadedDocument,
		private readonly persistence: DocumentPersistence,
		private readonly rules: DocumentRules,
		private readonly compaction: CompactionSettings,
	) {
		this.metadata = { ...loaded.metadata };
		this.doc = loaded.doc;
		this.nextSeq = loaded.nextSeq;
	}

	readonly metadata: DocumentMetadata;

	get id(): string {
		return this.metadata.id;
	}

	get epoch(): number {
		return this.metadata.epoch;
	}

	get subscriberCount(): number {
		return this.subscribers.size;
	}

	stateVector(): Uint8Array {
		return Y.encodeStateVector(this.doc);
	}

	/** Everything the document has that a peer with `stateVector` is missing. */
	diff(stateVector?: Uint8Array): Uint8Array {
		return Y.encodeStateAsUpdate(this.doc, stateVector);
	}

	subscribe(subscriber: DocumentSubscriber): () => void {
		this.subscribers.add(subscriber);
		return () => this.subscribers.delete(subscriber);
	}

	/** Validates and applies an update from `origin`, then sends it to every other subscriber. */
	apply(update: Uint8Array, deviceKey: string, origin?: DocumentSubscriber): ApplyResult {
		const validation = validateUpdate(this.doc, update, this.rules);
		if (!validation.accepted) {
			return validation;
		}
		if (!validation.changed) {
			return { accepted: true };
		}
		this.persistence.append(this.id, this.nextSeq, update, deviceKey);
		this.nextSeq += 1;
		this.updatesSinceSnapshot += 1;
		// The scratch copy validation produced already has the update applied, so it becomes the document.
		this.doc.destroy();
		this.doc = validation.result;
		for (const subscriber of this.subscribers) {
			if (subscriber !== origin) {
				subscriber.onUpdate(update);
			}
		}
		this.scheduleCompaction();
		return { accepted: true };
	}

	/** Writes a snapshot and drops the operations it covers. */
	compact(): void {
		this.cancelIdleTimer();
		if (this.updatesSinceSnapshot === 0) {
			return;
		}
		this.persistence.compact(this.id, Y.encodeStateAsUpdate(this.doc), this.nextSeq - 1);
		this.updatesSinceSnapshot = 0;
	}

	/**
	 * Replaces the document with a fresh copy of its content in a new epoch, archiving the old epoch's state
	 * vector so stale clients can find their unsynced edits. Subscribers are told to resync.
	 */
	startNewEpoch(): number {
		if (this.rules.roots === undefined) {
			throw new SinkError("bad_request", "rebuilding needs an app schema that declares roots");
		}
		this.cancelIdleTimer();
		const rebuilt = rebuildDocument(this.doc, this.rules.roots);
		const endedEpoch = this.metadata.epoch;
		this.persistence.startEpoch(this.id, {
			endedEpoch,
			endedSnapshot: Y.encodeSnapshot(Y.snapshot(this.doc)),
			snapshot: Y.encodeStateAsUpdate(rebuilt),
			throughSeq: this.nextSeq - 1,
		});
		this.doc.destroy();
		this.doc = rebuilt;
		this.metadata.epoch = endedEpoch + 1;
		this.updatesSinceSnapshot = 0;
		for (const subscriber of [...this.subscribers]) {
			subscriber.onEpochChanged(this.metadata.epoch);
		}
		return this.metadata.epoch;
	}

	/** Releases the document, compacting first unless it was deleted. Subscribers are told why. */
	dispose(reason: CloseReason): void {
		if (reason !== "deleted") {
			this.compact();
		}
		this.cancelIdleTimer();
		for (const subscriber of [...this.subscribers]) {
			subscriber.onClosed(reason);
		}
		this.subscribers.clear();
		this.doc.destroy();
	}

	private scheduleCompaction(): void {
		if (this.updatesSinceSnapshot >= this.compaction.maxUpdates) {
			this.compact();
			return;
		}
		this.cancelIdleTimer();
		this.idleTimer = setTimeout(() => {
			this.compact();
		}, this.compaction.idleMs);
		this.idleTimer.unref();
	}

	private cancelIdleTimer(): void {
		clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}
}
