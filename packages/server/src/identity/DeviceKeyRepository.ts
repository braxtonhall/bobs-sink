import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "../db/connection.js";
import { deviceKeys, identities } from "../db/schema/index.js";

export type DeviceKey = typeof deviceKeys.$inferSelect;

/** An authorized device key together with who it signs for. */
export type DeviceAuthority = {
	publicKey: string;
	identityId: string;
	appId: string;
};

export class DeviceKeyRepository {
	constructor(private readonly db: Executor) {}

	create(deviceKey: DeviceKey): void {
		this.db.insert(deviceKeys).values(deviceKey).run();
	}

	find(publicKey: string): DeviceKey | undefined {
		return this.db.select().from(deviceKeys).where(eq(deviceKeys.publicKey, publicKey)).get();
	}

	findAuthority(publicKey: string): DeviceAuthority | undefined {
		return this.db
			.select({ publicKey: deviceKeys.publicKey, identityId: deviceKeys.identityId, appId: identities.appId })
			.from(deviceKeys)
			.innerJoin(identities, eq(deviceKeys.identityId, identities.id))
			.where(eq(deviceKeys.publicKey, publicKey))
			.get();
	}

	listForIdentity(identityId: string): DeviceKey[] {
		return this.db.select().from(deviceKeys).where(eq(deviceKeys.identityId, identityId)).all();
	}

	touch(publicKey: string, at: Date): void {
		this.db.update(deviceKeys).set({ lastUsedAt: at }).where(eq(deviceKeys.publicKey, publicKey)).run();
	}

	/** Deletes the given keys that belong to the identity; returns how many were deleted. */
	deleteForIdentity(identityId: string, publicKeys: readonly string[]): number {
		if (publicKeys.length === 0) {
			return 0;
		}
		return this.db
			.delete(deviceKeys)
			.where(and(eq(deviceKeys.identityId, identityId), inArray(deviceKeys.publicKey, [...publicKeys])))
			.run().changes;
	}
}
