import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";

// Only the shape is checked here; @simplewebauthn/server verifies the contents.
const credentialBase = {
	id: z.string().min(1),
	rawId: z.string().min(1),
	type: z.literal("public-key"),
	clientExtensionResults: z.looseObject({}).default({}),
	authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
};

export const registrationResponseSchema = z.looseObject({
	...credentialBase,
	response: z.looseObject({ clientDataJSON: z.string(), attestationObject: z.string() }),
}) as unknown as z.ZodType<RegistrationResponseJSON>;

export const authenticationResponseSchema = z.looseObject({
	...credentialBase,
	response: z.looseObject({
		clientDataJSON: z.string(),
		authenticatorData: z.string(),
		signature: z.string(),
		userHandle: z.string().optional(),
	}),
}) as unknown as z.ZodType<AuthenticationResponseJSON>;
