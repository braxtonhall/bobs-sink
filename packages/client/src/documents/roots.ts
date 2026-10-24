import type { RootType } from "@bobs-sink/protocol";
import * as Y from "yjs";

/** A document's top-level shared types and their kinds; must match the app's schema on the server. */
export type Roots = Readonly<Record<string, RootType>>;

export type SequenceRootType = Exclude<RootType, "map">;

export function getSequenceRoot(doc: Y.Doc, name: string, type: SequenceRootType): Y.Array<unknown> | Y.Text {
	return type === "array" ? doc.getArray<unknown>(name) : doc.getText(name);
}

/** A copy of a value that can be inserted into another doc. Shared types are deep-cloned; plain values are immutable. */
export function cloneValue(value: unknown): unknown {
	return value instanceof Y.AbstractType ? value.clone() : value;
}

export function toJson(value: unknown): unknown {
	return value instanceof Y.AbstractType ? value.toJSON() : value;
}

/** Makes `target`'s root `name` hold a copy of `source`'s, for array and text roots. */
export function replaceSequenceRoot(source: Y.Doc, target: Y.Doc, name: string, type: SequenceRootType): void {
	if (type === "array") {
		const to = target.getArray<unknown>(name);
		to.delete(0, to.length);
		to.push(source.getArray<unknown>(name).toArray().map(cloneValue));
	} else {
		const to = target.getText(name);
		to.delete(0, to.length);
		// Yjs types deltas as `any`; they are arrays of insert operations.
		to.applyDelta(source.getText(name).toDelta() as unknown[]);
	}
}
