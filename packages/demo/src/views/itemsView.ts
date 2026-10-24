import * as Y from "yjs";
import { button, element } from "../dom.js";

type Item = { text: string; at: number };

/** Shows and edits the `items` map of `doc`. Returns a function that stops. */
export function bindItems(list: HTMLUListElement, form: HTMLFormElement, doc: Y.Doc): () => void {
	const items = doc.getMap<Item>("items");
	const render = () => {
		const sorted = [...items.entries()].sort(([, a], [, b]) => a.at - b.at);
		list.replaceChildren(
			...sorted.map(([id, item]) =>
				element("li", {}, [
					element("span", { textContent: item.text }),
					button("Remove", () => {
						items.delete(id);
					}),
				]),
			),
		);
		if (sorted.length === 0) {
			list.replaceChildren(element("li", { className: "hint", textContent: "No items yet." }));
		}
	};
	const onSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const input = form.elements.namedItem("text") as HTMLInputElement;
		items.set(crypto.randomUUID(), { text: input.value, at: Date.now() });
		input.value = "";
	};
	form.addEventListener("submit", onSubmit);
	items.observe(render);
	render();
	return () => {
		form.removeEventListener("submit", onSubmit);
		items.unobserve(render);
	};
}
