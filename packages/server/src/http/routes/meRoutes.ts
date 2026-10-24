import { Hono, type MiddlewareHandler } from "hono";
import type { DeviceKeyRepository } from "../../identity/DeviceKeyRepository.js";
import type { DeviceRevocationService } from "../../identity/DeviceRevocationService.js";
import type { HttpEnv } from "../HttpEnv.js";

/** The signing device's own identity. Device-signed. */
export function meRoutes(
	services: { deviceKeys: DeviceKeyRepository; deviceRevocation: DeviceRevocationService },
	requireDevice: MiddlewareHandler<HttpEnv>,
) {
	const app = new Hono<HttpEnv>();
	app.use(requireDevice);

	// Also a cheap way for a client to check that its device key is still authorized.
	app.get("/", (c) => {
		const authority = c.get("authority");
		return c.json({
			identityId: authority.identityId,
			app: authority.appId,
			deviceKey: authority.publicKey,
			deviceKeys: services.deviceKeys.listForIdentity(authority.identityId).map((key) => ({
				publicKey: key.publicKey,
				createdAt: key.createdAt,
				lastUsedAt: key.lastUsedAt,
			})),
		});
	});

	app.delete("/device-key", (c) => {
		services.deviceRevocation.signOut(c.get("authority"));
		return c.body(null, 204);
	});

	return app;
}
