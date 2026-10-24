import type { Executor } from "../db/connection.js";
import { apps } from "../db/schema/index.js";

export class AppRepository {
	constructor(private readonly db: Executor) {}

	/** Records the app if this is the first time the service has seen it. */
	ensure(rpId: string, now: Date): void {
		this.db.insert(apps).values({ id: rpId, createdAt: now }).onConflictDoNothing().run();
	}
}
