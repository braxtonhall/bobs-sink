import type { DeviceAuthority } from "../identity/DeviceKeyRepository.js";
import type { Operator } from "../operator/OperatorSessions.js";

/** Hono context variables set by middleware. */
export type HttpEnv = {
	Variables: {
		clientIp: string;
		/** Set by `requireDevice` on device-signed routes. */
		authority: DeviceAuthority;
		/** Set by `requireOperator` on the operator console's pages. */
		operator: Operator;
	};
};
