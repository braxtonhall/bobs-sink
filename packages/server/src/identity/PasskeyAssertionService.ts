import {
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type AuthenticationResponseJSON,
	type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import type { Database } from "../db/connection.js";
import type { Clock } from "../shared/clock.js";
import { SinkError } from "../shared/errors.js";
import { IdentityRepository, type Identity } from "./IdentityRepository.js";
import type { Ceremony, CeremonyContext, CeremonyPurpose, PasskeyCeremonies } from "./PasskeyCeremonies.js";
import { PasskeyRepository } from "./PasskeyRepository.js";
import { identityIdFromUserHandle } from "./userHandle.js";

type AssertionPurpose = Exclude<CeremonyPurpose, { kind: "register" }>;

export type AssertionStart = {
	ceremonyId: string;
	options: PublicKeyCredentialRequestOptionsJSON;
};

export type VerifiedAssertion<P extends AssertionPurpose> = {
	identity: Identity;
	ceremony: Ceremony<P>;
};

/** Runs passkey assertions (sign-ins) for actions an existing identity approves. */
export class PasskeyAssertionService {
	constructor(
		private readonly db: Database,
		private readonly ceremonies: PasskeyCeremonies,
		private readonly clock: Clock,
	) {}

	async start(context: CeremonyContext, purpose: AssertionPurpose): Promise<AssertionStart> {
		const origin = this.ceremonies.checkContext(context);
		const options = await generateAuthenticationOptions({ rpID: context.rpId, userVerification: "preferred" });
		const ceremonyId = this.ceremonies.store({ rpId: context.rpId, origin, challenge: options.challenge, purpose });
		return { ceremonyId, options };
	}

	/**
	 * Verifies an assertion. The passkey is found by credential ID and checked against its stored public key;
	 * the returned user handle must then match the identity that passkey belongs to. The user handle is never
	 * used to choose the identity.
	 */
	async verify<K extends AssertionPurpose["kind"]>(
		ceremonyId: string,
		kind: K,
		response: AuthenticationResponseJSON,
	): Promise<VerifiedAssertion<Extract<AssertionPurpose, { kind: K }>>> {
		const ceremony = this.ceremonies.take(ceremonyId, kind);
		const passkeys = new PasskeyRepository(this.db);
		const passkey = passkeys.find(response.id);
		const identity = passkey && new IdentityRepository(this.db).find(passkey.identityId);
		if (passkey === undefined || identity?.appId !== ceremony.rpId) {
			throw new SinkError("unauthorized", "unknown passkey");
		}
		const verification = await verifyAuthenticationResponse({
			response,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: ceremony.origin,
			expectedRPID: ceremony.rpId,
			credential: {
				id: passkey.id,
				publicKey: new Uint8Array(passkey.publicKey),
				counter: passkey.counter,
				...(passkey.transports === null ? {} : { transports: passkey.transports }),
			},
			requireUserVerification: false,
		}).catch(() => undefined);
		if (verification?.verified !== true) {
			throw new SinkError("unauthorized", "passkey assertion failed");
		}
		const userHandle = response.response.userHandle;
		if (userHandle === undefined || identityIdFromUserHandle(userHandle) !== identity.id) {
			throw new SinkError("unauthorized", "passkey does not belong to identity");
		}
		passkeys.recordUse(passkey.id, {
			counter: verification.authenticationInfo.newCounter,
			backedUp: verification.authenticationInfo.credentialBackedUp,
			at: this.clock.now(),
		});
		return { identity, ceremony };
	}
}
