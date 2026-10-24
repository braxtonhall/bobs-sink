import type { ErrorKind } from "@bobs-sink/protocol";

/** An expected failure that should be reported to the caller, not logged as a bug. */
export class SinkError extends Error {
	constructor(
		readonly kind: ErrorKind,
		message: string,
	) {
		super(message);
		this.name = "SinkError";
	}
}
