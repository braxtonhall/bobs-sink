import { isValidRpId, originMatchesRpId } from "../apps/rpId.js";
import type { Clock } from "../shared/clock.js";
import { ExpiringMap } from "../shared/ExpiringMap.js";
import { SinkError } from "../shared/errors.js";
import { randomId } from "../shared/randomId.js";

const ceremonyTtlMs = 5 * 60_000;

/** What a passkey ceremony will do once it succeeds. Bound at the start so the passkey approves exactly this. */
export type CeremonyPurpose =
	| { kind: "register"; identityId: string; deviceKey: string }
	| { kind: "authorize-device"; deviceKey: string }
	| { kind: "revoke-devices"; deviceKeys: string[] };

export type Ceremony<P extends CeremonyPurpose = CeremonyPurpose> = {
	rpId: string;
	origin: string;
	challenge: string;
	purpose: P;
};

export type CeremonyContext = {
	rpId: string;
	/** The browser origin that started the ceremony, from the Origin header. */
	origin: string | undefined;
};

/** Single-use, short-lived state for WebAuthn ceremonies between their options and verify steps. */
export class PasskeyCeremonies {
	private readonly pending: ExpiringMap<string, Ceremony>;

	constructor(
		private readonly allowLocalhost: boolean,
		clock: Clock,
	) {
		this.pending = new ExpiringMap(ceremonyTtlMs, clock);
	}

	/** Checks that the origin may act for the RP ID and returns the origin. */
	checkContext(context: CeremonyContext): string {
		if (!isValidRpId(context.rpId)) {
			throw new SinkError("bad_request", "invalid app");
		}
		if (context.origin === undefined || !originMatchesRpId(context.origin, context.rpId, this.allowLocalhost)) {
			throw new SinkError("forbidden", "origin does not belong to app");
		}
		return context.origin;
	}

	store(ceremony: Ceremony): string {
		const ceremonyId = randomId();
		this.pending.set(ceremonyId, ceremony);
		return ceremonyId;
	}

	take<K extends CeremonyPurpose["kind"]>(
		ceremonyId: string,
		kind: K,
	): Ceremony<Extract<CeremonyPurpose, { kind: K }>> {
		const ceremony = this.pending.take(ceremonyId);
		if (ceremony?.purpose.kind !== kind) {
			throw new SinkError("unauthorized", "unknown or expired ceremony");
		}
		return ceremony as Ceremony<Extract<CeremonyPurpose, { kind: K }>>;
	}
}
