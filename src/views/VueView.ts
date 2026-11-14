import { ItemView, WorkspaceLeaf } from 'obsidian';
import { App as VueApp, Component, createApp } from 'vue';
import type TaskCalendarPlugin from '../TaskCalendarPlugin';

/**
 * Представление Obsidian, тело которого - Vue-компонент с плагином в свойствах.
 * Монтируется в `containerEl.children[1]` при открытии, размонтируется при
 * закрытии.
 */
export abstract class VueView extends ItemView {
	plugin: TaskCalendarPlugin;
	private vueApp: VueApp | null = null;

	protected abstract readonly component: Component;

	constructor(leaf: WorkspaceLeaf, plugin: TaskCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	async onOpen() {
		await Promise.resolve();
		const container = this.containerEl.children[1];
		container.empty();

		const vueContainer = document.createElement('div');
		container.appendChild(vueContainer);

		this.vueApp = createApp(this.component, {
			plugin: this.plugin,
		});
		this.vueApp.mount(vueContainer);
	}

	async onClose() {
		await Promise.resolve();
		if (this.vueApp) {
			this.vueApp.unmount();
			this.vueApp = null;
		}
	}
}
