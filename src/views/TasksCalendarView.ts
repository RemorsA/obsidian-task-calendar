import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createApp } from 'vue';
import TasksCalendarPlugin from '../../main';
import TasksCalendar from '../components/TasksCalendar.vue';

export class TasksCalendarView extends ItemView {
	plugin: TasksCalendarPlugin;
	private vueApp: any = null;

	constructor(leaf: WorkspaceLeaf, plugin: TasksCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return 'tasks-calendar-view';
	}

	getDisplayText(): string {
		return 'Tasks Calendar';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		const vueContainer = document.createElement('div');
		container.appendChild(vueContainer);
		
		this.vueApp = createApp(TasksCalendar, {
			plugin: this.plugin,
		});
		this.vueApp.mount(vueContainer);
	}

	async onClose() {
		if (this.vueApp) {
			this.vueApp.unmount();
			this.vueApp = null;
		}
	}
}

