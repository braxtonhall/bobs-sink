import { and, asc, eq, gt, lte, max } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { operations } from "../db/schema/index.js";

export type Operation = typeof operations.$inferSelect;

export class OperationRepository {
	constructor(private readonly db: Executor) {}

	append(operation: Operation): void {
		this.db.insert(operations).values(operation).run();
	}

	listAfter(documentId: string, seq: number): Operation[] {
		return this.db
			.select()
			.from(operations)
			.where(and(eq(operations.documentId, documentId), gt(operations.seq, seq)))
			.orderBy(asc(operations.seq))
			.all();
	}

	maxSeq(documentId: string): number | undefined {
		return (
			this.db
				.select({ value: max(operations.seq) })
				.from(operations)
				.where(eq(operations.documentId, documentId))
				.get()?.value ?? undefined
		);
	}

	deleteThrough(documentId: string, seq: number): void {
		this.db
			.delete(operations)
			.where(and(eq(operations.documentId, documentId), lte(operations.seq, seq)))
			.run();
	}
}
