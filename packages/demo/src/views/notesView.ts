import * as Y from "yjs";

/**
 * Two-way binding between a textarea and a Y.Text. Local input becomes the minimal delete and insert; remote
 * changes update the textarea and shift the selection past them. Returns a function that stops.
 */
export function bindNotes(textarea: HTMLTextAreaElement, text: Y.Text): () => void {
	const origin = Symbol("textarea");
	textarea.value = text.toJSON();

	const onInput = () => {
		const current = text.toJSON();
		const next = textarea.value;
		let start = 0;
		while (start < current.length && start < next.length && current[start] === next[start]) {
			start++;
		}
		let currentEnd = current.length;
		let nextEnd = next.length;
		while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
			currentEnd--;
			nextEnd--;
		}
		text.doc?.transact(() => {
			if (currentEnd > start) {
				text.delete(start, currentEnd - start);
			}
			if (nextEnd > start) {
				text.insert(start, next.slice(start, nextEnd));
			}
		}, origin);
	};

	const onChange = (event: Y.YTextEvent, transaction: Y.Transaction) => {
		if (transaction.origin === origin) {
			return;
		}
		let selectionStart = textarea.selectionStart;
		let selectionEnd = textarea.selectionEnd;
		let index = 0;
		for (const change of event.delta) {
			if (change.retain !== undefined) {
				index += change.retain;
			} else if (change.insert !== undefined) {
				const length = typeof change.insert === "string" ? change.insert.length : 1;
				selectionStart += index <= selectionStart ? length : 0;
				selectionEnd += index <= selectionEnd ? length : 0;
				index += length;
			} else if (change.delete !== undefined) {
				selectionStart -= Math.max(0, Math.min(change.delete, selectionStart - index));
				selectionEnd -= Math.max(0, Math.min(change.delete, selectionEnd - index));
			}
		}
		textarea.value = text.toJSON();
		textarea.setSelectionRange(selectionStart, selectionEnd);
	};

	textarea.addEventListener("input", onInput);
	text.observe(onChange);
	return () => {
		textarea.removeEventListener("input", onInput);
		text.unobserve(onChange);
	};
}
