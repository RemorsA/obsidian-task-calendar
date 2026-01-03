import { Plugin } from 'obsidian';
import { TasksCalendarSettings, DEFAULT_SETTINGS, TasksCalendarSettingTab } from './src/settings';
import { t } from './src/locales';
import { TasksCalendarView } from './src/views/TasksCalendarView';

export default class TasksCalendarPlugin extends Plugin {
	settings: TasksCalendarSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new TasksCalendarSettingTab(this.app, this));

		this.registerView(
			'tasks-calendar-view',
			(leaf) => new TasksCalendarView(leaf, this)
		);

		this.addCommand({
			id: 'open-task-calendar',
			name: t(this.settings.language || 'en', 'openTaskCalendar'),
			callback: async () => {
				await this.openCalendar();
			}
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType('tasks-calendar-view');
	}

	async openCalendar() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType('tasks-calendar-view');

		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
		} else {
			const rightLeaf = workspace.getRightLeaf(false);

			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: 'tasks-calendar-view',
					active: true,
				});
			}
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData() as any;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
