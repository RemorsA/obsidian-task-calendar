import { vi } from 'vitest';
import { App, stringifyFrontmatter, Vault } from './mocks/obsidian';
import { TaskMap } from '../src/taskMap';
import { DEFAULT_SETTINGS } from '../src/types';
import type TaskCalendarPlugin from '../src/TaskCalendarPlugin';

/**
 * Фиксированное «сегодня» для всех тестов: четверг, 13 августа 2026.
 * Август 2026 начинается в субботу, поэтому сетка стартует с 27 июля. Неделя
 * сегодняшнего дня кончается в воскресенье 16 августа.
 */
export const TODAY = '2026-08-13';

/**
 * Подменяется только Date: setImmediate должен остаться настоящим, иначе
 * flushPromises из @vue/test-utils зависнет. setTimeout нужен фейковый - на нём
 * держится debounce обновления задач.
 */
export const useFixedClock = (date = `${TODAY}T12:00:00`): void => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
	vi.setSystemTime(new Date(date));
};

export interface TaskFixture {
	/** `Задача`. */
	text?: string;
	/** `Выполнено`. */
	checked?: boolean;
	/**
	 * `Дата и время`: день со временем или один день (читается как полночь). По
	 * умолчанию сегодня; null - пустое свойство.
	 */
	date?: string | null;
	/** `Дата выполнения`. */
	doneDate?: string | null;
	/** `Повтор`. */
	repeat?: string | null;
	/** `Дата переноса`. */
	move?: string | null;
	/** Подзадачи парами: текст и галочка. */
	subtasks?: [string, boolean][];
	/** Текст под блоком свойств. */
	body?: string;
}

/** Свойства задачи в порядке шаблона: так файл пишет и сам плагин. */
export const taskProps = (task: TaskFixture = {}): Record<string, unknown> => {
	const props: Record<string, unknown> = {
		Задача: task.text ?? 'Задача',
		Выполнено: task.checked ?? false,
		'Дата и время': task.date === undefined ? TODAY : task.date,
		'Дата выполнения': task.doneDate ?? null,
		Повтор: task.repeat ?? null,
		'Дата переноса': task.move ?? null,
	};

	(task.subtasks ?? []).forEach(([text, checked], i) => {
		props[`Подзадача-${i + 1}`] = text;
		props[`Подзадача-${i + 1}-выполнено`] = checked;
	});

	return props;
};

/** Текст файла задачи: блок свойств и, если задан, текст под ним. */
export const taskFileText = (task: TaskFixture = {}): string =>
	`${stringifyFrontmatter(taskProps(task))}\n${task.body ?? ''}`;

export interface PluginDoubleOptions {
	/** Содержимое хранилища: путь -> текст файла. */
	files?: Record<string, string>;
	/** Папки, существующие без файлов внутри. */
	folders?: string[];
	/** Папка для новых задач - значение настройки плагина. */
	tasksFolderPath?: string;
	/** Календарь в списке. По умолчанию выключен, как у плагина. */
	calendarInList?: boolean;
}

export interface PluginDouble {
	plugin: TaskCalendarPlugin;
	app: App;
	vault: Vault;
	taskMap: TaskMap;
	/** Подписчики смены настроек - чтобы проверить отписку. */
	settingsListeners: Set<() => void>;
}

/**
 * Плагин-двойник: карте задач нужны app и settings, компонентам - ещё и карта.
 * `saveSettings` зовёт подписчиков `onSettingsChange`, как настоящий плагин.
 */
export const createPluginDouble = ({
	files = {},
	folders = [],
	tasksFolderPath = '/',
	calendarInList = DEFAULT_SETTINGS.calendarInList,
}: PluginDoubleOptions = {}): PluginDouble => {
	const app = new App(new Vault(files, folders));
	const settingsListeners = new Set<() => void>();

	const plugin = {
		app,
		settings: { tasksFolderPath, calendarInList },
		saveSettings: vi.fn(async () => {
			for (const listener of settingsListeners) listener();
		}),
		onSettingsChange: (listener: () => void) => {
			settingsListeners.add(listener);

			return () => {
				settingsListeners.delete(listener);
			};
		},
	} as unknown as TaskCalendarPlugin;

	const taskMap = new TaskMap(plugin);
	plugin.taskMap = taskMap;

	return {
		plugin,
		app,
		vault: app.vault,
		taskMap,
		settingsListeners,
	};
};
