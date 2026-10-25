import { SinkClient } from "@bobs-sink/client";
import { byId } from "./dom.js";
import { EventLog } from "./EventLog.js";
import "./style.css";
import { renderAccount, type AccountActions } from "./views/accountView.js";
import { bindItems } from "./views/itemsView.js";
import { bindNotes } from "./views/notesView.js";
import { renderStatus } from "./views/statusView.js";

const serviceUrl = (import.meta.env["VITE_SINK_URL"] as string | undefined) ?? "http://localhost:8080";

const statusContainer = byId("status", HTMLElement);
const accountContainer = byId("account", HTMLElement);
const log = new EventLog(byId("log", HTMLOListElement));

const sink = await SinkClient.open({ serviceUrl, roots: { items: "map", notes: "text" } });

const actions: AccountActions = {
	run(label, action) {
		for (const button of accountContainer.querySelectorAll("button")) {
			button.disabled = true;
		}
		action()
			.then((result) => {
				log.add(`${label}: ${result ?? "done"}`);
			})
			.catch((error: unknown) => {
				log.error(label, error);
			})
			.finally(renderAll);
	},
};

function renderAll(): void {
	renderStatus(statusContainer, sink);
	renderAccount(accountContainer, sink, actions, log);
}

// Shows the working copy in the items and notes views, re-binding whenever it's replaced.
sink.bind((doc) => {
	const unbindItems = bindItems(byId("items", HTMLUListElement), byId("add-item", HTMLFormElement), doc);
	const unbindNotes = bindNotes(byId("notes", HTMLTextAreaElement), doc.getText("notes"));
	const onUpdate = () => {
		renderStatus(statusContainer, sink);
	};
	doc.on("update", onUpdate);
	return () => {
		unbindItems();
		unbindNotes();
		doc.off("update", onUpdate);
	};
});

sink.on("doc", () => {
	log.add("working doc replaced");
	renderAll();
});
sink.on("sync", (status) => {
	log.add(`sync: ${status}`);
	renderStatus(statusContainer, sink);
});
sink.on("identity", (identity) => {
	log.add(`identity: ${identity.kind}`);
	renderAll();
});
sink.on("document", (document) => {
	log.add(
		document === undefined
			? "detached from document"
			: `document ${document.documentId.slice(0, 8)}…, epoch ${document.epoch}`,
	);
	renderAll();
});
sink.on("rejected", (reason) => {
	log.add(`service rejected an edit (${reason}); reset to the service's copy`, "error");
});
sink.on("error", (error) => {
	log.error("Background sync step", error);
});

log.add(`opened; service at ${serviceUrl}`);
renderAll();
