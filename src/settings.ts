import { App, PluginSettingTab, Setting } from 'obsidian';
import TasksCalendarPlugin from '../main';
import { t } from './locales';
import { TasksCalendarSettings, Language } from './types';

export type { TasksCalendarSettings };

export const DEFAULT_SETTINGS: TasksCalendarSettings = {
	tasksFolderPath: '/',
	tasksCreateFolderPath: '/',
	filenameFormat: 'YYYY-MM',
	language: 'en',
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

		const lang = this.plugin.settings.language || 'en';
		new Setting(containerEl)
			.setName(t(lang, 'settingsTitle'))
			.setHeading();

		new Setting(containerEl)
			.setName(t(lang, 'openOnStartup'))
			.setDesc(t(lang, 'openOnStartupDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.openOnStartup ?? true)
				.onChange(async (value) => {
					this.plugin.settings.openOnStartup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'language'))
			.setDesc(t(lang, 'languageDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('en', 'English')
				.addOption('ru', 'Русский')
				.addOption('de', 'Deutsch')
				.addOption('ch', '中文')
				.setValue(this.plugin.settings.language || 'en')
				.onChange(async (value: Language) => {
					this.plugin.settings.language = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'tasksFolderPath'))
			.setDesc(t(lang, 'tasksFolderPathDesc'))
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.tasksFolderPath || '')
				.onChange(async (value) => {
					this.plugin.settings.tasksFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'tasksSaveFolderPath'))
			.setDesc(t(lang, 'tasksSaveFolderPathDesc'))
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.tasksCreateFolderPath || '')
				.onChange(async (value) => {
					this.plugin.settings.tasksCreateFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'dateFormatForFileHeader'))
			.setDesc(t(lang, 'dateFormatForFileHeaderDesc'))
			.addText(text => text
				.setPlaceholder('YYYY-MM')
				.setValue(this.plugin.settings.filenameFormat || 'YYYY-MM')
				.onChange(async (value) => {
					this.plugin.settings.filenameFormat = value;
					await this.plugin.saveSettings();
				}));
	}
}

