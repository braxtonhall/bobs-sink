import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { mergeDocuments } from "../../src/documents/mergeDocuments.js";

const roots = { items: "map", notes: "text" } as const;

function docWith(entries: Record<string, unknown>, notes = ""): Y.Doc {
	const doc = new Y.Doc();
	const items = doc.getMap("items");
	for (const [key, value] of Object.entries(entries)) {
		items.set(key, value);
	}
	doc.getText("notes").insert(0, notes);
	return doc;
}

describe("mergeDocuments", () => {
	it("unions map keys and keeps the remote value for keys both have", () => {
		const local = docWith({ a: 1, shared: "local" });
		const remote = docWith({ b: 2, shared: "remote" });

		mergeDocuments(local, remote, roots);

		expect(remote.getMap("items").toJSON()).toEqual({ a: 1, b: 2, shared: "remote" });
	});

	it("lets the resolver pick local values, given both sides as JSON", () => {
		const local = docWith({ shared: { at: 2 } });
		const remote = docWith({ shared: { at: 1 } });
		const conflicts: unknown[] = [];

		mergeDocuments(local, remote, roots, (conflict) => {
			conflicts.push(conflict);
			return "local";
		});

		expect(conflicts).toEqual([{ root: "items", key: "shared", local: { at: 2 }, remote: { at: 1 } }]);
		expect(remote.getMap("items").get("shared")).toEqual({ at: 2 });
	});

	it("copies nested shared types as independent shared types", () => {
		const local = new Y.Doc();
		const entry = new Y.Map<unknown>();
		entry.set("note", new Y.Text("hello"));
		local.getMap("items").set("x", entry);
		const remote = new Y.Doc();

		mergeDocuments(local, remote, roots);
		const copied = (remote.getMap("items").get("x") as Y.Map<unknown>).get("note");
		(entry.get("note") as Y.Text).insert(5, " world");

		expect(copied).toBeInstanceOf(Y.Text);
		expect((copied as Y.Text).toJSON()).toBe("hello");
	});

	it("copies a text root only into an empty one unless the resolver picks local", () => {
		const remote = docWith({});
		mergeDocuments(docWith({}, "local notes"), remote, roots);
		expect(remote.getText("notes").toJSON()).toBe("local notes");

		const kept = docWith({}, "remote notes");
		mergeDocuments(docWith({}, "local notes"), kept, roots);
		expect(kept.getText("notes").toJSON()).toBe("remote notes");

		const replaced = docWith({}, "remote notes");
		mergeDocuments(docWith({}, "local notes"), replaced, roots, () => "local");
		expect(replaced.getText("notes").toJSON()).toBe("local notes");
	});

	it("writes everything in one transaction", () => {
		const remote = new Y.Doc();
		let updates = 0;
		remote.on("update", () => updates++);

		mergeDocuments(docWith({ a: 1, b: 2 }, "notes"), remote, roots);

		expect(updates).toBe(1);
	});
});
