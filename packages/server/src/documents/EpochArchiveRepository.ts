import { and, eq, lt } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { epochArchives } from "../db/schema/index.js";

export type EpochArchive = typeof epochArchives.$inferSelect;

export class EpochArchiveRepository {
	constructor(private readonly db: Executor) {}

	create(archive: EpochArchive): void {
		this.db.insert(epochArchives).values(archive).run();
	}

	find(documentId: string, epoch: number): EpochArchive | undefined {
		return this.db
			.select()
			.from(epochArchives)
			.where(and(eq(epochArchives.documentId, documentId), eq(epochArchives.epoch, epoch)))
			.get();
	}

	deleteCreatedBefore(cutoff: Date): number {
		return this.db.delete(epochArchives).where(lt(epochArchives.createdAt, cutoff)).run().changes;
	}
}
