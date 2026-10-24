import { closeCodes, type RejectionReason } from "@bobs-sink/protocol";
import { Backoff, type BackoffOptions } from "./Backoff.js";
import { SyncConnection, type SyncConnectionOptions } from "./SyncConnection.js";

export type SyncStatus = "connecting" | "synced" | "offline" | "stopped";

/** Why syncing stopped for good. Each needs a decision from the client, so none is retried. */
export type StopReason =
	| { kind: "unauthorized" }
	| { kind: "gone" }
	| { kind: "epoch-changed"; epoch: number }
	| { kind: "rejected"; reason: RejectionReason }
	| { kind: "failed"; code: number; message: string };

export type SyncProviderHandlers = {
	onStatus(status: SyncStatus): void;
	onStopped(reason: StopReason): void;
};

export type SyncProviderOptions = Omit<SyncConnectionOptions, "epoch"> & {
	epoch: number | null;
	backoff?: BackoffOptions;
};

/**
 * Keeps a Y.Doc in sync with one document across connections: reconnects with backoff after network failures
 * and server restarts, and stops when the server says something only the client can resolve.
 */
export class SyncProvider {
	private status: SyncStatus = "connecting";
	private connection: SyncConnection | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly backoff: Backoff;
	private readonly syncWaiters: { resolve(): void; reject(error: Error): void }[] = [];

	constructor(
		private readonly options: SyncProviderOptions,
		private readonly handlers: SyncProviderHandlers,
	) {
		this.backoff = new Backoff(options.backoff);
		if (typeof window !== "undefined") {
			window.addEventListener("online", this.onOnline);
		}
		this.connect();
	}

	get currentStatus(): SyncStatus {
		return this.status;
	}

	/** Resolves once the doc has the server's state; rejects if syncing stops first or `timeoutMs` passes. */
	whenSynced(timeoutMs: number): Promise<void> {
		if (this.status === "synced") {
			return Promise.resolve();
		}
		if (this.status === "stopped") {
			return Promise.reject(new Error("sync stopped"));
		}
		return new Promise((resolve, reject) => {
			const waiter = {
				resolve: () => {
					clearTimeout(timer);
					resolve();
				},
				reject: (error: Error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
			const timer = setTimeout(() => {
				this.syncWaiters.splice(this.syncWaiters.indexOf(waiter), 1);
				reject(new Error("timed out waiting for sync"));
			}, timeoutMs);
			this.syncWaiters.push(waiter);
		});
	}

	/** Stops syncing without reporting a reason. */
	destroy(): void {
		this.shutDown();
	}

	private connect(): void {
		this.setStatus("connecting");
		const connection = new SyncConnection(this.options, {
			onReady: () => {
				this.backoff.reset();
			},
			onSynced: () => {
				this.setStatus("synced");
				for (const waiter of this.syncWaiters.splice(0)) {
					waiter.resolve();
				}
			},
			onRejected: (reason) => {
				this.stop({ kind: "rejected", reason });
			},
			onClose: ({ code, reason }) => {
				if (this.connection === connection) {
					this.connection = undefined;
					this.handleClose(code, reason);
				}
			},
		});
		this.connection = connection;
	}

	private handleClose(code: number, reason: string): void {
		switch (code) {
			case closeCodes.unauthorized:
				this.stop({ kind: "unauthorized" });
				return;
			case closeCodes.notFound:
			case closeCodes.gone:
				this.stop({ kind: "gone" });
				return;
			case closeCodes.epochChanged:
				this.stop({ kind: "epoch-changed", epoch: Number(reason) });
				return;
			case closeCodes.badMessage:
				this.stop({ kind: "failed", code, message: reason });
				return;
			default:
				this.setStatus("offline");
				this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			this.connect();
		}, this.backoff.next());
	}

	private readonly onOnline = (): void => {
		if (this.status === "offline") {
			this.backoff.reset();
			clearTimeout(this.reconnectTimer);
			this.connect();
		}
	};

	private stop(reason: StopReason): void {
		if (this.shutDown()) {
			this.handlers.onStopped(reason);
		}
	}

	/** Returns whether this call did the shutting down. */
	private shutDown(): boolean {
		if (this.status === "stopped") {
			return false;
		}
		clearTimeout(this.reconnectTimer);
		if (typeof window !== "undefined") {
			window.removeEventListener("online", this.onOnline);
		}
		const connection = this.connection;
		this.connection = undefined;
		connection?.close();
		this.setStatus("stopped");
		for (const waiter of this.syncWaiters.splice(0)) {
			waiter.reject(new Error("sync stopped"));
		}
		return true;
	}

	private setStatus(status: SyncStatus): void {
		if (this.status !== status) {
			this.status = status;
			this.handlers.onStatus(status);
		}
	}
}
