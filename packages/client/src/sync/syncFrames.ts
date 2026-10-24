import { messageSync } from "@bobs-sink/protocol";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

export type SyncFrame = { syncType: number; payload: Uint8Array };

export function encodeSyncFrame(syncType: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, messageSync);
	encoding.writeVarUint(encoder, syncType);
	encoding.writeVarUint8Array(encoder, payload);
	return encoding.toUint8Array(encoder);
}

/** Decodes a binary frame; undefined if it isn't a sync message. */
export function decodeSyncFrame(bytes: Uint8Array): SyncFrame | undefined {
	const decoder = decoding.createDecoder(bytes);
	if (decoding.readVarUint(decoder) !== messageSync) {
		return undefined;
	}
	const syncType = decoding.readVarUint(decoder);
	return { syncType, payload: decoding.readVarUint8Array(decoder) };
}
