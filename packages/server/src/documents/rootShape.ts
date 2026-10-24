import * as Y from "yjs";
import type { RootType } from "@bobs-sink/protocol";

/**
 * Whether a root's stored content fits `type`. Roots received from updates carry no type information, and
 * Yjs will cast an untyped root to whatever type is asked for: text content under a root read as a map
 * would simply be invisible. So the content itself has to be checked before trusting the cast.
 */
export function rootShapeMatches(root: Root, type: RootType): boolean {
	if (root instanceof Y.Map || root instanceof Y.Array || root instanceof Y.Text) {
		return root instanceof constructors[type];
	}
	switch (type) {
		case "map":
			return root._start === null;
		case "array":
			return root._map.size === 0 && listContents(root).every((content) => !isTextContent(content));
		case "text":
			// Y.Text keeps formatting attributes in its map, so only the list content is checked.
			return listContents(root).every((content) => !isArrayContent(content));
	}
}

type Root = NonNullable<ReturnType<Y.Doc["share"]["get"]>>;

const constructors = { map: Y.Map, array: Y.Array, text: Y.Text } as const;

function listContents(root: Root): unknown[] {
	const contents: unknown[] = [];
	for (let item = root._start; item !== null; item = item.right) {
		contents.push(item.content);
	}
	return contents;
}

function isTextContent(content: unknown): boolean {
	return content instanceof Y.ContentString || content instanceof Y.ContentFormat || content instanceof Y.ContentEmbed;
}

function isArrayContent(content: unknown): boolean {
	return (
		content instanceof Y.ContentAny ||
		content instanceof Y.ContentBinary ||
		content instanceof Y.ContentJSON ||
		content instanceof Y.ContentDoc
	);
}
