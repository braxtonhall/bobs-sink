import * as Y from "yjs";
import { openDatabase, type Database } from "../../src/db/connection.js";
import { migrateDatabase } from "../../src/db/migrate.js";
import { apps, documents, identities } from "../../src/db/schema/index.js";

export function freshDatabase(): Database {
	const db = openDatabase(":memory:");
	migrateDatabase(db);
	return db;
}

/** Inserts an app, an identity, and an empty document; returns the document's ID. */
export function seedDocument(db: Database, now = new Date()): string {
	db.insert(apps).values({ id: "example.com", createdAt: now }).onConflictDoNothing().run();
	db.insert(identities).values({ id: "identity", appId: "example.com", createdAt: now }).onConflictDoNothing().run();
	const snapshot = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
	db.insert(documents)
		.values({
			id: "doc",
			appId: "example.com",
			ownerId: "identity",
			visibility: "private",
			lifecycle: "ephemeral",
			epoch: 0,
			snapshot,
			snapshotSeq: 0,
			sizeBytes: snapshot.byteLength,
			createdAt: now,
			lastUsedAt: now,
		})
		.run();
	return "doc";
}
