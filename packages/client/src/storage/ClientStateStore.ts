import { KeyValueStore } from "./KeyValueStore.js";

/** The document this device's working copy belongs to, and the epoch its state came from. */
export type DocumentBinding = { documentId: string; epoch: number };

/** An identity this device is signed in as, with the device key it authorized. */
export type StoredIdentity = { identityId: string; keyPair: CryptoKeyPair };

export type ClientState = {
	identity?: StoredIdentity;
	binding?: DocumentBinding;
	/** Name of the IndexedDB database holding the working copy. */
	replica?: string;
};

const keys = ["identity", "binding", "replica"] as const satisfies readonly (keyof ClientState)[];

/** The client's durable state on this device, in IndexedDB. */
export class ClientStateStore {
	private constructor(private readonly store: KeyValueStore) {}

	static async open(name: string): Promise<ClientStateStore> {
		return new ClientStateStore(await KeyValueStore.open(name));
	}

	async load(): Promise<ClientState> {
		const state: ClientState = {};
		for (const key of keys) {
			const value = await this.store.get(key);
			if (value !== undefined) {
				Object.assign(state, { [key]: value });
			}
		}
		return state;
	}

	/** Saves one field; undefined removes it. */
	save<Key extends keyof ClientState>(key: Key, value: ClientState[Key]): Promise<void> {
		return value === undefined ? this.store.delete(key) : this.store.set(key, value);
	}

	close(): void {
		this.store.close();
	}
}
