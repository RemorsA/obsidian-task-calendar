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
			.setName('Путь к папке с задачами')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.tasksFolderPath)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolderPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
