/** Runs async tasks one at a time, in the order they were queued. */
export class TaskQueue {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task);
		this.tail = result.catch(() => undefined);
		return result;
	}
}
