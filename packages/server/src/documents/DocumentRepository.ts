import { and, count, eq, lt, sql } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { documents } from "../db/schema/index.js";

export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentSummary = Omit<DocumentRecord, "snapshot" | "snapshotSeq">;

const summaryColumns = {
	id: documents.id,
	appId: documents.appId,
	ownerId: documents.ownerId,
	visibility: documents.visibility,
	lifecycle: documents.lifecycle,
	epoch: documents.epoch,
	sizeBytes: documents.sizeBytes,
	createdAt: documents.createdAt,
	lastUsedAt: documents.lastUsedAt,
};

export class DocumentRepository {
	constructor(private readonly db: Executor) {}

	create(record: DocumentRecord): void {
		this.db.insert(documents).values(record).run();
	}

	find(id: string): DocumentRecord | undefined {
		return this.db.select().from(documents).where(eq(documents.id, id)).get();
	}

	findSummary(id: string): DocumentSummary | undefined {
		return this.db.select(summaryColumns).from(documents).where(eq(documents.id, id)).get();
	}

	listForOwner(ownerId: string): DocumentSummary[] {
		return this.db.select(summaryColumns).from(documents).where(eq(documents.ownerId, ownerId)).all();
	}

	countForOwner(ownerId: string): number {
		return this.db.select({ value: count() }).from(documents).where(eq(documents.ownerId, ownerId)).get()?.value ?? 0;
	}

	totalBytesForApp(appId: string): number {
		const row = this.db
			.select({ value: sql<number>`coalesce(sum(${documents.sizeBytes}), 0)` })
			.from(documents)
			.where(eq(documents.appId, appId))
			.get();
		return row?.value ?? 0;
	}

	saveSnapshot(id: string, snapshot: { bytes: Uint8Array; throughSeq: number; at: Date }): void {
		this.db
			.update(documents)
			.set({
				snapshot: Buffer.from(snapshot.bytes),
				snapshotSeq: snapshot.throughSeq,
				sizeBytes: snapshot.bytes.byteLength,
				lastUsedAt: snapshot.at,
			})
			.where(eq(documents.id, id))
			.run();
	}

	setEpoch(id: string, epoch: number): void {
		this.db.update(documents).set({ epoch }).where(eq(documents.id, id)).run();
	}

	touch(id: string, at: Date): void {
		this.db.update(documents).set({ lastUsedAt: at }).where(eq(documents.id, id)).run();
	}

	delete(id: string): void {
		this.db.delete(documents).where(eq(documents.id, id)).run();
	}

	listEphemeralUnusedSince(cutoff: Date): string[] {
		return this.db
			.select({ id: documents.id })
			.from(documents)
			.where(and(eq(documents.lifecycle, "ephemeral"), lt(documents.lastUsedAt, cutoff)))
			.all()
			.map((row) => row.id);
	}
}
