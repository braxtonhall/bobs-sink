import { Hono } from "hono";
import { z } from "zod";
import type { DocumentService } from "../../documents/DocumentService.js";
import type { DeviceAuthorizationService } from "../../identity/DeviceAuthorizationService.js";
import type { DeviceRevocationService } from "../../identity/DeviceRevocationService.js";
import type { RegistrationService } from "../../identity/RegistrationService.js";
import { rateRules } from "../../limits/rateRules.js";
import type { RateLimiter } from "../../limits/RateLimiter.js";
import type { HttpEnv } from "../HttpEnv.js";
import { rateLimitByIp } from "../middleware/rateLimitByIp.js";
import { readJson } from "../readJson.js";
import { authenticationResponseSchema, registrationResponseSchema } from "./webauthnSchemas.js";

export type IdentityRouteServices = {
	registration: RegistrationService;
	deviceAuthorization: DeviceAuthorizationService;
	deviceRevocation: DeviceRevocationService;
	documents: DocumentService;
	limiter: RateLimiter;
};

const registrationStartSchema = z.object({
	app: z.string(),
	deviceKey: z.string(),
	userName: z.string().min(1).max(64).optional(),
});
const signInStartSchema = z.object({ app: z.string(), deviceKey: z.string() });
const revocationStartSchema = z.object({ app: z.string(), deviceKeys: z.array(z.string()) });
const registrationFinishSchema = z.object({ response: registrationResponseSchema });
const assertionFinishSchema = z.object({ response: authenticationResponseSchema });

/**
 * Passkey ceremonies. Each is two requests: POST the collection to get WebAuthn options and a ceremony ID,
 * then POST the browser's response to the ceremony.
 */
export function identityRoutes(services: IdentityRouteServices) {
	const { registration, deviceAuthorization, deviceRevocation, documents, limiter } = services;
	const app = new Hono<HttpEnv>();
	app.use(rateLimitByIp(limiter, "ceremonies", rateRules.ceremoniesPerIp));

	app.post("/registrations", async (c) => {
		const { app: rpId, ...input } = await readJson(c, registrationStartSchema);
		return c.json(await registration.start({ rpId, origin: c.req.header("origin") }, input));
	});

	app.post("/registrations/:ceremonyId", async (c) => {
		const { response } = await readJson(c, registrationFinishSchema);
		return c.json(await registration.finish(c.req.param("ceremonyId"), response), 201);
	});

	app.post("/sign-ins", async (c) => {
		const { app: rpId, deviceKey } = await readJson(c, signInStartSchema);
		return c.json(await deviceAuthorization.start({ rpId, origin: c.req.header("origin") }, deviceKey));
	});

	app.post("/sign-ins/:ceremonyId", async (c) => {
		const { response } = await readJson(c, assertionFinishSchema);
		const { identityId } = await deviceAuthorization.finish(c.req.param("ceremonyId"), response);
		return c.json({ identityId, documents: documents.listOwned(identityId) });
	});

	app.post("/revocations", async (c) => {
		const { app: rpId, deviceKeys } = await readJson(c, revocationStartSchema);
		return c.json(await deviceRevocation.start({ rpId, origin: c.req.header("origin") }, deviceKeys));
	});

	app.post("/revocations/:ceremonyId", async (c) => {
		const { response } = await readJson(c, assertionFinishSchema);
		return c.json(await deviceRevocation.finish(c.req.param("ceremonyId"), response));
	});

	return app;
}
