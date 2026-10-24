import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Database } from "../db/connection.js";
import type { Clock } from "../shared/clock.js";
import { SinkError } from "../shared/errors.js";
import { DeviceKeyRepository } from "./DeviceKeyRepository.js";
import { isEd25519PublicKey } from "./ed25519.js";
import type { AssertionStart, PasskeyAssertionService } from "./PasskeyAssertionService.js";
import type { CeremonyContext } from "./PasskeyCeremonies.js";

/** Signing in on a device: a passkey assertion authorizes a new device key for an existing identity. */
export class DeviceAuthorizationService {
	constructor(
		private readonly db: Database,
		private readonly assertions: PasskeyAssertionService,
		private readonly clock: Clock,
	) {}

	start(context: CeremonyContext, deviceKey: string): Promise<AssertionStart> {
		if (!isEd25519PublicKey(deviceKey)) {
			throw new SinkError("bad_request", "invalid device key");
		}
		return this.assertions.start(context, { kind: "authorize-device", deviceKey });
	}

	async finish(ceremonyId: string, response: AuthenticationResponseJSON): Promise<{ identityId: string }> {
		const { identity, ceremony } = await this.assertions.verify(ceremonyId, "authorize-device", response);
		const { deviceKey } = ceremony.purpose;
		const deviceKeys = new DeviceKeyRepository(this.db);
		const existing = deviceKeys.find(deviceKey);
		if (existing !== undefined && existing.identityId !== identity.id) {
			throw new SinkError("conflict", "device key belongs to another identity");
		}
		if (existing === undefined) {
			const now = this.clock.now();
			deviceKeys.create({ publicKey: deviceKey, identityId: identity.id, createdAt: now, lastUsedAt: now });
		}
		return { identityId: identity.id };
	}
}
