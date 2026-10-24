import type { DocumentPersistence } from "./DocumentPersistence.js";
import type { DocumentRulesProvider } from "./DocumentRules.js";
import { LiveDocument, type CloseReason, type CompactionSettings, type DocumentSubscriber } from "./LiveDocument.js";

export type RegistrySettings = {
	compaction: CompactionSettings;
	/** Unload a document this long after its last subscriber leaves. */
	evictAfterMs: number;
};

export type Lease = {
	document: LiveDocument;
	release(): void;
};

/** Loads documents into memory while they have subscribers and unloads them once they've been idle. */
export class LiveDocumentRegistry {
	private readonly live = new Map<string, LiveDocument>();
	private readonly evictionTimers = new Map<string, NodeJS.Timeout>();

	constructor(
		private readonly persistence: DocumentPersistence,
		private readonly rules: DocumentRulesProvider,
		private readonly settings: RegistrySettings,
	) {}

	/** Subscribes to a document, loading it if needed. Returns undefined if the document doesn't exist. */
	acquire(id: string, subscriber: DocumentSubscriber): Lease | undefined {
		const document = this.load(id);
		if (document === undefined) {
			return undefined;
		}
		this.cancelEviction(id);
		const unsubscribe = document.subscribe(subscriber);
		this.persistence.touch(id);
		let released = false;
		return {
			document,
			release: () => {
				if (released) {
					return;
				}
				released = true;
				unsubscribe();
				if (document.subscriberCount === 0 && this.live.get(id) === document) {
					this.scheduleEviction(id);
				}
			},
		};
	}

	/** Gets a document, loading it if needed, without subscribing. */
	load(id: string): LiveDocument | undefined {
		const existing = this.live.get(id);
		if (existing !== undefined) {
			return existing;
		}
		const loaded = this.persistence.load(id);
		if (loaded === undefined) {
			return undefined;
		}
		const document = new LiveDocument(
			loaded,
			this.persistence,
			this.rules.get(loaded.metadata.appId),
			this.settings.compaction,
		);
		this.live.set(id, document);
		this.scheduleEviction(id);
		return document;
	}

	isLive(id: string): boolean {
		return this.live.has(id);
	}

	/** Unloads a document that is being deleted, without compacting it. */
	discard(id: string): void {
		this.unload(id, "deleted");
	}

	/** Compacts and unloads every document. */
	closeAll(): void {
		for (const id of [...this.live.keys()]) {
			this.unload(id, "unloaded");
		}
	}

	private scheduleEviction(id: string): void {
		this.cancelEviction(id);
		const timer = setTimeout(() => {
			const document = this.live.get(id);
			if (document?.subscriberCount === 0) {
				this.unload(id, "unloaded");
			}
		}, this.settings.evictAfterMs);
		timer.unref();
		this.evictionTimers.set(id, timer);
	}

	private cancelEviction(id: string): void {
		clearTimeout(this.evictionTimers.get(id));
		this.evictionTimers.delete(id);
	}

	private unload(id: string, reason: CloseReason): void {
		this.cancelEviction(id);
		const document = this.live.get(id);
		this.live.delete(id);
		document?.dispose(reason);
	}
}
