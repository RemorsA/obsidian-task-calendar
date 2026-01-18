import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TasksCalendarSettings, DEFAULT_SETTINGS, TasksCalendarSettingTab } from './src/settings';
import { t } from './src/locales';
import { TasksCalendarView } from './src/views/TasksCalendarView';

export default class TasksCalendarPlugin extends Plugin {
	settings: TasksCalendarSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new TasksCalendarSettingTab(this.app, this));

		this.registerView(
			'tasks-calendar',
			(leaf) => new TasksCalendarView(leaf, this)
		);

		this.addCommand({
			id: 'open-task-calendar',
			name: t(this.settings.language || 'en', 'openTaskCalendar'),
			callback: async () => {
				await this.openCalendar();
			}
		});

		if (this.settings.openOnStartup) {
			this.app.workspace.onLayoutReady(async () => {
				await this.openCalendar();
			});
		}
	}

	onunload() {}

	async openCalendar() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType('tasks-calendar');

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({
				type: 'tasks-calendar',
				active: true,
			});
		}

		if (leaf) {
			workspace.setActiveLeaf(leaf);
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData() as Partial<TasksCalendarSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
