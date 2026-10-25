import type { DocumentInfo, SinkClient } from "@bobs-sink/client";
import { button, element } from "../dom.js";
import type { EventLog } from "../EventLog.js";

export type AccountActions = {
	/** Runs an action, logging its outcome and disabling the buttons meanwhile. */
	run(label: string, action: () => Promise<string | undefined>): void;
};

/** The buttons that make sense for the current identity, plus the sign-in choices when there are any. */
export function renderAccount(container: HTMLElement, sink: SinkClient, actions: AccountActions, log: EventLog): void {
	const identity = sink.identity;
	switch (identity.kind) {
		case "anonymous":
			container.replaceChildren(
				element("p", { className: "hint", textContent: "Edits are saved in this browser only." }),
				element("div", { className: "row" }, [
					button("Turn on cloud saves", () => {
						actions.run("Turn on cloud saves", async () => {
							const created = await sink.enableCloudSaves({ userName: "bobs-sink demo" });
							return `created document ${created.id.slice(0, 8)}…`;
						});
					}),
					button("Sign in with a passkey", () => {
						actions.run("Sign in", () => signIn(sink));
					}),
				]),
			);
			return;
		case "needs-sign-in":
			container.replaceChildren(
				element("p", {
					className: "warning",
					textContent: "This device's key is missing or was revoked. Edits are still saved here; sign in to sync them.",
				}),
				button("Sign in again", () => {
					actions.run("Sign in", () => signIn(sink));
				}),
			);
			return;
		case "signed-in":
			container.replaceChildren(
				element("div", { className: "row" }, [
					button("Revoke other devices", () => {
						actions.run("Revoke other devices", async () => `revoked ${await sink.revokeOtherDevices()}`);
					}),
					button("Sign out", () => {
						actions.run("Sign out", async () => {
							await sink.signOut();
							return "signed out; local copy deleted";
						});
					}),
				]),
			);
			if (sink.document === undefined) {
				void renderChoices(container, sink, actions, log);
			}
			return;
	}
}

async function signIn(sink: SinkClient): Promise<string> {
	// The demo shows every choice; a site can leave this out to merge into the identity's document.
	const outcome = await sink.signIn({ unmatched: "choose" });
	const count = `${outcome.documents.length} document${outcome.documents.length === 1 ? "" : "s"}`;
	return outcome.result === "resumed" ? `resumed syncing (${count})` : `signed in; ${count}, choose what to do below`;
}

/** Signed in, but the working copy isn't attached to a document: what to do with local data. */
async function renderChoices(container: HTMLElement, sink: SinkClient, actions: AccountActions, log: EventLog) {
	let documents: DocumentInfo[];
	try {
		documents = await sink.listDocuments();
	} catch (error) {
		log.error("Listing documents", error);
		return;
	}
	const choices = element("div", { className: "choices" }, [
		element("p", { textContent: "This browser's local data isn't attached to a cloud document yet." }),
	]);
	for (const document of documents) {
		const label = `${document.id.slice(0, 8)}… (epoch ${document.epoch}, ${document.sizeBytes} bytes)`;
		choices.append(
			element("div", { className: "row" }, [
				element("code", { textContent: label }),
				button("Merge local into it", () => {
					actions.run("Merge", async () => {
						await sink.mergeLocalInto(document.id);
						return "merged local data (remote wins on conflicts)";
					});
				}),
				button("Use it, discard local", () => {
					actions.run("Use remote", async () => {
						await sink.useRemote(document.id);
						return "switched to the cloud document";
					});
				}),
			]),
		);
	}
	choices.append(
		button(documents.length === 0 ? "Upload local data" : "Keep local as a new document", () => {
			actions.run("Create document", async () => {
				const created = await sink.createDocumentFromLocal();
				return `created document ${created.id.slice(0, 8)}…`;
			});
		}),
	);
	container.append(choices);
}
