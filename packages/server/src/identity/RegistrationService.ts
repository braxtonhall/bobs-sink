import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	type PublicKeyCredentialCreationOptionsJSON,
	type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AppPolicies } from "../apps/AppPolicies.js";
import { AppRepository } from "../apps/AppRepository.js";
import type { Database } from "../db/connection.js";
import { perHour } from "../limits/rateRules.js";
import type { RateLimiter } from "../limits/RateLimiter.js";
import type { Clock } from "../shared/clock.js";
import { SinkError } from "../shared/errors.js";
import { randomId } from "../shared/randomId.js";
import { DeviceKeyRepository } from "./DeviceKeyRepository.js";
import { isEd25519PublicKey } from "./ed25519.js";
import { IdentityRepository } from "./IdentityRepository.js";
import type { CeremonyContext, PasskeyCeremonies } from "./PasskeyCeremonies.js";
import { PasskeyRepository } from "./PasskeyRepository.js";
import { userHandleFor } from "./userHandle.js";

export type RegistrationStart = {
	ceremonyId: string;
	options: PublicKeyCredentialCreationOptionsJSON;
};

/** Creates identities: registers a passkey and authorizes the device key that started it. */
export class RegistrationService {
	constructor(
		private readonly db: Database,
		private readonly ceremonies: PasskeyCeremonies,
		private readonly policies: AppPolicies,
		private readonly limiter: RateLimiter,
		private readonly clock: Clock,
	) {}

	async start(context: CeremonyContext, input: { deviceKey: string; userName?: string }): Promise<RegistrationStart> {
		const origin = this.ceremonies.checkContext(context);
		if (!isEd25519PublicKey(input.deviceKey)) {
			throw new SinkError("bad_request", "invalid device key");
		}
		if (new DeviceKeyRepository(this.db).find(input.deviceKey) !== undefined) {
			throw new SinkError("conflict", "device key already registered");
		}
		const identityId = randomId();
		const options = await generateRegistrationOptions({
			rpName: context.rpId,
			rpID: context.rpId,
			userName: input.userName ?? context.rpId,
			userID: userHandleFor(identityId),
			attestationType: "none",
			authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
		});
		const ceremonyId = this.ceremonies.store({
			rpId: context.rpId,
			origin,
			challenge: options.challenge,
			purpose: { kind: "register", identityId, deviceKey: input.deviceKey },
		});
		return { ceremonyId, options };
	}

	async finish(ceremonyId: string, response: RegistrationResponseJSON): Promise<{ identityId: string }> {
		const ceremony = this.ceremonies.take(ceremonyId, "register");
		const verification = await verifyRegistrationResponse({
			response,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: ceremony.origin,
			expectedRPID: ceremony.rpId,
			requireUserVerification: false,
		}).catch(() => ({ verified: false as const }));
		if (!verification.verified) {
			throw new SinkError("unauthorized", "passkey registration failed");
		}
		const policy = this.policies.get(ceremony.rpId);
		if (!this.limiter.tryTake(`identities:${ceremony.rpId}`, perHour(policy.identitiesPerHour))) {
			throw new SinkError("rate_limited", "too many new identities for this app");
		}

		const { credential, credentialBackedUp } = verification.registrationInfo;
		const { identityId, deviceKey } = ceremony.purpose;
		const now = this.clock.now();
		this.db.transaction((tx) => {
			const passkeys = new PasskeyRepository(tx);
			const deviceKeys = new DeviceKeyRepository(tx);
			if (passkeys.find(credential.id) !== undefined) {
				throw new SinkError("conflict", "passkey already registered");
			}
			if (deviceKeys.find(deviceKey) !== undefined) {
				throw new SinkError("conflict", "device key already registered");
			}
			new AppRepository(tx).ensure(ceremony.rpId, now);
			new IdentityRepository(tx).create({ id: identityId, appId: ceremony.rpId, createdAt: now });
			passkeys.create({
				id: credential.id,
				identityId,
				publicKey: Buffer.from(credential.publicKey),
				counter: credential.counter,
				transports: credential.transports ?? null,
				backedUp: credentialBackedUp,
				createdAt: now,
				lastUsedAt: now,
			});
			deviceKeys.create({ publicKey: deviceKey, identityId, createdAt: now, lastUsedAt: now });
		});
		return { identityId };
	}
}
