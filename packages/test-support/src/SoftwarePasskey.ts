import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Encoder } from "cbor-x";

const cbor = new Encoder({ mapsAsObjects: false, useRecords: false, tagUint8Array: false });

const flags = { userPresent: 0x01, userVerified: 0x04, backupEligible: 0x08, backedUp: 0x10, attested: 0x40 };

/** An ES256 passkey implemented in software, standing in for a browser authenticator. */
export class SoftwarePasskey {
	readonly credentialId = randomBytes(16);
	private readonly privateKey: KeyObject;
	private readonly publicKey: KeyObject;
	private userHandle: Uint8Array | undefined;

	constructor(
		readonly rpId: string,
		readonly origin: string,
	) {
		({ privateKey: this.privateKey, publicKey: this.publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }));
	}

	get id(): string {
		return toBase64Url(this.credentialId);
	}

	register(options: PublicKeyCredentialCreationOptionsJSON): RegistrationResponseJSON {
		this.userHandle = Buffer.from(options.user.id, "base64url");
		const clientData = this.clientData("webauthn.create", options.challenge);
		const credentialIdLength = Buffer.alloc(2);
		credentialIdLength.writeUInt16BE(this.credentialId.byteLength);
		const authenticatorData = Buffer.concat([
			this.authenticatorDataPrefix(flags.userPresent | flags.userVerified | flags.backupEligible | flags.attested),
			Buffer.alloc(16), // AAGUID
			credentialIdLength,
			this.credentialId,
			this.cosePublicKey(),
		]);
		const attestationObject = cbor.encode(
			new Map<string, unknown>([
				["fmt", "none"],
				["attStmt", new Map()],
				["authData", authenticatorData],
			]),
		);
		return {
			id: this.id,
			rawId: this.id,
			type: "public-key",
			response: {
				clientDataJSON: toBase64Url(clientData),
				attestationObject: toBase64Url(attestationObject),
				transports: ["internal"],
			},
			clientExtensionResults: {},
		};
	}

	/** Signs an assertion. `userHandle` overrides the stored one, to simulate a forged assertion. */
	assert(
		options: PublicKeyCredentialRequestOptionsJSON,
		overrides: { userHandle?: Uint8Array; origin?: string } = {},
	): AuthenticationResponseJSON {
		const userHandle = overrides.userHandle ?? this.userHandle;
		if (userHandle === undefined) {
			throw new Error("passkey was never registered");
		}
		const clientData = this.clientData("webauthn.get", options.challenge, overrides.origin);
		const authenticatorData = this.authenticatorDataPrefix(
			flags.userPresent | flags.userVerified | flags.backupEligible,
		);
		const signature = sign(
			"sha256",
			Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]),
			this.privateKey,
		);
		return {
			id: this.id,
			rawId: this.id,
			type: "public-key",
			response: {
				clientDataJSON: toBase64Url(clientData),
				authenticatorData: toBase64Url(authenticatorData),
				signature: toBase64Url(signature),
				userHandle: toBase64Url(userHandle),
			},
			clientExtensionResults: {},
		};
	}

	private clientData(type: string, challenge: string, origin = this.origin): Buffer {
		return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
	}

	private authenticatorDataPrefix(flagBits: number): Buffer {
		return Buffer.concat([
			createHash("sha256").update(this.rpId).digest(),
			Buffer.from([flagBits]),
			Buffer.alloc(4), // signature counter; synced passkeys always report 0
		]);
	}

	private cosePublicKey(): Buffer {
		const jwk = this.publicKey.export({ format: "jwk" });
		return cbor.encode(
			new Map<number, unknown>([
				[1, 2], // kty: EC2
				[3, -7], // alg: ES256
				[-1, 1], // crv: P-256
				[-2, Buffer.from(jwk.x ?? "", "base64url")],
				[-3, Buffer.from(jwk.y ?? "", "base64url")],
			]),
		);
	}
}

function toBase64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}
