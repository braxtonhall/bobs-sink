const storeName = "values";

/** One IndexedDB database holding a single key-value object store. Values are stored by structured clone. */
export class KeyValueStore {
	private constructor(private readonly db: IDBDatabase) {}

	static open(name: string): Promise<KeyValueStore> {
		const request = indexedDB.open(name, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(storeName);
		};
		return settle(request).then((db) => new KeyValueStore(db));
	}

	async get<T>(key: string): Promise<T | undefined> {
		return (await settle(this.transaction("readonly").get(key))) as T | undefined;
	}

	async set(key: string, value: unknown): Promise<void> {
		await settle(this.transaction("readwrite").put(value, key));
	}

	async delete(key: string): Promise<void> {
		await settle(this.transaction("readwrite").delete(key));
	}

	close(): void {
		this.db.close();
	}

	private transaction(mode: IDBTransactionMode): IDBObjectStore {
		return this.db.transaction(storeName, mode).objectStore(storeName);
	}
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => {
			resolve(request.result);
		};
		request.onerror = () => {
			reject(request.error ?? new Error("IndexedDB request failed"));
		};
	});
}
