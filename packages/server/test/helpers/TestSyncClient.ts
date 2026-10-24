import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket } from "ws";
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import * as Y from "yjs";
import { messageSync, type ServerMessage } from "@bobs-sink/protocol";
import { waitFor } from "@bobs-sink/test-support";
import type { TestDevice } from "./TestDevice.js";

const remote = Symbol("remote");

export type Closed = { code: number; reason: string };

/** A minimal sync client: keeps a Y.Doc in sync with one document over the sync protocol. */
export class TestSyncClient {
	readonly rejections: string[] = [];
	ready: Extract<ServerMessage, { type: "ready" }> | undefined;
	closed: Closed | undefined;
	private readonly socket: WebSocket;

	constructor(
		wsUrl: string,
		readonly documentId: string,
		private readonly device: TestDevice,
		readonly doc = new Y.Doc(),
		private readonly epoch: number | null = null,
	) {
		this.socket = new WebSocket(`${wsUrl}/v1/sync/${documentId}`);
		this.socket.binaryType = "arraybuffer";
		this.socket.on("message", (data: ArrayBuffer, isBinary: boolean) => {
			if (isBinary) {
				this.receiveSync(new Uint8Array(data));
			} else {
				this.receiveControl(JSON.parse(new TextDecoder().decode(data)) as ServerMessage);
			}
		});
		this.socket.on("close", (code, reason) => {
			this.closed = { code, reason: reason.toString() };
		});
		this.doc.on("update", (update: Uint8Array, origin: unknown) => {
			if (origin !== remote && this.ready !== undefined) {
				this.sendSync(messageYjsUpdate, update);
			}
		});
	}

	/** Resolves once the connection is ready or has closed. */
	async settled(): Promise<this> {
		await waitFor(() => this.ready !== undefined || this.closed !== undefined);
		return this;
	}

	close(): void {
		this.socket.close();
	}

	/** Sends raw bytes as an update, bypassing the local doc. */
	sendUpdate(update: Uint8Array): void {
		this.sendSync(messageYjsUpdate, update);
	}

	private receiveControl(message: ServerMessage): void {
		switch (message.type) {
			case "challenge":
				this.socket.send(
					JSON.stringify({
						type: "authenticate",
						key: this.device.publicKey,
						signature: this.device.signConnection(this.documentId, message.challenge),
						epoch: this.epoch,
					}),
				);
				return;
			case "ready":
				this.ready = message;
				this.sendSync(messageYjsSyncStep1, Y.encodeStateVector(this.doc));
				return;
			case "rejected":
				this.rejections.push(message.reason);
				return;
		}
	}

	private receiveSync(bytes: Uint8Array): void {
		const decoder = decoding.createDecoder(bytes);
		decoding.readVarUint(decoder);
		const syncType = decoding.readVarUint(decoder);
		const payload = decoding.readVarUint8Array(decoder);
		if (syncType === messageYjsSyncStep1) {
			this.sendSync(messageYjsSyncStep2, Y.encodeStateAsUpdate(this.doc, payload));
		} else {
			Y.applyUpdate(this.doc, payload, remote);
		}
	}

	private sendSync(syncType: number, payload: Uint8Array): void {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, messageSync);
		encoding.writeVarUint(encoder, syncType);
		encoding.writeVarUint8Array(encoder, payload);
		this.socket.send(encoding.toUint8Array(encoder));
	}
}
