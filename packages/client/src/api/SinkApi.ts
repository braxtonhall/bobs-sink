import type {
	CeremonyStart,
	CreateDocumentBody,
	DocumentInfo,
	DocumentListResult,
	EpochArchiveResult,
	MeResult,
	RegistrationResult,
	RegistrationStartBody,
	RevocationResult,
	RevocationStartBody,
	SignInResult,
	SignInStartBody,
} from "@bobs-sink/protocol";
import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { DeviceSigner } from "../identity/DeviceKey.js";
import { signedHeaders } from "./signedHeaders.js";
import { SinkApiError } from "./SinkApiError.js";

export type Fetch = typeof fetch;

/** Typed calls to the service's HTTP API. Unsigned calls are passkey ceremonies; the rest are device-signed. */
export class SinkApi {
	constructor(
		private readonly serviceUrl: string,
		private readonly app: string,
		private readonly fetchFn: Fetch,
	) {}

	/** The WebSocket URL for syncing one document. */
	syncUrl(documentId: string): string {
		return `${this.serviceUrl.replace(/^http/, "ws")}/v1/sync/${encodeURIComponent(documentId)}`;
	}

	startRegistration(deviceKey: string, userName?: string) {
		const body: RegistrationStartBody = { app: this.app, deviceKey, ...(userName === undefined ? {} : { userName }) };
		return this.unsigned<CeremonyStart<PublicKeyCredentialCreationOptionsJSON>>("/v1/registrations", body);
	}

	finishRegistration(ceremonyId: string, response: RegistrationResponseJSON) {
		return this.unsigned<RegistrationResult>(`/v1/registrations/${ceremonyId}`, { response });
	}

	startSignIn(deviceKey: string) {
		const body: SignInStartBody = { app: this.app, deviceKey };
		return this.unsigned<CeremonyStart<PublicKeyCredentialRequestOptionsJSON>>("/v1/sign-ins", body);
	}

	finishSignIn(ceremonyId: string, response: AuthenticationResponseJSON) {
		return this.unsigned<SignInResult>(`/v1/sign-ins/${ceremonyId}`, { response });
	}

	startRevocation(deviceKeys: string[]) {
		const body: RevocationStartBody = { app: this.app, deviceKeys };
		return this.unsigned<CeremonyStart<PublicKeyCredentialRequestOptionsJSON>>("/v1/revocations", body);
	}

	finishRevocation(ceremonyId: string, response: AuthenticationResponseJSON) {
		return this.unsigned<RevocationResult>(`/v1/revocations/${ceremonyId}`, { response });
	}

	me(signer: DeviceSigner) {
		return this.signed<MeResult>(signer, "GET", "/v1/me");
	}

	signOut(signer: DeviceSigner) {
		return this.signed<undefined>(signer, "DELETE", "/v1/me/device-key");
	}

	async listDocuments(signer: DeviceSigner): Promise<DocumentInfo[]> {
		return (await this.signed<DocumentListResult>(signer, "GET", "/v1/documents")).documents;
	}

	/** `initialState` is a base64url Yjs update. */
	createDocument(signer: DeviceSigner, initialState?: string) {
		const body: CreateDocumentBody = initialState === undefined ? {} : { initialState };
		return this.signed<DocumentInfo>(signer, "POST", "/v1/documents", body);
	}

	deleteDocument(signer: DeviceSigner, documentId: string) {
		return this.signed<undefined>(signer, "DELETE", `/v1/documents/${encodeURIComponent(documentId)}`);
	}

	epochArchive(signer: DeviceSigner, documentId: string, epoch: number) {
		const path = `/v1/documents/${encodeURIComponent(documentId)}/epochs/${epoch}`;
		return this.signed<EpochArchiveResult>(signer, "GET", path);
	}

	private unsigned<T>(path: string, body: unknown): Promise<T> {
		return this.send<T>(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	private async signed<T>(signer: DeviceSigner, method: string, path: string, body?: unknown): Promise<T> {
		const text = body === undefined ? "" : JSON.stringify(body);
		const headers = await signedHeaders(signer, { method, pathAndQuery: path, body: text });
		return this.send<T>(path, {
			method,
			headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
			...(body === undefined ? {} : { body: text }),
		});
	}

	private async send<T>(path: string, init: RequestInit): Promise<T> {
		const response = await this.fetchFn(this.serviceUrl + path, init);
		if (!response.ok) {
			throw await SinkApiError.fromResponse(response);
		}
		return (response.status === 204 ? undefined : await response.json()) as T;
	}
}
