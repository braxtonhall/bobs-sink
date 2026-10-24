import * as Y from "yjs";
import { cloneValue, getSequenceRoot, replaceSequenceRoot, toJson, type Roots } from "./roots.js";

/**
 * Something both documents have. For map roots `key` is the entry; for array and text roots it is undefined and
 * the conflict is the whole root. Values are JSON.
 */
export type MergeConflict = { root: string; key: string | undefined; local: unknown; remote: unknown };

export type ConflictResolver = (conflict: MergeConflict) => "local" | "remote";

export const keepRemote: ConflictResolver = () => "remote";

/**
 * Copies `local` into `remote` as new edits, in one transaction. The two docs have unrelated histories, so this
 * is an app-level copy rather than a CRDT merge: map roots are unioned by key, and `resolve` picks a side for
 * keys both have. Array and text roots are copied only if the remote one is empty, unless `resolve` picks local.
 */
export function mergeDocuments(
	local: Y.Doc,
	remote: Y.Doc,
	roots: Roots,
	resolve: ConflictResolver = keepRemote,
): void {
	remote.transact(() => {
		for (const [name, type] of Object.entries(roots)) {
			if (type === "map") {
				mergeMap(local.getMap<unknown>(name), remote.getMap<unknown>(name), name, resolve);
				continue;
			}
			const from = getSequenceRoot(local, name, type);
			const to = getSequenceRoot(remote, name, type);
			if (from.length === 0) {
				continue;
			}
			if (
				to.length === 0 ||
				resolve({ root: name, key: undefined, local: from.toJSON(), remote: to.toJSON() }) === "local"
			) {
				replaceSequenceRoot(local, remote, name, type);
			}
		}
	});
}

function mergeMap(from: Y.Map<unknown>, to: Y.Map<unknown>, root: string, resolve: ConflictResolver): void {
	for (const [key, value] of from.entries()) {
		if (!to.has(key) || resolve({ root, key, local: toJson(value), remote: toJson(to.get(key)) }) === "local") {
			to.set(key, cloneValue(value));
		}
	}
}
