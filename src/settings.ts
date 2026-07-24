import { App, PluginSettingTab, Setting } from 'obsidian';
import TasksCalendarPlugin from '../main';
import { TasksCalendarSettings } from './types';

export type { TasksCalendarSettings };

export const DEFAULT_SETTINGS: TasksCalendarSettings = {
	tasksFolderPath: '/',
	filenameFormat: 'YYYY',
	openOnStartup: true,
};

export class TasksCalendarSettingTab extends PluginSettingTab {
	plugin: TasksCalendarPlugin;

	constructor(app: App, plugin: TasksCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Открывать при запуске')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.openOnStartup)
				.onChange(async (value) => {
					this.plugin.settings.openOnStartup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Путь к папке с задачами')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.tasksFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Формат даты для заголовка файла')
			.addText(text => text
				.setPlaceholder('YYYY')
				.setValue(this.plugin.settings.filenameFormat)
				.onChange(async (value) => {
					this.plugin.settings.filenameFormat = value;
					await this.plugin.saveSettings();
				}));
	}
}

