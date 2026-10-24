export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
	const found = document.getElementById(id);
	if (!(found instanceof type)) {
		throw new Error(`missing #${id}`);
	}
	return found;
}

/** Creates an element with text or children. */
export function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
	const created = Object.assign(document.createElement(tag), props);
	created.append(...children);
	return created;
}

export function button(label: string, onClick: () => void, props: Partial<HTMLButtonElement> = {}): HTMLButtonElement {
	return element("button", { type: "button", textContent: label, onclick: onClick, ...props });
}
