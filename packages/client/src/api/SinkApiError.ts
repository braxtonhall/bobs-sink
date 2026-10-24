import type { ErrorBody } from "@bobs-sink/protocol";

/** A request the service refused. `kind` is the service's error kind, or "unknown" for unexpected bodies. */
export class SinkApiError extends Error {
	constructor(
		readonly status: number,
		readonly kind: ErrorBody["error"] | "unknown",
		message: string,
	) {
		super(message);
		this.name = "SinkApiError";
	}

	static async fromResponse(response: Response): Promise<SinkApiError> {
		const body = (await response.json().catch(() => undefined)) as Partial<ErrorBody> | undefined;
		return new SinkApiError(response.status, body?.error ?? "unknown", body?.message ?? response.statusText);
	}
}
