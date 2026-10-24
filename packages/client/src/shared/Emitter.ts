type Listener<T> = (value: T) => void;

/** A minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
	private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

	/** Adds a listener; returns a function that removes it. */
	on<Name extends keyof Events>(name: Name, listener: Listener<Events[Name]>): () => void {
		let set = this.listeners.get(name);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(name, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	emit<Name extends keyof Events>(name: Name, value: Events[Name]): void {
		for (const listener of this.listeners.get(name) ?? []) {
			(listener as Listener<Events[Name]>)(value);
		}
	}
}
