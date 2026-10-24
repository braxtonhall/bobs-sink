import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { rebuildDocument } from "../../src/documents/rebuildDocument.js";

describe("rebuildDocument", () => {
	it("copies content, keeping nested shared types, with no history", () => {
		const source = new Y.Doc();
		const entry = new Y.Map<unknown>();
		const note = new Y.Text("hello");
		entry.set("note", note);
		entry.set("at", 3);
		source.getMap("items").set("a", entry);
		source.getMap("items").set("gone", 1);
		source.getMap("items").delete("gone");
		source.getArray("log").push(["x", "y"]);
		source.getText("title").insert(0, "My doc");

		const rebuilt = rebuildDocument(source, { items: "map", log: "array", title: "text" });

		expect(rebuilt.getMap("items").toJSON()).toEqual({ a: { note: "hello", at: 3 } });
		expect((rebuilt.getMap("items").get("a") as Y.Map<unknown>).get("note")).toBeInstanceOf(Y.Text);
		expect(rebuilt.getArray("log").toJSON()).toEqual(["x", "y"]);
		expect(rebuilt.getText("title").toJSON()).toBe("My doc");
		expect(Y.encodeStateVector(rebuilt)).toEqual(Y.encodeStateVector(onlyClient(rebuilt)));
	});
});

/** A doc's state vector should mention only the client that did the rebuild. */
function onlyClient(doc: Y.Doc): Y.Doc {
	const decoded = Y.decodeStateVector(Y.encodeStateVector(doc));
	expect([...decoded.keys()]).toEqual([doc.clientID]);
	return doc;
}
