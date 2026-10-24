import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Database } from "../../src/db/connection.js";
import { operations } from "../../src/db/schema/index.js";
import { DocumentPersistence } from "../../src/documents/DocumentPersistence.js";
import { DocumentRepository } from "../../src/documents/DocumentRepository.js";
import type { DocumentRules } from "../../src/documents/DocumentRules.js";
import { EpochArchiveRepository } from "../../src/documents/EpochArchiveRepository.js";
import { LiveDocument, type DocumentSubscriber } from "../../src/documents/LiveDocument.js";
import { freshDatabase, seedDocument } from "../helpers/seedDatabase.js";
import { ManualClock } from "../helpers/ManualClock.js";

const rules: DocumentRules = { maxBytes: 1 << 20, roots: { items: "map" }, validateJson: undefined };
const compaction = { maxUpdates: 3, idleMs: 1000 };

function deletion(doc: Y.Doc, key: string): Uint8Array {
	const before = Y.encodeStateVector(doc);
	doc.getMap("items").delete(key);
	return Y.encodeStateAsUpdate(doc, before);
}

function edit(doc: Y.Doc, key: string, value: unknown): Uint8Array {
	const before = Y.encodeStateVector(doc);
	doc.getMap("items").set(key, value);
	return Y.encodeStateAsUpdate(doc, before);
}

function subscriber(): DocumentSubscriber & { updates: Uint8Array[]; epochs: number[] } {
	const updates: Uint8Array[] = [];
	const epochs: number[] = [];
	return {
		updates,
		epochs,
		onUpdate: (update) => updates.push(update),
		onEpochChanged: (epoch) => epochs.push(epoch),
		onClosed: () => undefined,
	};
}

describe("LiveDocument", () => {
	let db: Database;
	let persistence: DocumentPersistence;
	let id: string;

	beforeEach(() => {
		vi.useFakeTimers();
		db = freshDatabase();
		persistence = new DocumentPersistence(db, new ManualClock());
		id = seedDocument(db);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function open(): LiveDocument {
		const loaded = persistence.load(id);
		if (loaded === undefined) {
			throw new Error("missing document");
		}
		return new LiveDocument(loaded, persistence, rules, compaction);
	}

	function operationCount(): number {
		return db.select().from(operations).all().length;
	}

	it("logs accepted updates and broadcasts them to everyone but the sender", () => {
		const document = open();
		const sender = subscriber();
		const other = subscriber();
		document.subscribe(sender);
		document.subscribe(other);

		const update = edit(new Y.Doc(), "a", 1);
		expect(document.apply(update, "key", sender)).toEqual({ accepted: true });

		expect(operationCount()).toBe(1);
		expect(sender.updates).toEqual([]);
		expect(other.updates).toEqual([update]);
	});

	it("doesn't log or broadcast updates it already has", () => {
		const document = open();
		const other = subscriber();
		document.subscribe(other);
		const update = edit(new Y.Doc(), "a", 1);

		document.apply(update, "key");
		document.apply(update, "key");

		expect(operationCount()).toBe(1);
		expect(other.updates).toHaveLength(1);
	});

	it("survives a reload from snapshot plus operations", () => {
		const client = new Y.Doc();
		const document = open();
		document.apply(edit(client, "a", 1), "key");
		document.compact();
		document.apply(edit(client, "b", 2), "key");

		const reloaded = new Y.Doc();
		Y.applyUpdate(reloaded, open().diff());
		expect(reloaded.getMap("items").toJSON()).toEqual({ a: 1, b: 2 });
	});

	it("compacts after enough updates, and after going idle", () => {
		const client = new Y.Doc();
		const document = open();
		for (const key of ["a", "b", "c"]) {
			document.apply(edit(client, key, 1), "key");
		}
		expect(operationCount()).toBe(0);
		expect(new DocumentRepository(db).find(id)?.snapshotSeq).toBe(3);

		document.apply(edit(client, "d", 1), "key");
		expect(operationCount()).toBe(1);
		vi.advanceTimersByTime(compaction.idleMs);
		expect(operationCount()).toBe(0);
	});

	it("merges edits from a device that was offline across compactions", () => {
		const document = open();
		const online = new Y.Doc();
		const offline = new Y.Doc();
		Y.applyUpdate(offline, document.diff());
		offline.getMap("items").set("offline", true);

		for (let index = 0; index < 10; index++) {
			document.apply(edit(online, `online-${index}`, index), "key");
		}
		document.compact();

		// Reconnect: exchange state vectors, as the sync protocol does.
		expect(document.apply(Y.encodeStateAsUpdate(offline, document.stateVector()), "key")).toEqual({ accepted: true });
		Y.applyUpdate(offline, document.diff(Y.encodeStateVector(offline)));

		expect(Object.keys(offline.getMap("items").toJSON())).toHaveLength(11);
		const server = new Y.Doc();
		Y.applyUpdate(server, document.diff());
		expect(server.getMap("items").get("offline")).toBe(true);
	});

	it("starts a new epoch: archives the old state vector, drops the log, and tells subscribers", () => {
		const document = open();
		const watcher = subscriber();
		document.subscribe(watcher);
		const client = new Y.Doc();
		document.apply(edit(client, "a", 1), "key");
		const before = new Y.Doc();
		Y.applyUpdate(before, document.diff());
		const oldSnapshot = Y.encodeSnapshot(Y.snapshot(before));

		expect(document.startNewEpoch()).toBe(1);

		expect(watcher.epochs).toEqual([1]);
		expect(operationCount()).toBe(0);
		expect(new EpochArchiveRepository(db).find(id, 0)?.finalSnapshot).toEqual(Buffer.from(oldSnapshot));
		const reloaded = open();
		expect(reloaded.epoch).toBe(1);
		const content = new Y.Doc();
		Y.applyUpdate(content, reloaded.diff());
		expect(content.getMap("items").toJSON()).toEqual({ a: 1 });
	});

	it("lets a stale client find exactly its unsynced edits and deletions after a rebuild", () => {
		const document = open();
		const client = new Y.Doc();
		document.apply(edit(client, "deletedBefore", 0), "key");
		document.apply(deletion(client, "deletedBefore"), "key");
		document.apply(edit(client, "synced", 1), "key");
		edit(client, "unsynced", 2);
		deletion(client, "synced");

		document.startNewEpoch();
		const archived = new EpochArchiveRepository(db).find(id, 0)?.finalSnapshot;
		const server = Y.decodeSnapshot(archived ?? new Uint8Array());
		const missing = Y.decodeUpdate(Y.encodeStateAsUpdate(client, Y.encodeStateVector(server.sv)));
		const items = client.getMap("items")._map;
		const deletedOffline = [...items.entries()]
			.filter(([, item]) => item.deleted && !Y.isDeleted(server.ds, item.id))
			.map(([key]) => key);

		// Replaying these into the new epoch is the client's job; the server only has to make them findable.
		expect(missing.structs.map((struct) => (struct as Y.Item).parentSub)).toEqual(["unsynced"]);
		expect(deletedOffline).toEqual(["synced"]);
	});
});
