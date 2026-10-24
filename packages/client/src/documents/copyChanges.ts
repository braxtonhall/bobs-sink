import * as Y from "yjs";
import { cloneValue, replaceSequenceRoot, type Roots } from "./roots.js";
import type { ChangedLocations } from "./unsyncedChanges.js";

/**
 * Makes each changed location in `target` match `source`, in one transaction: map keys are overwritten with a
 * copy of the source value, or deleted if the source no longer has them; array and text roots are replaced.
 * Locations outside the declared roots are skipped.
 */
export function copyChanges(source: Y.Doc, target: Y.Doc, changed: ChangedLocations, roots: Roots): void {
	target.transact(() => {
		for (const [name, keys] of changed) {
			const type = roots[name];
			if (type === undefined) {
				continue;
			}
			if (type !== "map") {
				replaceSequenceRoot(source, target, name, type);
				continue;
			}
			const from = source.getMap<unknown>(name);
			const to = target.getMap<unknown>(name);
			for (const key of keys === "whole" ? new Set([...from.keys(), ...to.keys()]) : keys) {
				if (from.has(key)) {
					to.set(key, cloneValue(from.get(key)));
				} else {
					to.delete(key);
				}
			}
		}
	});
}
