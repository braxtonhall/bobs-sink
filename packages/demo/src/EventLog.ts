import { element } from "./dom.js";

const maxEntries = 50;

/** A newest-first list of what happened, on the page. */
export class EventLog {
	constructor(private readonly list: HTMLOListElement) {}

	add(message: string, kind: "info" | "error" = "info"): void {
		const time = new Date().toLocaleTimeString();
		this.list.prepend(element("li", { className: kind }, [element("time", { textContent: time }), ` ${message}`]));
		while (this.list.children.length > maxEntries) {
			this.list.lastElementChild?.remove();
		}
	}

	error(context: string, error: unknown): void {
		this.add(`${context} failed: ${describeError(error)}`, "error");
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		// WebAuthn reports a dismissed prompt as NotAllowedError.
		return error.name === "NotAllowedError" ? "passkey prompt was dismissed" : error.message;
	}
	return String(error);
}
