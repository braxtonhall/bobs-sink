/** Polls until `condition` holds, failing after `timeoutMs`. */
export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
