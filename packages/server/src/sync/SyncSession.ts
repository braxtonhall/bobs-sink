import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import { documentAccess } from "../documents/documentAccess.js";
import type { DocumentService } from "../documents/DocumentService.js";
import type { CloseReason, DocumentSubscriber, LiveDocument } from "../documents/LiveDocument.js";
import type { Lease, LiveDocumentRegistry } from "../documents/LiveDocumentRegistry.js";
import type { ConnectionVerifier } from "../identity/ConnectionVerifier.js";
import type { DeviceAuthority } from "../identity/DeviceKeyRepository.js";
import { rateRules } from "../limits/rateRules.js";
import type { RateLimiter } from "../limits/RateLimiter.js";
import type { Logger } from "../logger.js";
import { SinkError } from "../shared/errors.js";
import { randomId } from "../shared/randomId.js";
import type { ActiveSessions, ClosableSession } from "./ActiveSessions.js";
import { closeCodes, messageSync, type ServerMessage } from "@bobs-sink/protocol";
import { clientMessageSchema } from "./clientMessage.js";
import type { SyncSocket } from "./SyncSocket.js";

const authenticationTimeoutMs = 10_000;

export type SyncSessionDependencies = {
	registry: LiveDocumentRegistry;
	documents: DocumentService;
	verifier: ConnectionVerifier;
	activeSessions: ActiveSessions;
	limiter: RateLimiter;
	logger: Logger;
};

type State =
	| { kind: "authenticating"; challenge: string; timer: NodeJS.Timeout }
	| { kind: "syncing"; authority: DeviceAuthority; lease: Lease; canWrite: boolean; untrack: () => void }
	| { kind: "closed" };

/** One client's sync connection to one document. See protocol.ts for the message flow. */
export class SyncSession implements DocumentSubscriber, ClosableSession {
	private state: State;

	constructor(
		private readonly socket: SyncSocket,
		private readonly documentId: string,
		private readonly deps: SyncSessionDependencies,
	) {
		const challenge = randomId();
		const timer = setTimeout(() => {
			this.close(closeCodes.authenticationTimeout, "authentication timeout");
		}, authenticationTimeoutMs);
		timer.unref();
		this.state = { kind: "authenticating", challenge, timer };
		this.sendJson({ type: "challenge", challenge });
	}

	receive(data: string | ArrayBuffer): void {
		try {
			if (this.state.kind === "authenticating" && typeof data === "string") {
				this.authenticate(this.state.challenge, data);
			} else if (this.state.kind === "syncing" && typeof data !== "string") {
				this.receiveSync(this.state, new Uint8Array(data));
			} else if (this.state.kind !== "closed") {
				this.close(closeCodes.badMessage, "unexpected message");
			}
		} catch (error) {
			this.closeForError(error);
		}
	}

	/** The socket closed on its own. */
	disconnected(): void {
		this.release();
	}

	onUpdate(update: Uint8Array): void {
		this.sendSync(messageYjsUpdate, update);
	}

	onEpochChanged(epoch: number): void {
		this.close(closeCodes.epochChanged, String(epoch));
	}

	onClosed(reason: CloseReason): void {
		this.close(reason === "deleted" ? closeCodes.gone : closeCodes.goingAway, `document ${reason}`);
	}

	closeUnauthorized(): void {
		this.close(closeCodes.unauthorized, "device key revoked");
	}

	private authenticate(challenge: string, text: string): void {
		const message = clientMessageSchema.parse(JSON.parse(text));
		const authority = this.deps.verifier.verify({
			documentId: this.documentId,
			challenge,
			key: message.key,
			signature: message.signature,
		});
		const summary = this.deps.documents.requireAccess(authority, this.documentId, "read");
		const lease = this.deps.registry.acquire(this.documentId, this);
		if (lease === undefined) {
			throw new SinkError("not_found", "document not found");
		}
		if (message.epoch !== null && message.epoch !== lease.document.epoch) {
			lease.release();
			this.close(closeCodes.epochChanged, String(lease.document.epoch));
			return;
		}
		if (this.state.kind === "authenticating") {
			clearTimeout(this.state.timer);
		}
		const canWrite = documentAccess(summary, authority) === "write";
		const untrack = this.deps.activeSessions.add(authority.publicKey, this);
		this.state = { kind: "syncing", authority, lease, canWrite, untrack };
		this.sendJson({ type: "ready", epoch: lease.document.epoch, access: canWrite ? "write" : "read" });
		this.sendSync(messageYjsSyncStep1, lease.document.stateVector());
	}

	private receiveSync(state: Extract<State, { kind: "syncing" }>, bytes: Uint8Array): void {
		const decoder = decoding.createDecoder(bytes);
		if (decoding.readVarUint(decoder) !== messageSync) {
			throw new SinkError("bad_request", "unsupported message type");
		}
		const syncType = decoding.readVarUint(decoder);
		const payload = decoding.readVarUint8Array(decoder);
		const document = state.lease.document;
		switch (syncType) {
			case messageYjsSyncStep1:
				this.sendSync(messageYjsSyncStep2, document.diff(payload));
				return;
			case messageYjsSyncStep2:
			case messageYjsUpdate:
				this.receiveUpdate(state, document, payload);
				return;
			default:
				throw new SinkError("bad_request", "unknown sync message");
		}
	}

	private receiveUpdate(state: Extract<State, { kind: "syncing" }>, document: LiveDocument, update: Uint8Array): void {
		if (!state.canWrite) {
			this.sendJson({ type: "rejected", reason: "read_only" });
			return;
		}
		if (!this.deps.limiter.tryTake(`updates:${state.authority.publicKey}`, rateRules.updatesPerDevice)) {
			this.close(closeCodes.rateLimited, "too many updates");
			return;
		}
		const result = document.apply(update, state.authority.publicKey, this);
		if (!result.accepted) {
			this.sendJson({ type: "rejected", reason: result.reason });
		}
	}

	private sendJson(message: ServerMessage): void {
		this.socket.send(JSON.stringify(message));
	}

	private sendSync(syncType: number, payload: Uint8Array): void {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, messageSync);
		encoding.writeVarUint(encoder, syncType);
		encoding.writeVarUint8Array(encoder, payload);
		this.socket.send(encoding.toUint8Array(encoder));
	}

	private closeForError(error: unknown): void {
		if (error instanceof SinkError) {
			this.close(error.kind === "not_found" ? closeCodes.notFound : closeCodes.unauthorized, error.message);
			return;
		}
		if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
			this.close(closeCodes.badMessage, "malformed message");
			return;
		}
		this.deps.logger.error({ err: error, documentId: this.documentId }, "sync session failed");
		this.close(closeCodes.badMessage, "internal error");
	}

	private close(code: number, reason: string): void {
		if (this.state.kind === "closed") {
			return;
		}
		this.release();
		this.socket.close(code, reason);
	}

	private release(): void {
		if (this.state.kind === "authenticating") {
			clearTimeout(this.state.timer);
		} else if (this.state.kind === "syncing") {
			this.state.untrack();
			this.state.lease.release();
		}
		this.state = { kind: "closed" };
	}
}
