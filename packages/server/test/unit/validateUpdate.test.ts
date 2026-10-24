import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DocumentRules } from "../../src/documents/DocumentRules.js";
import { validateUpdate } from "../../src/documents/validateUpdate.js";
import { Ajv } from "ajv";

const openRules: DocumentRules = { maxBytes: 1024 * 1024, roots: undefined, validateJson: undefined };

function updateFrom(doc: Y.Doc, change: (doc: Y.Doc) => void): Uint8Array {
	const before = Y.encodeStateVector(doc);
	change(doc);
	return Y.encodeStateAsUpdate(doc, before);
}

describe("validateUpdate", () => {
	it("accepts an update and returns the result without touching the current doc", () => {
		const current = new Y.Doc();
		const update = updateFrom(new Y.Doc(), (doc) => doc.getMap("items").set("a", 1));

		const validation = validateUpdate(current, update, openRules);

		expect(validation).toMatchObject({ accepted: true, changed: true });
		expect(current.getMap("items").size).toBe(0);
		if (validation.accepted) {
			expect(validation.result.getMap("items").get("a")).toBe(1);
		}
	});

	it("reports an update the document already has as unchanged", () => {
		const client = new Y.Doc();
		const update = updateFrom(client, (doc) => doc.getMap("items").set("a", 1));
		const current = new Y.Doc();
		Y.applyUpdate(current, update);

		expect(validateUpdate(current, update, openRules)).toMatchObject({ accepted: true, changed: false });
	});

	it("rejects an update whose dependencies are missing, so it can't be applied later unchecked", () => {
		const client = new Y.Doc();
		updateFrom(client, (doc) => {
			doc.getText("note").insert(0, "hello");
		});
		const second = updateFrom(client, (doc) => {
			doc.getText("note").insert(5, " world");
		});

		expect(validateUpdate(new Y.Doc(), second, openRules)).toEqual({
			accepted: false,
			reason: "missing_dependencies",
		});
	});

	it("rejects a delete of content the server hasn't seen", () => {
		const client = new Y.Doc();
		updateFrom(client, (doc) => doc.getMap("items").set("a", 1));
		const deletion = updateFrom(client, (doc) => {
			doc.getMap("items").delete("a");
		});

		expect(validateUpdate(new Y.Doc(), deletion, openRules)).toMatchObject({ accepted: false });
	});

	it("rejects updates that make the document too large", () => {
		const update = updateFrom(new Y.Doc(), (doc) => {
			doc.getText("note").insert(0, "x".repeat(2000));
		});

		expect(validateUpdate(new Y.Doc(), update, { ...openRules, maxBytes: 1000 })).toEqual({
			accepted: false,
			reason: "too_large",
		});
	});

	it("rejects malformed bytes", () => {
		expect(validateUpdate(new Y.Doc(), new Uint8Array([255, 255, 255, 1, 2]), openRules)).toMatchObject({
			accepted: false,
		});
	});

	describe("with a schema", () => {
		const rules: DocumentRules = {
			maxBytes: 1024 * 1024,
			roots: { items: "map" },
			validateJson: new Ajv().compile({
				type: "object",
				properties: { items: { type: "object", additionalProperties: { type: "number" } } },
			}),
		};

		it("accepts content that matches", () => {
			const update = updateFrom(new Y.Doc(), (doc) => doc.getMap("items").set("a", 1));
			expect(validateUpdate(new Y.Doc(), update, rules)).toMatchObject({ accepted: true });
		});

		it("rejects undeclared roots", () => {
			const update = updateFrom(new Y.Doc(), (doc) => doc.getMap("other").set("a", 1));
			expect(validateUpdate(new Y.Doc(), update, rules)).toEqual({ accepted: false, reason: "unknown_root" });
		});

		it("rejects a root of the wrong type", () => {
			const update = updateFrom(new Y.Doc(), (doc) => {
				doc.getText("items").insert(0, "nope");
			});
			expect(validateUpdate(new Y.Doc(), update, rules)).toEqual({ accepted: false, reason: "schema_violation" });
		});

		it("rejects content the JSON Schema forbids", () => {
			const update = updateFrom(new Y.Doc(), (doc) => doc.getMap("items").set("a", "not a number"));
			expect(validateUpdate(new Y.Doc(), update, rules)).toEqual({ accepted: false, reason: "schema_violation" });
		});
	});
});

describe("validateUpdate root shapes", () => {
	const rules = (roots: DocumentRules["roots"]): DocumentRules => ({
		maxBytes: 1 << 20,
		roots,
		validateJson: undefined,
	});

	type Case = [name: string, roots: DocumentRules["roots"], change: (doc: Y.Doc) => void];

	it.each<Case>([
		[
			"text sent to a map root",
			{ items: "map" } as const,
			(doc: Y.Doc) => {
				doc.getText("items").insert(0, "x");
			},
		],
		[
			"array sent to a map root",
			{ items: "map" } as const,
			(doc: Y.Doc) => {
				doc.getArray("items").push([1]);
			},
		],
		["map sent to an array root", { items: "array" } as const, (doc: Y.Doc) => doc.getMap("items").set("a", 1)],
		[
			"text sent to an array root",
			{ items: "array" } as const,
			(doc: Y.Doc) => {
				doc.getText("items").insert(0, "x");
			},
		],
		[
			"array sent to a text root",
			{ items: "text" } as const,
			(doc: Y.Doc) => {
				doc.getArray("items").push([1]);
			},
		],
	])("rejects %s", (_name, roots, change) => {
		const update = updateFrom(new Y.Doc(), change);
		expect(validateUpdate(new Y.Doc(), update, rules(roots))).toEqual({ accepted: false, reason: "schema_violation" });
	});

	it.each<Case>([
		["map", { items: "map" } as const, (doc: Y.Doc) => doc.getMap("items").set("a", 1)],
		[
			"array",
			{ items: "array" } as const,
			(doc: Y.Doc) => {
				doc.getArray("items").push([1, new Y.Map()]);
			},
		],
		[
			"text",
			{ items: "text" } as const,
			(doc: Y.Doc) => {
				doc.getText("items").insert(0, "x", { bold: true });
			},
		],
	])("accepts a matching %s root", (_name, roots, change) => {
		const update = updateFrom(new Y.Doc(), change);
		expect(validateUpdate(new Y.Doc(), update, rules(roots))).toMatchObject({ accepted: true });
	});
});
