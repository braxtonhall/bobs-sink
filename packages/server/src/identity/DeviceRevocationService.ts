import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Database } from "../db/connection.js";
import { SinkError } from "../shared/errors.js";
import { DeviceKeyRepository, type DeviceAuthority } from "./DeviceKeyRepository.js";
import type { AssertionStart, PasskeyAssertionService } from "./PasskeyAssertionService.js";
import type { CeremonyContext } from "./PasskeyCeremonies.js";

const maxKeysPerRevocation = 100;

/** Removing device keys: any of an identity's keys with a passkey (e.g. after losing a device), or a device's own. */
export class DeviceRevocationService {
	constructor(
		private readonly db: Database,
		private readonly assertions: PasskeyAssertionService,
		/** Called with keys that were just revoked, so their open connections can be closed. */
		private readonly onRevoked: (deviceKeys: readonly string[]) => void,
	) {}

	start(context: CeremonyContext, deviceKeys: string[]): Promise<AssertionStart> {
		if (deviceKeys.length === 0 || deviceKeys.length > maxKeysPerRevocation) {
			throw new SinkError("bad_request", `revoke between 1 and ${maxKeysPerRevocation} device keys`);
		}
		return this.assertions.start(context, { kind: "revoke-devices", deviceKeys: [...new Set(deviceKeys)] });
	}

	async finish(ceremonyId: string, response: AuthenticationResponseJSON): Promise<{ revoked: number }> {
		const { identity, ceremony } = await this.assertions.verify(ceremonyId, "revoke-devices", response);
		const { deviceKeys } = ceremony.purpose;
		const revoked = new DeviceKeyRepository(this.db).deleteForIdentity(identity.id, deviceKeys);
		this.onRevoked(deviceKeys);
		return { revoked };
	}

	/** A device revoking its own key, e.g. when the user turns cloud saves off. */
	signOut(authority: DeviceAuthority): void {
		new DeviceKeyRepository(this.db).deleteForIdentity(authority.identityId, [authority.publicKey]);
		this.onRevoked([authority.publicKey]);
	}
}
