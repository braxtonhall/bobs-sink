import type { SinkClient } from "@bobs-sink/client";
import * as Y from "yjs";
import { element } from "../dom.js";

/** Identity, sync state, the document the working copy belongs to, and its size. */
export function renderStatus(container: HTMLElement, sink: SinkClient): void {
	const identity = sink.identity;
	const document = sink.document;
	const entries: [string, string][] = [
		["Identity", identity.kind === "anonymous" ? "anonymous" : `${identity.kind} ${short(identity.identityId)}`],
		["Sync", sink.sync],
		["Document", document === undefined ? "none (local only)" : `${document.documentId} (epoch ${document.epoch})`],
		["Size", `${Y.encodeStateAsUpdate(sink.doc).byteLength} bytes`],
	];
	container.replaceChildren(
		...entries.flatMap(([term, value]) => [
			element("dt", { textContent: term }),
			element("dd", { textContent: value, className: term === "Sync" ? `sync-${value}` : "" }),
		]),
	);
}

function short(id: string | undefined): string {
	return id === undefined ? "(unknown)" : `${id.slice(0, 8)}…`;
}
