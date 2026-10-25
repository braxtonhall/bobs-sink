import type { DocumentInfo, RejectionReason } from "@bobs-sink/protocol";
import * as Y from "yjs";
import { SinkApi, type Fetch } from "./api/SinkApi.js";
import { SinkApiError } from "./api/SinkApiError.js";
import { copyChanges } from "./documents/copyChanges.js";
import { mergeDocuments, type ConflictResolver } from "./documents/mergeDocuments.js";
import type { Roots } from "./documents/roots.js";
import { unsyncedChanges } from "./documents/unsyncedChanges.js";
import { DeviceKey } from "./identity/DeviceKey.js";
import { browserPasskeys, type PasskeyAuthenticator } from "./identity/Passkeys.js";
import { fromBase64Url, toBase64Url } from "./shared/base64url.js";
import { Emitter } from "./shared/Emitter.js";
import { TaskQueue } from "./shared/TaskQueue.js";
import { ClientStateStore, type DocumentBinding } from "./storage/ClientStateStore.js";
import { Replica } from "./storage/Replica.js";
import type { BackoffOptions } from "./sync/Backoff.js";
import type { WebSocketConstructor } from "./sync/SyncConnection.js";
import { SyncProvider, type StopReason, type SyncStatus } from "./sync/SyncProvider.js";

export type SinkClientOptions = {
	/** The service's base URL, e.g. "https://sink.example.com". */
	serviceUrl: string;
	/** The top-level types of the app's documents. Must match the app's schema on the server. */
	roots: Roots;
	/** The app's passkey RP ID. Defaults to the page's hostname. */
	app?: string;
	/** Prefix for this client's IndexedDB databases. Defaults to `bobs-sink:<app>`. */
	storagePrefix?: string;
	passkeys?: PasskeyAuthenticator;
	fetch?: Fetch;
	WebSocket?: WebSocketConstructor;
	reconnect?: BackoffOptions;
	/** How long local edits are collected before being sent together. */
	batchMs?: number;
};

export type IdentityStatus =
	/** Cloud saves are off on this device. */
	| { kind: "anonymous" }
	| { kind: "signed-in"; identityId: string }
	/**
	 * The device key is missing or no longer authorized, so syncing stopped. Local edits keep being saved; ask
	 * the user to sign in again once, and don't prompt again if they dismiss it.
	 */
	| { kind: "needs-sign-in"; identityId: string | undefined };

/** "local" means the working copy isn't attached to a document on the service. */
export type ClientSyncStatus = "local" | SyncStatus;

export type SinkClientEvents = {
	/** The working copy was replaced; use this doc from now on. The previous one is destroyed. */
	doc: Y.Doc;
	identity: IdentityStatus;
	sync: ClientSyncStatus;
	/** The document the working copy is attached to changed. */
	document: DocumentBinding | undefined;
	/** The service refused a local change. The working copy has been reset to the service's state. */
	rejected: RejectionReason;
	/** A background step failed, e.g. recovering edits after a rebuild. */
	error: unknown;
};

export type SignInOptions = {
	/**
	 * What to do when the working copy doesn't belong to any of the identity's documents. "merge", the default,
	 * merges it into the most recently used document, or creates the first one from it. "choose" leaves it
	 * detached so the site can pick `createDocumentFromLocal`, `mergeLocalInto` or `useRemote`.
	 */
	unmatched?: "merge" | "choose";
	/** For "merge": picks a side for keys both copies have. Defaults to the remote one. */
	resolve?: ConflictResolver;
};

export type SignInOutcome = {
	identityId: string;
	/** The identity's documents for this app, including one created by signing in. */
	documents: DocumentInfo[];
	/**
	 * What happened to the working copy: "resumed" when it already belonged to one of `documents` and syncs
	 * with it again, "merged" or "created" for `unmatched: "merge"`, and "detached" for `unmatched: "choose"`.
	 */
	result: "resumed" | "merged" | "created" | "detached";
};

/** Sets up whatever uses a working copy; returns how to tear it down. */
export type DocSetup = (doc: Y.Doc) => (() => void) | undefined;

type DocBinding = { setup: DocSetup; teardown: (() => void) | undefined };

