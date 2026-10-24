import { clearDocument, IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

/**
 * A Y.Doc and its IndexedDB copy. Every change to the doc, local or synced, is saved. Each replica gets a
 * database of its own, so replacing one never has to clear a database that may still be open (in another tab).
 */
export class Replica {
	private constructor(
		readonly doc: Y.Doc,
		private readonly persistence: IndexeddbPersistence,
	) {}

	/** Loads the replica saved under `name`, or starts an empty one there. */
	static async open(name: string): Promise<Replica> {
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(name, doc);
		await persistence.whenSynced;
		return new Replica(doc, persistence);
	}

	static create(prefix: string): Promise<Replica> {
		return Replica.open(`${replicaPrefix(prefix)}${crypto.randomUUID()}`);
	}

	/**
	 * Deletes replicas under `prefix` other than `keep`, left behind by a switch that was interrupted. Runs in
	 * the background: deleting a database another tab has open waits until that tab closes it.
	 */
	static deleteOthers(prefix: string, keep: string): void {
		if (typeof indexedDB.databases !== "function") {
			return;
		}
		void indexedDB
			.databases()
			.then((databases) => {
				for (const { name } of databases) {
					if (name?.startsWith(replicaPrefix(prefix)) === true && name !== keep) {
						void clearDocument(name).catch(() => undefined);
					}
				}
			})
			.catch(() => undefined);
	}

	get name(): string {
		return this.persistence.name;
	}

	/** Destroys the doc and deletes the saved copy in the background. */
	discard(): void {
		void this.persistence.clearData().catch(() => undefined);
		this.doc.destroy();
	}

	/** Stops saving and destroys the doc; the saved copy stays. */
	async close(): Promise<void> {
		await this.persistence.destroy();
		this.doc.destroy();
	}
}

function replicaPrefix(prefix: string): string {
	return `${prefix}:replica:`;
}
