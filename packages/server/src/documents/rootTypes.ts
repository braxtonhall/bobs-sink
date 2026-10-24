import * as Y from "yjs";
import type { RootType } from "@bobs-sink/protocol";

/** Gets a document's root shared type as the given kind, defining it if needed. Throws if it is another kind. */
export function getRoot(doc: Y.Doc, name: string, type: RootType): Y.Map<unknown> | Y.Array<unknown> | Y.Text {
	switch (type) {
		case "map":
			return doc.getMap(name);
		case "array":
			return doc.getArray(name);
		case "text":
			return doc.getText(name);
	}
}
