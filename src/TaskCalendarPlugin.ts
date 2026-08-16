import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TaskCalendarSettingTab } from './settings';
import { DEFAULT_SETTINGS, TaskCalendarSettings, VIEW_TYPE_TASK_CALENDAR } from './types';
import { TaskCalendarView } from './views/TaskCalendarView';

export default class TaskCalendarPlugin extends Plugin {
	// @ts-ignore
	settings: TaskCalendarSettings;

	/** Слушатели изменения настроек: открытые календари перечитывают задачи. */
	private settingsListeners = new Set<() => void>();

	/**
	 * Подписаться на изменение настроек. Возвращает функцию отписки - вызывать
	 * при закрытии календаря, иначе размонтированный компонент останется в
	 * подписчиках.
	 */
	onSettingsChange(listener: () => void): () => void {
		this.settingsListeners.add(listener);

		return () => {
			this.settingsListeners.delete(listener);
		};
	}

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new TaskCalendarSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_TASK_CALENDAR,
			(leaf) => new TaskCalendarView(leaf, this)
		);

		// Предпросмотр заметки по наведению на ссылку в теле задачи: без этой
		// регистрации core-плагин «Предпросмотр страницы» наши события не слушает.
		this.registerHoverLinkSource(VIEW_TYPE_TASK_CALENDAR, {
			display: 'Task calendar',
			defaultMod: true,
		});

		this.addRibbonIcon('calendar-check-2', 'Открыть календарь задач', async () => {
			await this.openCalendar();
		});

		this.addCommand({
			id: 'open-task-calendar',
			name: 'Открыть календарь задач',
			callback: async () => {
				await this.openCalendar();
			}
		});
	}

	onunload() {}

	async openCalendar() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TASK_CALENDAR);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(true);

			await leaf.setViewState({
				type: VIEW_TYPE_TASK_CALENDAR,
				active: true,
			});
		}

		await workspace.revealLeaf(leaf);
	}

	/**
	 * Настройки из data.json.
	 *
	 * Берутся только известные ключи: раньше через Object.assign в настройки
	 * затекало всё подряд из файла и записывалось обратно, поэтому удалённые
	 * настройки жили в data.json вечно.
	 */
	async loadSettings() {
		const loaded = (await this.loadData() ?? {}) as Partial<TaskCalendarSettings>;
		const settings = { ...DEFAULT_SETTINGS };

		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof TaskCalendarSettings)[]) {
			const value = loaded[key];
			if (typeof value === typeof DEFAULT_SETTINGS[key]) settings[key] = value as never;
		}

		this.settings = settings;

		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);

		for (const listener of this.settingsListeners) listener();
	}
}
