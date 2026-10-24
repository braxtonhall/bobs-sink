import { toBase64Url } from "../shared/base64url.js";

const algorithm = { name: "Ed25519" } as const;

/** Signs requests and sync connections on behalf of a device. */
export type DeviceSigner = {
	/** base64url raw Ed25519 public key. */
	readonly publicKey: string;
	/** Signs the UTF-8 bytes of `message`; returns a base64url signature. */
	sign(message: string): Promise<string>;
};

/**
 * This browser's Ed25519 key pair. The private key is non-extractable: it can be stored in IndexedDB and used to
 * sign, but script can never read it.
 */
export class DeviceKey implements DeviceSigner {
	private constructor(
		readonly keyPair: CryptoKeyPair,
		readonly publicKey: string,
	) {}

	static async generate(): Promise<DeviceKey> {
		const keyPair = await crypto.subtle.generateKey(algorithm, false, ["sign", "verify"]);
		return DeviceKey.fromKeyPair(keyPair);
	}

	static async fromKeyPair(keyPair: CryptoKeyPair): Promise<DeviceKey> {
		const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
		return new DeviceKey(keyPair, toBase64Url(new Uint8Array(raw)));
	}

	async sign(message: string): Promise<string> {
		const signature = await crypto.subtle.sign(algorithm, this.keyPair.privateKey, new TextEncoder().encode(message));
		return toBase64Url(new Uint8Array(signature));
	}
}
