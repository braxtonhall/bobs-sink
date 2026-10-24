import * as Y from "yjs";
import type { RootType } from "@bobs-sink/protocol";

/**
 * Copies a document's content into a fresh Y.Doc with no history and a single client ID. Concurrent edits
 * from clients that haven't seen the copy can't merge into it; that's what epochs handle.
 */
export function rebuildDocument(source: Y.Doc, roots: Readonly<Record<string, RootType>>): Y.Doc {
	const target = new Y.Doc({ gc: true });
	target.transact(() => {
		for (const [name, type] of Object.entries(roots)) {
			copyRoot(source, target, name, type);
		}
	});
	return target;
}

function copyRoot(source: Y.Doc, target: Y.Doc, name: string, type: RootType): void {
	switch (type) {
		case "map": {
			const to = target.getMap(name);
			for (const [key, value] of source.getMap<unknown>(name).entries()) {
				to.set(key, cloneValue(value));
			}
			return;
		}
		case "array":
			target.getArray(name).push(source.getArray<unknown>(name).toArray().map(cloneValue));
			return;
		case "text": {
			// Yjs types deltas as `any`; they are arrays of insert operations.
			const delta = source.getText(name).toDelta() as unknown[];
			target.getText(name).applyDelta(delta);
			return;
		}
	}
}

function cloneValue(value: unknown): unknown {
	return value instanceof Y.AbstractType ? value.clone() : value;
}
