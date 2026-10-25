import { count, eq, isNotNull, sql } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { apps, documents, identities } from "../db/schema/index.js";
import type { AppPolicyOverrides } from "./AppPolicy.js";

export type AppSummary = {
	rpId: string;
	/** Undefined for an implicit app. */
	policy: AppPolicyOverrides | undefined;
	createdAt: Date;
	registeredAt: Date | undefined;
	updatedAt: Date | undefined;
	identities: number;
	documents: number;
	storageBytes: number;
};

export class AppRepository {
	constructor(private readonly db: Executor) {}

	/** Records the app if this is the first time the service has seen it. */
	ensure(rpId: string, now: Date): void {
		this.db.insert(apps).values({ id: rpId, createdAt: now }).onConflictDoNothing().run();
	}

	listRegistered(): [string, AppPolicyOverrides][] {
		return this.db
			.select({ id: apps.id, policy: apps.policy })
			.from(apps)
			.where(isNotNull(apps.policy))
			.all()
			.flatMap(({ id, policy }) => (policy === null ? [] : [[id, policy] as [string, AppPolicyOverrides]]));
	}

	/** Registers the app, or replaces its policy if it is registered already. */
	register(rpId: string, policy: AppPolicyOverrides, now: Date): void {
		this.db
			.insert(apps)
			.values({ id: rpId, createdAt: now, policy, registeredAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: apps.id,
				set: { policy, updatedAt: now, registeredAt: sql`coalesce(${apps.registeredAt}, excluded.registered_at)` },
			})
			.run();
	}

	unregister(rpId: string, now: Date): void {
		this.db.update(apps).set({ policy: null, registeredAt: null, updatedAt: now }).where(eq(apps.id, rpId)).run();
	}

	/** Every app with its usage, registered apps first. */
	summaries(): AppSummary[] {
		const identityCounts = this.db
			.select({ appId: identities.appId, count: count().as("identity_count") })
			.from(identities)
			.groupBy(identities.appId)
			.as("identity_counts");
		const documentTotals = this.db
			.select({
				appId: documents.appId,
				count: count().as("document_count"),
				bytes: sql<number>`sum(${documents.sizeBytes})`.as("document_bytes"),
			})
			.from(documents)
			.groupBy(documents.appId)
			.as("document_totals");
		return this.db
			.select({
				rpId: apps.id,
				policy: apps.policy,
				createdAt: apps.createdAt,
				registeredAt: apps.registeredAt,
				updatedAt: apps.updatedAt,
				// Apps without identities or documents have no row to join.
				identities: sql<number>`coalesce(${identityCounts.count}, 0)`,
				documents: sql<number>`coalesce(${documentTotals.count}, 0)`,
				storageBytes: sql<number>`coalesce(${documentTotals.bytes}, 0)`,
			})
			.from(apps)
			.leftJoin(identityCounts, eq(identityCounts.appId, apps.id))
			.leftJoin(documentTotals, eq(documentTotals.appId, apps.id))
			.orderBy(sql`${apps.policy} is null`, apps.id)
			.all()
			.map((row) => ({
				...row,
				policy: row.policy ?? undefined,
				registeredAt: row.registeredAt ?? undefined,
				updatedAt: row.updatedAt ?? undefined,
			}));
	}
}
