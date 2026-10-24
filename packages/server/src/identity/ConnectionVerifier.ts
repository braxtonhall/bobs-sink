import type { Clock } from "../shared/clock.js";
import { SinkError } from "../shared/errors.js";
import type { DeviceAuthority, DeviceKeyRepository } from "./DeviceKeyRepository.js";
import { verifyEd25519 } from "./ed25519.js";
import { connectionSigningMessage } from "@bobs-sink/protocol";

/** Authenticates a sync connection: the device signs the server's one-time challenge for that connection. */
export class ConnectionVerifier {
	constructor(
		private readonly deviceKeys: DeviceKeyRepository,
		private readonly clock: Clock,
	) {}

	verify(input: { documentId: string; challenge: string; key: string; signature: string }): DeviceAuthority {
		const message = connectionSigningMessage({ documentId: input.documentId, challenge: input.challenge });
		if (!verifyEd25519(input.key, message, input.signature)) {
			throw new SinkError("unauthorized", "invalid connection signature");
		}
		const authority = this.deviceKeys.findAuthority(input.key);
		if (authority === undefined) {
			throw new SinkError("unauthorized", "device key not authorized");
		}
		this.deviceKeys.touch(input.key, this.clock.now());
		return authority;
	}
}
