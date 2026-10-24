import * as Y from "yjs";

/** Top-level locations a set of changes touched: map keys per map root, or the whole root for arrays and text. */
export type ChangedLocations = Map<string, Set<string> | "whole">;

/**
 * Where `doc` has changes the server didn't have at `server` (a snapshot of the server's state): items it
 * created after the server's state vector, and items the server had that it deleted since. Each change is
 * attributed to the top-level key (or root) that contains it.
 */
export function unsyncedChanges(doc: Y.Doc, server: Y.Snapshot): ChangedLocations {
	const changed: ChangedLocations = new Map();
	for (const [client, structs] of doc.store.clients) {
		const known = server.sv.get(client) ?? 0;
		for (const struct of structs) {
			if (!(struct instanceof Y.Item)) {
				continue;
			}
			const created = struct.id.clock + struct.length > known;
			if (created || (struct.deleted && !serverDeleted(server, struct))) {
				record(changed, struct);
			}
		}
	}
	return changed;
}

function serverDeleted(server: Y.Snapshot, item: Y.Item): boolean {
	const last = Y.createID(item.id.client, item.id.clock + item.length - 1);
	return Y.isDeleted(server.ds, item.id) && Y.isDeleted(server.ds, last);
}

function record(changed: ChangedLocations, item: Y.Item): void {
	let current = item;
	for (;;) {
		const parent = current.parent;
		if (!(parent instanceof Y.AbstractType)) {
			return;
		}
		if (parent._item === null) {
			addLocation(changed, Y.findRootTypeKey(parent), current.parentSub);
			return;
		}
		current = parent._item;
	}
}

function addLocation(changed: ChangedLocations, root: string, key: string | null): void {
	const existing = changed.get(root);
	if (key === null || existing === "whole") {
		changed.set(root, "whole");
	} else if (existing === undefined) {
		changed.set(root, new Set([key]));
	} else {
		existing.add(key);
	}
}
