import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TaskCalendarSettingTab } from './settings';
import { TaskMap } from './taskMap';
import { PROPERTY_TYPES } from './taskFormat';
import {
	DEFAULT_SETTINGS,
	HOVER_LINK_SOURCE,
	TaskCalendarSettings,
	VIEW_TYPE_TASK_CALENDAR,
	VIEW_TYPE_TASK_LIST,
} from './types';
import { TaskCalendarView } from './views/TaskCalendarView';
import { TaskListView } from './views/TaskListView';

/**
 * Реестр типов свойств Obsidian - не публичный API: сверено по `app.js` Obsidian
 * 1.15.1. `setType` сам пишет `.obsidian/types.json`.
 */
interface MetadataTypeManager {
	getAssignedWidget?(name: string): string | null;
	setType(name: string, type: string): Promise<void> | void;
}

export default class TaskCalendarPlugin extends Plugin {
	// @ts-ignore
	settings: TaskCalendarSettings;

	/**
	 * Индекс задач. Живёт в плагине, а не в виде: автоматика должна срабатывать и
	 * при закрытом списке - галку ставят и руками в панели свойств.
	 */
	// @ts-ignore
	taskMap: TaskMap;

	/** Кто ждёт смены настроек: открытые списки. */
	private settingsListeners = new Set<() => void>();

	async onload() {
		await this.loadSettings();

		// Карта сканирует всё хранилище, а папка из настроек нужна только при
		// создании задачи - поэтому смена настроек карту не пересобирает.
		this.taskMap = new TaskMap(this);

		// Индексация после того, как Obsidian достроил интерфейс: до этого список
		// файлов хранилища ещё неполный.
		this.app.workspace.onLayoutReady(() => {
			void this.assignPropertyTypes();
			void this.taskMap.start();
			// Отдельный календарь мог вернуться с сохранённой раскладкой.
			this.closeStandaloneCalendar();
		});

		this.addSettingTab(new TaskCalendarSettingTab(this.app, this));

		// Отдельного календаря больше нет, вид зарегистрирован только затем, чтобы
		// вкладку из сохранённой раскладки найти и закрыть.
		this.registerView(
			VIEW_TYPE_TASK_CALENDAR,
			(leaf) => new TaskCalendarView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_TASK_LIST,
			(leaf) => new TaskListView(leaf, this)
		);

		// Предпросмотр заметки по наведению на ссылку в карточке: без этой
		// регистрации core-плагин «Предпросмотр страницы» наши события не слушает.
		this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
			display: 'Task calendar',
			defaultMod: true,
		});

		// Одна иконка и одна команда, обе открывают список с календарём (просьба
		// пользователя 14.11.2026: дубль убрали, оставшееся назвали «Открыть список
		// задач»). Иконка календарная, как была.
		this.addRibbonIcon('calendar-check-2', 'Открыть список задач', async () => {
			await this.openList();
		});

		this.addCommand({
			id: 'open-task-list',
			name: 'Открыть список задач',
			callback: async () => {
				await this.openList();
			}
		});
	}

	onunload() {
		this.taskMap.stop();
	}

	/**
	 * Отдельного календаря больше нет (просьба пользователя 14.11.2026): он всегда
	 * стоит сверху списка. Вкладка, вернувшаяся с сохранённой раскладкой,
	 * закрывается.
	 *
	 * Иконка календаря на левой панели остаётся: спрятать её можно только не
	 * публичным API, а на телефоне меню иконок Obsidian строит из своих данных, и
	 * скрытие кнопки туда не доходит. Вместо этого иконка открывает список.
	 */
	private closeStandaloneCalendar() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_CALENDAR)) leaf.detach();
	}

	/** Список задач - вкладкой в основной области. */
	async openList() {
		await this.openView(VIEW_TYPE_TASK_LIST, () => this.app.workspace.getLeaf(true));
	}

	/** Показать уже открытый вид или открыть его в новом листе. */
	private async openView(type: string, newLeaf: () => WorkspaceLeaf) {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;

		if (!leaf) {
			leaf = newLeaf();

			await leaf.setViewState({
				type,
				active: true,
			});
		}

		await workspace.revealLeaf(leaf);
	}

	/**
	 * Типы свойств задачи в панели свойств: «Дата и время» - датой со временем,
	 * даты выполнения и переноса - датой, галочка - флажком (просьба пользователя
	 * 13.11.2026, «Дата и время» - 14.11.2026). Тип назначается на всё хранилище и
	 * только если он другой: даты выполнения и переноса формат читает строго
	 * `ГГГГ-ММ-ДД`, и тип «дата и время» сломал бы их разбор. Реестра нет (другая
	 * версия Obsidian) - ничего не делаем.
	 */
	async assignPropertyTypes() {
		const manager = (this.app as unknown as { metadataTypeManager?: MetadataTypeManager })
			.metadataTypeManager;
		if (typeof manager?.setType !== 'function') return;

		for (const [name, type] of Object.entries(PROPERTY_TYPES)) {
			if (manager.getAssignedWidget?.(name) === type) continue;

			try {
				await manager.setType(name, type);
			} catch (error) {
				console.error(`Тип свойства «${name}»:`, error);
			}
		}
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
			const value: unknown = loaded[key];

			if (typeof value === typeof DEFAULT_SETTINGS[key]) settings[key] = value as never;
		}

		this.settings = settings;

		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);

		for (const listener of this.settingsListeners) listener();
	}

	/**
	 * Подписка на смену настроек. Настройки - обычный объект, Vue за ним не
	 * следит, поэтому открытый список узнаёт о свитче «Календарь в списке» отсюда.
	 * Возвращает отписку.
	 */
	onSettingsChange(listener: () => void): () => void {
		this.settingsListeners.add(listener);

		return () => {
			this.settingsListeners.delete(listener);
		};
	}
}