type Account = { identityId: string; key: DeviceKey };

type Settings = {
	api: SinkApi;
	prefix: string;
	roots: Roots;
	passkeys: PasskeyAuthenticator;
	WebSocket: WebSocketConstructor;
	reconnect: BackoffOptions | undefined;
	batchMs: number;
};

const defaultBatchMs = 50;
/** How long switching documents waits for the new one to sync before giving up and keeping the old one. */
const switchTimeoutMs = 30_000;

/**
 * A site's connection to bobs-sink: one working Y.Doc, saved locally, and synced to a document on the service
 * once the user turns on cloud saves. Operations run one at a time, in call order.
 */
export class SinkClient {
	private readonly events = new Emitter<SinkClientEvents>();
	private readonly tasks = new TaskQueue();
	private provider: SyncProvider | undefined;
	private syncStatus: ClientSyncStatus = "local";
	private needsSignIn = false;
	private readonly docBindings = new Set<DocBinding>();

	private constructor(
		private readonly settings: Settings,
		private readonly state: ClientStateStore,
		private replica: Replica,
		private account: Account | undefined,
		private binding: DocumentBinding | undefined,
	) {}

	static async open(options: SinkClientOptions): Promise<SinkClient> {
		const app = options.app ?? location.hostname;
		const prefix = options.storagePrefix ?? `bobs-sink:${app}`;
		const settings: Settings = {
			api: new SinkApi(options.serviceUrl.replace(/\/$/, ""), app, options.fetch ?? fetch.bind(globalThis)),
			prefix,
			roots: options.roots,
			passkeys: options.passkeys ?? browserPasskeys,
			WebSocket: options.WebSocket ?? WebSocket,
			reconnect: options.reconnect,
			batchMs: options.batchMs ?? defaultBatchMs,
		};
		requestPersistentStorage();
		const state = await ClientStateStore.open(`${prefix}:state`);
		const saved = await state.load();
		const account =
			saved.identity === undefined
				? undefined
				: { identityId: saved.identity.identityId, key: await DeviceKey.fromKeyPair(saved.identity.keyPair) };
		const replica = saved.replica === undefined ? await Replica.create(prefix) : await Replica.open(saved.replica);
		await state.save("replica", replica.name);
		Replica.deleteOthers(prefix, replica.name);
		const client = new SinkClient(settings, state, replica, account, saved.binding);
		client.startSync();
		return client;
	}

	/** The working copy. It is replaced in some flows; use `bind` or `observe`, or listen for "doc". */
	get doc(): Y.Doc {
		return this.replica.doc;
	}

	get identity(): IdentityStatus {
		if (this.needsSignIn || (this.binding !== undefined && this.account === undefined)) {
			return { kind: "needs-sign-in", identityId: this.account?.identityId };
		}
		return this.account === undefined
			? { kind: "anonymous" }
			: { kind: "signed-in", identityId: this.account.identityId };
	}

	get document(): DocumentBinding | undefined {
		return this.binding;
	}

	get sync(): ClientSyncStatus {
		return this.syncStatus;
	}

	on<Name extends keyof SinkClientEvents>(name: Name, listener: (value: SinkClientEvents[Name]) => void): () => void {
		return this.events.on(name, listener);
	}

	/**
	 * Runs `setup` with the working copy now and again with each one that replaces it, tearing down the previous
	 * setup first, while the old doc still works. Returns a function that tears down and stops.
	 */
	bind(setup: DocSetup): () => void {
		const binding: DocBinding = { setup, teardown: setup(this.doc) };
		this.docBindings.add(binding);
		return () => {
			if (this.docBindings.delete(binding)) {
				binding.teardown?.();
			}
		};
	}

	/** Calls `listener` with the working copy now, after each change to it, and whenever it's replaced. */
	observe(listener: (doc: Y.Doc) => void): () => void {
		return this.bind((doc) => {
			const onUpdate = () => {
				listener(doc);
			};
			doc.on("update", onUpdate);
			listener(doc);
			return () => {
				doc.off("update", onUpdate);
			};
		});
	}

