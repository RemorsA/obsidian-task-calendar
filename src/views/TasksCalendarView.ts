import { ItemView, WorkspaceLeaf } from 'obsidian';
import { App as VueApp, createApp } from 'vue';
import TasksCalendarPlugin from '../../main';
import TasksCalendar from '../components/TasksCalendar.vue';

export class TasksCalendarView extends ItemView {
	plugin: TasksCalendarPlugin;
	private vueApp: VueApp | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TasksCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return 'tasks-calendar';
	}

	getDisplayText(): string {
		return 'Tasks calendar';
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
		
		this.vueApp = await createApp(TasksCalendar, {
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

