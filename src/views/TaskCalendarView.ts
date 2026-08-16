import { ItemView, WorkspaceLeaf } from 'obsidian';
import { App as VueApp, createApp } from 'vue';
import TaskCalendar from '../components/TaskCalendar.vue';
import type TaskCalendarPlugin from '../TaskCalendarPlugin';
import { VIEW_TYPE_TASK_CALENDAR } from '../types';

export class TaskCalendarView extends ItemView {
	plugin: TaskCalendarPlugin;
	private vueApp: VueApp | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TaskCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_CALENDAR;
	}

	getDisplayText(): string {
		return 'Task calendar';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen() {
		await Promise.resolve();
		const container = this.containerEl.children[1];
		container.empty();

		const vueContainer = document.createElement('div');
		container.appendChild(vueContainer);

		this.vueApp = await createApp(TaskCalendar, {
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
