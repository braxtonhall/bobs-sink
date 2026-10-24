import type { RejectionReason as SyncRejectionReason } from "@bobs-sink/protocol";
import * as Y from "yjs";
import type { DocumentRules } from "./DocumentRules.js";
import { rootShapeMatches } from "./rootShape.js";
import { getRoot } from "./rootTypes.js";

export type RejectionReason = Exclude<SyncRejectionReason, "read_only">;

export type UpdateValidation =
	| {
			accepted: true;
			/** Whether the update added anything the document didn't already have. */
			changed: boolean;
			/** The document with the update applied. */
			result: Y.Doc;
	  }
	| { accepted: false; reason: RejectionReason };

/**
 * Applies `update` to a scratch copy of `current` and checks the result against the rules. `current` is never
 * modified. Updates are accepted or rejected whole, since Yjs updates can't be partially applied.
 */
export function validateUpdate(current: Y.Doc, update: Uint8Array, rules: DocumentRules): UpdateValidation {
	const scratch = new Y.Doc({ gc: true });
	Y.applyUpdate(scratch, Y.encodeStateAsUpdate(current));
	try {
		Y.applyUpdate(scratch, update);
	} catch {
		return reject(scratch, "malformed");
	}
	// An update whose dependencies we don't have would be held back and applied later by some other update,
	// skipping these checks. Clients resend from their state vector, so it will arrive again in order.
	if (scratch.store.pendingStructs !== null || scratch.store.pendingDs !== null) {
		return reject(scratch, "missing_dependencies");
	}
	if (Y.equalSnapshots(Y.snapshot(current), Y.snapshot(scratch))) {
		scratch.destroy();
		return { accepted: true, changed: false, result: current };
	}
	if (Y.encodeStateAsUpdate(scratch).byteLength > rules.maxBytes) {
		return reject(scratch, "too_large");
	}
	if (rules.roots !== undefined) {
		const reason = checkSchema(scratch, rules.roots, rules.validateJson);
		if (reason !== undefined) {
			return reject(scratch, reason);
		}
	}
	return { accepted: true, changed: true, result: scratch };
}

function checkSchema(
	doc: Y.Doc,
	roots: NonNullable<DocumentRules["roots"]>,
	validateJson: DocumentRules["validateJson"],
): RejectionReason | undefined {
	for (const name of doc.share.keys()) {
		if (!Object.hasOwn(roots, name)) {
			return "unknown_root";
		}
	}
	const json: Record<string, unknown> = {};
	for (const [name, type] of Object.entries(roots)) {
		const stored = doc.share.get(name);
		if (stored !== undefined && !rootShapeMatches(stored, type)) {
			return "schema_violation";
		}
		json[name] = getRoot(doc, name, type).toJSON();
	}
	if (validateJson !== undefined && !validateJson(json)) {
		return "schema_violation";
	}
	return undefined;
}

function reject(scratch: Y.Doc, reason: RejectionReason): UpdateValidation {
	scratch.destroy();
	return { accepted: false, reason };
}
