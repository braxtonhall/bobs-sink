import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Database } from "../db/connection.js";
import { operatorSessions } from "../db/schema/index.js";
import type { Clock } from "../shared/clock.js";
import { randomId } from "../shared/randomId.js";
import { toBase64Url } from "../shared/base64url.js";

export const operatorSessionMs = 12 * 60 * 60 * 1000;

export type Operator = { email: string; subject: string };

/** Console sign-ins. The token goes in the operator's cookie; the database holds only its hash. */
export class OperatorSessions {
	constructor(
		private readonly db: Database,
		private readonly clock: Clock,
	) {}

	/** Starts a session and returns its token. */
	create(operator: Operator): string {
		const token = randomId();
		const now = this.clock.now();
		this.db
			.insert(operatorSessions)
			.values({
				tokenHash: hashToken(token),
				email: operator.email,
				subject: operator.subject,
				createdAt: now,
				expiresAt: new Date(now.getTime() + operatorSessionMs),
			})
			.run();
		return token;
	}

	/** The session's operator, if the token belongs to an unexpired session. */
	find(token: string): Operator | undefined {
		const row = this.db
			.select()
			.from(operatorSessions)
			.where(eq(operatorSessions.tokenHash, hashToken(token)))
			.get();
		if (row === undefined || row.expiresAt <= this.clock.now()) {
			return undefined;
		}
		return { email: row.email, subject: row.subject };
	}

	delete(token: string): void {
		this.db
			.delete(operatorSessions)
			.where(eq(operatorSessions.tokenHash, hashToken(token)))
			.run();
	}

	/** Removes expired sessions; returns how many. */
	deleteExpired(): number {
		return this.db.delete(operatorSessions).where(lt(operatorSessions.expiresAt, this.clock.now())).run().changes;
	}
}

function hashToken(token: string): string {
	return toBase64Url(createHash("sha256").update(token).digest());
}
