/** The part of a WebSocket a sync session needs. */
export type SyncSocket = {
	send(data: string | Uint8Array<ArrayBuffer>): void;
	close(code: number, reason?: string): void;
};
