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
			.setDesc('Сюда кладутся задачи, созданные из списка. Задачи ищутся по всему хранилищу.')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.tasksFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Календарь в списке')
			.setDesc('Выключено: клик по дню календаря показывает задачи этого дня. Включено: день не выбирается, под календарём - 100 ближайших невыполненных задач.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.calendarInList)
				.onChange(async (value) => {
					this.plugin.settings.calendarInList = value;
					await this.plugin.saveSettings();
				}));
	}
}
