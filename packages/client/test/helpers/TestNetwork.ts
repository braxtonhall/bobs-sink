import type { WebSocketConstructor } from "../../src/sync/SyncConnection.js";

const unreachable = "ws://127.0.0.1:9";

/** A device's network connection, which tests can take down and bring back. */
export class TestNetwork {
	readonly WebSocket: WebSocketConstructor;
	private online = true;
	private readonly sockets = new Set<WebSocket>();

	constructor() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- the socket class needs the network
		const network = this;
		this.WebSocket = class extends WebSocket {
			constructor(url: string) {
				super(network.online ? url : unreachable);
				network.sockets.add(this);
				this.addEventListener("close", () => network.sockets.delete(this));
			}
		};
	}

	goOffline(): void {
		this.online = false;
		for (const socket of this.sockets) {
			socket.close();
		}
	}

	goOnline(): void {
		this.online = true;
	}
}
