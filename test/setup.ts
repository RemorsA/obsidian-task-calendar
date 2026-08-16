import { MarkdownRenderer, Notice } from './mocks/obsidian';
import { beforeEach } from 'vitest';

/**
 * Obsidian расширяет прототипы DOM своими хелперами. Компоненту и view нужен
 * только empty(), остальное не полифилим намеренно - чтобы не прятать
 * случайное использование недоступного в тестах API.
 */
if (!('empty' in Element.prototype)) {
	Object.defineProperty(Element.prototype, 'empty', {
		value(this: Element) {
			while (this.firstChild) this.removeChild(this.firstChild);
		},
		writable: true,
		configurable: true,
	});
}

beforeEach(() => {
	Notice.messages.length = 0;
	MarkdownRenderer.calls.length = 0;
});
