import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { copyChanges } from "../../src/documents/copyChanges.js";
import { unsyncedChanges, type ChangedLocations } from "../../src/documents/unsyncedChanges.js";

const roots = { items: "map", notes: "text" } as const;

/** A client doc and the server's snapshot of what it had synced. */
function syncedClient(setup: (doc: Y.Doc) => void): { client: Y.Doc; server: Y.Snapshot } {
	const client = new Y.Doc();
	setup(client);
	const server = new Y.Doc();
	Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
	return { client, server: Y.snapshot(server) };
}

function locations(changed: ChangedLocations): Record<string, string[] | "whole"> {
	return Object.fromEntries([...changed].map(([root, keys]) => [root, keys === "whole" ? keys : [...keys].sort()]));
}

describe("unsyncedChanges", () => {
	it("finds nothing when the server has everything", () => {
		const { client, server } = syncedClient((doc) => {
			doc.getMap("items").set("a", 1);
			doc.getMap("items").delete("a");
			doc.getMap("items").set("b", 2);
		});

		expect(unsyncedChanges(client, server).size).toBe(0);
	});

	it("finds new keys, overwritten keys, and deletions the server hasn't seen", () => {
		const { client, server } = syncedClient((doc) => {
			const items = doc.getMap("items");
			items.set("kept", 1);
			items.set("overwritten", 1);
			items.set("deleted", 1);
			items.set("deletedLongAgo", 1);
			items.delete("deletedLongAgo");
		});
		const items = client.getMap("items");
		items.set("added", 2);
		items.set("overwritten", 2);
		items.delete("deleted");

		expect(locations(unsyncedChanges(client, server))).toEqual({ items: ["added", "deleted", "overwritten"] });
	});

	it("attributes nested edits to their top-level key", () => {
		const { client, server } = syncedClient((doc) => {
			const entry = new Y.Map<unknown>();
			entry.set("note", new Y.Text("hi"));
			doc.getMap("items").set("x", entry);
			doc.getMap("items").set("y", 1);
		});
		((client.getMap("items").get("x") as Y.Map<unknown>).get("note") as Y.Text).insert(2, "!");

		expect(locations(unsyncedChanges(client, server))).toEqual({ items: ["x"] });
	});

	it("treats edits to a text root as touching the whole root", () => {
		const { client, server } = syncedClient((doc) => {
			doc.getText("notes").insert(0, "abc");
		});
		client.getText("notes").delete(0, 1);

		expect(locations(unsyncedChanges(client, server))).toEqual({ notes: "whole" });
	});
});

describe("copyChanges", () => {
	it("overwrites and deletes only the changed keys", () => {
		const source = new Y.Doc();
		source.getMap("items").set("changed", "source");
		source.getMap("items").set("untouched", "source");
		const target = new Y.Doc();
		const items = target.getMap("items");
		items.set("changed", "target");
		items.set("untouched", "target");
		items.set("deleted", "target");

		copyChanges(source, target, new Map([["items", new Set(["changed", "deleted"])]]), roots);

		expect(items.toJSON()).toEqual({ changed: "source", untouched: "target" });
	});

	it("replaces whole text roots and skips undeclared roots", () => {
		const source = new Y.Doc();
		source.getText("notes").insert(0, "source");
		source.getMap("other").set("a", 1);
		const target = new Y.Doc();
		target.getText("notes").insert(0, "target");

		copyChanges(
			source,
			target,
			new Map<string, Set<string> | "whole">([
				["notes", "whole"],
				["other", new Set(["a"])],
			]),
			roots,
		);

		expect(target.getText("notes").toJSON()).toBe("source");
		expect(target.share.has("other")).toBe(false);
	});
});
