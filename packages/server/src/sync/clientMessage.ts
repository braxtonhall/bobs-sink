import type { ClientMessage } from "@bobs-sink/protocol";
import { z } from "zod";

export const clientMessageSchema = z.object({
	type: z.literal("authenticate"),
	key: z.string(),
	signature: z.string(),
	epoch: z.number().int().nonnegative().nullable(),
}) satisfies z.ZodType<ClientMessage>;