	/**
	 * Turns on cloud saves: registers a passkey for a new identity, authorizes this device, and creates the
	 * identity's first document from the working copy, so nothing done before is lost.
	 */
	enableCloudSaves(options: { userName?: string } = {}): Promise<DocumentInfo> {
		return this.tasks.run(async () => {
			if (this.identity.kind === "signed-in") {
				throw new Error("already signed in");
			}
			const { api, passkeys } = this.settings;
			const key = await DeviceKey.generate();
			const start = await api.startRegistration(key.publicKey, options.userName);
			const { identityId } = await api.finishRegistration(start.ceremonyId, await passkeys.register(start.options));
			await this.setAccount({ identityId, key });
			await this.detach();
			return this.createFromLocal();
		});
	}

	/**
	 * Signs in with an existing passkey and authorizes this device. If the working copy belongs to one of the
	 * identity's documents it resumes syncing; otherwise `options.unmatched` says what to do with it.
	 */
	signIn(options: SignInOptions = {}): Promise<SignInOutcome> {
		return this.tasks.run(async () => {
			const { api, passkeys } = this.settings;
			const key = await DeviceKey.generate();
			const start = await api.startSignIn(key.publicKey);
			const result = await api.finishSignIn(start.ceremonyId, await passkeys.authenticate(start.options));
			const previous = this.account;
			await this.setAccount({ identityId: result.identityId, key });
			if (previous !== undefined) {
				// The old key is likely already revoked or lost; this only tidies up if it isn't.
				void api.signOut(previous.key).catch(() => undefined);
			}
			const { identityId, documents } = result;
			const bound = this.binding;
			if (bound !== undefined && documents.some((document) => document.id === bound.documentId)) {
				this.startSync();
				return { identityId, documents, result: "resumed" };
			}
			await this.detach();
			if (options.unmatched === "choose") {
				return { identityId, documents, result: "detached" };
			}
			const latest = mostRecentlyUsed(documents);
			if (latest === undefined) {
				return { identityId, documents: [await this.createFromLocal()], result: "created" };
			}
			await this.mergeInto(latest, options.resolve);
			return { identityId, documents, result: "merged" };
		});
	}

	listDocuments(): Promise<DocumentInfo[]> {
		return this.tasks.run(() => this.settings.api.listDocuments(this.requireAccount().key));
	}

	/** Creates a new document from the working copy and syncs with it. Also how to keep local data separately. */
	createDocumentFromLocal(): Promise<DocumentInfo> {
		return this.tasks.run(() => this.createFromLocal());
	}

	/**
	 * Copies the working copy into an existing document (see `mergeDocuments`) and switches to it. If the
	 * working copy already belongs to that document, syncing merges them exactly instead.
	 */
	mergeLocalInto(documentId: string, resolve?: ConflictResolver): Promise<void> {
		return this.tasks.run(async () => {
			if (this.binding?.documentId === documentId) {
				this.startSync();
				return;
			}
			await this.mergeInto(await this.findDocument(documentId), resolve);
		});
	}

	/** Switches to an existing document, discarding the working copy. */
	useRemote(documentId: string): Promise<void> {
		return this.tasks.run(async () => {
			const { epoch } = await this.findDocument(documentId);
			await this.switchTo({ documentId, epoch });
		});
	}

	/** Revokes every other device key of this identity, with a passkey prompt. Returns how many were revoked. */
	revokeOtherDevices(): Promise<number> {
		return this.tasks.run(async () => {
			const { api, passkeys } = this.settings;
			const { key } = this.requireAccount();
			const me = await api.me(key);
			const others = me.deviceKeys.map((device) => device.publicKey).filter((publicKey) => publicKey !== key.publicKey);
			if (others.length === 0) {
				return 0;
			}
			const start = await api.startRevocation(others);
			const result = await api.finishRevocation(start.ceremonyId, await passkeys.authenticate(start.options));
			return result.revoked;
		});
	}

