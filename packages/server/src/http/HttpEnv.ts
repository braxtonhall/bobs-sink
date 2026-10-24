import type { DeviceAuthority } from "../identity/DeviceKeyRepository.js";

/** Hono context variables set by middleware. */
export type HttpEnv = {
	Variables: {
		clientIp: string;
		/** Set by `requireDevice` on device-signed routes. */
		authority: DeviceAuthority;
	};
};
