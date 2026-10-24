import type { Access, ClientMessage, RejectionReason, ServerMessage } from "@bobs-sink/protocol";
import { connectionSigningMessage } from "@bobs-sink/protocol";
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import * as Y from "yjs";
import type { DeviceSigner } from "../identity/DeviceKey.js";
import { decodeSyncFrame, encodeSyncFrame } from "./syncFrames.js";

export type WebSocketConstructor = new (url: string) => WebSocket;

export type SyncConnectionOptions = {
	url: string;
	documentId: string;
	/** The epoch the doc's state belongs to; null if it has no state from the server yet. */
	epoch: number | null;
	doc: Y.Doc;
	signer: DeviceSigner;
	WebSocket: WebSocketConstructor;
	/** How long local updates are collected before being sent together. */
	batchMs: number;
};

export type SyncConnectionHandlers = {
	onReady(ready: { epoch: number; access: Access }): void;
	/** The doc has everything the server had when the connection became ready. */
	onSynced(): void;
	onRejected(reason: RejectionReason): void;
	onClose(close: { code: number; reason: string }): void;
};

type State = "authenticating" | "syncing" | "closed";

/** One WebSocket session keeping a Y.Doc in sync with a document. See the protocol package for the flow. */
export class SyncConnection {
	private readonly socket: WebSocket;
	private state: State = "authenticating";
	private access: Access = "read";
	private synced = false;
	private pending: Uint8Array[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly options: SyncConnectionOptions,
		private readonly handlers: SyncConnectionHandlers,
	) {
		this.socket = new options.WebSocket(options.url);
		this.socket.binaryType = "arraybuffer";
		this.socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
			this.receive(event.data);
		};
		this.socket.onclose = (event) => {
			this.detach();
			handlers.onClose({ code: event.code, reason: event.reason });
		};
		options.doc.on("update", this.onLocalUpdate);
	}

	close(): void {
		this.detach();
		this.socket.close();
	}

	private readonly onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
		// Updates made before the connection is ready reach the server in the sync step 2 reply instead.
		if (origin === this || this.state !== "syncing" || this.access !== "write") {
			return;
		}
		this.pending.push(update);
		this.flushTimer ??= setTimeout(() => {
			this.flush();
		}, this.options.batchMs);
	};

	private receive(data: string | ArrayBuffer): void {
		if (this.state === "closed") {
			return;
		}
		if (typeof data === "string") {
			this.receiveControl(JSON.parse(data) as ServerMessage);
			return;
		}
		const frame = decodeSyncFrame(new Uint8Array(data));
		if (frame === undefined || this.state !== "syncing") {
			return;
		}
		switch (frame.syncType) {
			case messageYjsSyncStep1:
				this.sendSync(messageYjsSyncStep2, Y.encodeStateAsUpdate(this.options.doc, frame.payload));
				return;
			case messageYjsSyncStep2:
				Y.applyUpdate(this.options.doc, frame.payload, this);
				if (!this.synced) {
					this.synced = true;
					this.handlers.onSynced();
				}
				return;
			case messageYjsUpdate:
				Y.applyUpdate(this.options.doc, frame.payload, this);
				return;
		}
	}

	private receiveControl(message: ServerMessage): void {
		switch (message.type) {
			case "challenge":
				void this.authenticate(message.challenge);
				return;
			case "ready":
				this.state = "syncing";
				this.access = message.access;
				this.handlers.onReady(message);
				this.sendSync(messageYjsSyncStep1, Y.encodeStateVector(this.options.doc));
				return;
			case "rejected":
				this.handlers.onRejected(message.reason);
				return;
		}
	}

	private async authenticate(challenge: string): Promise<void> {
		const { documentId, epoch, signer } = this.options;
		const signature = await signer.sign(connectionSigningMessage({ documentId, challenge }));
		if (this.state !== "authenticating") {
			return;
		}
		const message: ClientMessage = { type: "authenticate", key: signer.publicKey, signature, epoch };
		this.socket.send(JSON.stringify(message));
	}

	private flush(): void {
		this.flushTimer = undefined;
		if (this.pending.length === 0 || this.state !== "syncing") {
			return;
		}
		const update = Y.mergeUpdates(this.pending);
		this.pending = [];
		this.sendSync(messageYjsUpdate, update);
	}

	private sendSync(syncType: number, payload: Uint8Array): void {
		if (this.socket.readyState === this.socket.OPEN) {
			this.socket.send(encodeSyncFrame(syncType, payload));
		}
	}

	private detach(): void {
		if (this.state === "closed") {
			return;
		}
		this.state = "closed";
		clearTimeout(this.flushTimer);
		this.pending = [];
		this.options.doc.off("update", this.onLocalUpdate);
	}
}