	/**
	 * Signs this device out and deletes its working copy, starting over with an empty local doc. Edits that
	 * haven't reached the service yet are lost.
	 */
	signOut(): Promise<void> {
		return this.tasks.run(async () => {
			this.stopSync();
			const account = this.account;
			if (account !== undefined) {
				await this.settings.api.signOut(account.key).catch(() => undefined);
			}
			this.account = undefined;
			this.needsSignIn = false;
			await this.state.save("identity", undefined);
			await this.setBinding(undefined);
			await this.replace(await Replica.create(this.settings.prefix));
			this.events.emit("identity", this.identity);
			this.setSyncStatus("local");
		});
	}

	/** Stops syncing, tears down bindings and releases the working copy. The client can't be used afterwards. */
	close(): Promise<void> {
		return this.tasks.run(async () => {
			this.stopSync();
			for (const binding of this.docBindings) {
				binding.teardown?.();
			}
			this.docBindings.clear();
			await this.replica.close();
			this.state.close();
		});
	}

	private async createFromLocal(): Promise<DocumentInfo> {
		const { key } = this.requireAccount();
		const initialState = toBase64Url(Y.encodeStateAsUpdate(this.replica.doc));
		const created = await this.settings.api.createDocument(key, initialState);
		await this.setBinding({ documentId: created.id, epoch: created.epoch });
		this.startSync();
		return created;
	}

	private async mergeInto(document: DocumentInfo, resolve: ConflictResolver | undefined): Promise<void> {
		const local = this.replica.doc;
		await this.switchTo({ documentId: document.id, epoch: document.epoch }, (doc) => {
			mergeDocuments(local, doc, this.settings.roots, resolve);
		});
	}

	private async findDocument(documentId: string): Promise<DocumentInfo> {
		const documents = await this.settings.api.listDocuments(this.requireAccount().key);
		const document = documents.find((candidate) => candidate.id === documentId);
		if (document === undefined) {
			throw new Error(`no document ${documentId}`);
		}
		return document;
	}

	/**
	 * Makes a fresh replica of `binding`'s document the working copy: syncs it from the service, lets `prepare`
	 * add to it (its edits go to the service), then replaces the old working copy. If syncing fails, the old
	 * working copy stays and resumes syncing.
	 */
	private async switchTo(binding: DocumentBinding, prepare?: (doc: Y.Doc) => void): Promise<void> {
		const account = this.requireAccount();
		this.stopSync();
		const next = await Replica.create(this.settings.prefix);
		const provider = this.createProvider(next.doc, binding, account);
		try {
			await provider.whenSynced(switchTimeoutMs);
		} catch (error) {
			provider.destroy();
			next.discard();
			this.startSync();
			throw error;
		}
		prepare?.(next.doc);
		await this.setBinding(binding);
		await this.replace(next);
		this.provider = provider;
		this.setSyncStatus(provider.currentStatus);
	}

	private async replace(next: Replica): Promise<void> {
		const previous = this.replica;
		this.replica = next;
		await this.state.save("replica", next.name);
		for (const binding of this.docBindings) {
			this.guard(() => binding.teardown?.());
			binding.teardown = undefined;
		}
		previous.discard();
		this.events.emit("doc", next.doc);
		for (const binding of this.docBindings) {
			this.guard(() => {
				binding.teardown = binding.setup(next.doc);
			});
		}
	}

	/** Runs site code during a replacement, reporting a throw as "error" so one binding can't stop the rest. */
	private guard(run: () => void): void {
		try {
			run();
		} catch (error) {
			this.events.emit("error", error);
		}
	}

	private startSync(): void {
		this.stopSync();
		if (this.binding === undefined) {
			this.setSyncStatus("local");
			return;
		}
		if (this.account === undefined || this.needsSignIn) {
			this.setSyncStatus("stopped");
			return;
		}
		this.provider = this.createProvider(this.replica.doc, this.binding, this.account);
		this.setSyncStatus(this.provider.currentStatus);
	}

	private stopSync(): void {
		this.provider?.destroy();
		this.provider = undefined;
	}

