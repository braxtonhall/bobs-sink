/** A sync connection that can be closed from outside, e.g. when its device key is revoked. */
export type ClosableSession = {
	closeUnauthorized(): void;
};

/** Tracks open sync sessions by device key. */
export class ActiveSessions {
	private readonly byDeviceKey = new Map<string, Set<ClosableSession>>();

	add(deviceKey: string, session: ClosableSession): () => void {
		const sessions = this.byDeviceKey.get(deviceKey) ?? new Set();
		sessions.add(session);
		this.byDeviceKey.set(deviceKey, sessions);
		return () => {
			sessions.delete(session);
			if (sessions.size === 0) {
				this.byDeviceKey.delete(deviceKey);
			}
		};
	}

	closeForDeviceKeys(deviceKeys: readonly string[]): void {
		for (const deviceKey of deviceKeys) {
			for (const session of [...(this.byDeviceKey.get(deviceKey) ?? [])]) {
				session.closeUnauthorized();
			}
		}
	}
}
