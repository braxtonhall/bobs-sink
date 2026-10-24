import { createHash } from "node:crypto";
import type { Clock } from "../shared/clock.js";
import { toBase64Url } from "../shared/base64url.js";
import { ExpiringMap } from "../shared/ExpiringMap.js";
import { SinkError } from "../shared/errors.js";
import type { DeviceAuthority, DeviceKeyRepository } from "./DeviceKeyRepository.js";
import { verifyEd25519 } from "./ed25519.js";
import { requestSigningMessage } from "@bobs-sink/protocol";

/** How far a request's timestamp may be from the server's clock. */
const maxClockSkewMs = 5 * 60_000;

export type SignedRequest = {
	method: string;
	pathAndQuery: string;
	body: Uint8Array;
	key: string | undefined;
	timestamp: string | undefined;
	nonce: string | undefined;
	signature: string | undefined;
};

/** Authenticates HTTP requests signed by an authorized device key, rejecting replays. */
export class RequestVerifier {
	private readonly seenNonces: ExpiringMap<string, true>;

	constructor(
		private readonly deviceKeys: DeviceKeyRepository,
		private readonly clock: Clock,
	) {
		// A nonce only needs remembering while its timestamp could still be accepted.
		this.seenNonces = new ExpiringMap(2 * maxClockSkewMs, clock);
	}

	verify(request: SignedRequest): DeviceAuthority {
		const { key, timestamp, nonce, signature } = request;
		if (key === undefined || timestamp === undefined || nonce === undefined || signature === undefined) {
			throw new SinkError("unauthorized", "missing request signature");
		}
		if (!/^\d{1,16}$/.test(timestamp) || Math.abs(Number(timestamp) - this.clock.now().getTime()) > maxClockSkewMs) {
			throw new SinkError("unauthorized", "request timestamp out of range");
		}
		if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
			throw new SinkError("unauthorized", "invalid request nonce");
		}
		const message = requestSigningMessage({
			method: request.method,
			pathAndQuery: request.pathAndQuery,
			timestamp,
			nonce,
			bodySha256: toBase64Url(createHash("sha256").update(request.body).digest()),
		});
		if (!verifyEd25519(key, message, signature)) {
			throw new SinkError("unauthorized", "invalid request signature");
		}
		const replayKey = `${key}:${nonce}`;
		if (this.seenNonces.has(replayKey)) {
			throw new SinkError("unauthorized", "request replayed");
		}
		const authority = this.deviceKeys.findAuthority(key);
		if (authority === undefined) {
			throw new SinkError("unauthorized", "device key not authorized");
		}
		this.seenNonces.set(replayKey, true);
		this.deviceKeys.touch(key, this.clock.now());
		return authority;
	}
}
