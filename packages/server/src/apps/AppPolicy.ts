import { rootTypes } from "@bobs-sink/protocol";
import { z } from "zod";

export const documentSchemaSchema = z.object({
	/** Top-level shared types and their kinds. Updates that create any other root are rejected. */
	roots: z.record(z.string().min(1), z.enum(rootTypes)),
	/** JSON Schema applied to the roots' JSON (`{ [root]: root.toJSON() }`). */
	jsonSchema: z.record(z.string(), z.unknown()).optional(),
});
export type DocumentSchema = z.infer<typeof documentSchemaSchema>;

export const appPolicySchema = z.object({
	/** Largest allowed encoded size of one document. */
	maxDocumentBytes: z.number().int().positive(),
	/** Most documents one identity may own in the app. */
	maxDocumentsPerIdentity: z.number().int().positive(),
	/** Total snapshot bytes across the app's documents. */
	maxStorageBytes: z.number().int().positive(),
	identitiesPerHour: z.number().int().positive(),
	documentsPerHour: z.number().int().positive(),
	schema: documentSchemaSchema.optional(),
});
export type AppPolicy = z.infer<typeof appPolicySchema>;

/** What an operator sets for a registered app; anything left out falls back to the registered defaults. */
export const appPolicyOverridesSchema = appPolicySchema.partial();
export type AppPolicyOverrides = z.infer<typeof appPolicyOverridesSchema>;

export const defaultRegisteredPolicy: AppPolicy = {
	maxDocumentBytes: 2 * 1024 * 1024,
	maxDocumentsPerIdentity: 10,
	maxStorageBytes: 1024 * 1024 * 1024,
	identitiesPerHour: 600,
	documentsPerHour: 1200,
};

/** Apps nobody registered get much tighter limits, since anyone can claim any RP ID. */
export const defaultImplicitPolicy: AppPolicy = {
	maxDocumentBytes: 256 * 1024,
	maxDocumentsPerIdentity: 3,
	maxStorageBytes: 64 * 1024 * 1024,
	identitiesPerHour: 60,
	documentsPerHour: 120,
};
