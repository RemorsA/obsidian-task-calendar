import { App, PluginSettingTab, Setting } from 'obsidian';
import type TaskCalendarPlugin from './TaskCalendarPlugin';

export class TaskCalendarSettingTab extends PluginSettingTab {
	plugin: TaskCalendarPlugin;

	constructor(app: App, plugin: TaskCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Папка для новых задач')
			.setDesc('Сюда кладутся задачи, созданные из календаря. Задачи ищутся по всему хранилищу.')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.tasksFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolderPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