	/** Status and stop events only count while the provider is the current one. */
	private createProvider(doc: Y.Doc, binding: DocumentBinding, account: Account): SyncProvider {
		const { api, WebSocket, reconnect, batchMs } = this.settings;
		const provider: SyncProvider = new SyncProvider(
			{
				url: api.syncUrl(binding.documentId),
				documentId: binding.documentId,
				epoch: binding.epoch,
				doc,
				signer: account.key,
				WebSocket,
				batchMs,
				...(reconnect === undefined ? {} : { backoff: reconnect }),
			},
			{
				onStatus: (status) => {
					if (this.provider === provider) {
						this.setSyncStatus(status);
					}
				},
				onStopped: (reason) => {
					void this.tasks
						.run(() => (this.provider === provider ? this.handleStopped(reason) : Promise.resolve()))
						.catch((error: unknown) => {
							this.events.emit("error", error);
						});
				},
			},
		);
		return provider;
	}

	private async handleStopped(reason: StopReason): Promise<void> {
		this.provider = undefined;
		switch (reason.kind) {
			case "unauthorized":
				this.needsSignIn = true;
				this.events.emit("identity", this.identity);
				return;
			case "gone":
				// Keep the data: the site can create a new document from it.
				await this.setBinding(undefined);
				this.setSyncStatus("local");
				return;
			case "epoch-changed":
				await this.recoverEpoch(reason.epoch);
				return;
			case "rejected": {
				this.events.emit("rejected", reason.reason);
				const binding = this.requireBinding();
				await this.switchTo(binding);
				return;
			}
			case "failed":
				this.events.emit("error", new Error(`sync failed: ${reason.message}`));
				return;
		}
	}

	/**
	 * The document was rebuilt into `epoch`, so the working copy can't sync with it anymore. Switches to the new
	 * epoch and re-applies the working copy's unsynced edits and deletions there, per top-level key.
	 */
	private async recoverEpoch(epoch: number): Promise<void> {
		const binding = this.requireBinding();
		const { key } = this.requireAccount();
		const archive = await this.settings.api
			.epochArchive(key, binding.documentId, binding.epoch)
			.catch((error: unknown) => {
				// Without the archive there's no telling which edits are unsynced; the new epoch's state wins.
				if (error instanceof SinkApiError && error.kind === "not_found") {
					return undefined;
				}
				throw error;
			});
		const stale = this.replica.doc;
		await this.switchTo({ documentId: binding.documentId, epoch }, (doc) => {
			if (archive !== undefined) {
				const server = Y.decodeSnapshot(fromBase64Url(archive.finalSnapshot));
				copyChanges(stale, doc, unsyncedChanges(stale, server), this.settings.roots);
			}
		});
	}

	private async setAccount(account: Account): Promise<void> {
		this.account = account;
		this.needsSignIn = false;
		await this.state.save("identity", { identityId: account.identityId, keyPair: account.key.keyPair });
		this.events.emit("identity", this.identity);
	}

	/** Detaches the working copy from its document, keeping its data. */
	private async detach(): Promise<void> {
		this.stopSync();
		await this.setBinding(undefined);
		this.setSyncStatus("local");
	}

	private async setBinding(binding: DocumentBinding | undefined): Promise<void> {
		if (this.binding?.documentId === binding?.documentId && this.binding?.epoch === binding?.epoch) {
			return;
		}
		this.binding = binding;
		await this.state.save("binding", binding);
		this.events.emit("document", binding);
	}

	private setSyncStatus(status: ClientSyncStatus): void {
		if (this.syncStatus !== status) {
			this.syncStatus = status;
			this.events.emit("sync", status);
		}
	}

	private requireAccount(): Account {
		if (this.account === undefined) {
			throw new Error("not signed in");
		}
		return this.account;
	}

	private requireBinding(): DocumentBinding {
		if (this.binding === undefined) {
			throw new Error("no document");
		}
		return this.binding;
	}
}

function mostRecentlyUsed(documents: DocumentInfo[]): DocumentInfo | undefined {
	return documents.reduce<DocumentInfo | undefined>(
		(latest, document) =>
			latest === undefined || Date.parse(document.lastUsedAt) > Date.parse(latest.lastUsedAt) ? document : latest,
		undefined,
	);
}

/** Asks the browser not to evict this site's storage, where supported. Device keys live there. */
function requestPersistentStorage(): void {
	const storage = (globalThis.navigator as Partial<Navigator> | undefined)?.storage;
	if (typeof storage?.persist === "function") {
		void storage.persist().catch(() => undefined);
	}
}
