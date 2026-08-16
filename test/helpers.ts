import { vi } from 'vitest';
import { App, Vault } from './mocks/obsidian';
import type TaskCalendarPlugin from '../src/TaskCalendarPlugin';

/**
 * Фиксированное «сегодня» для всех тестов: четверг, 13 августа 2026.
 * Август 2026 начинается в субботу, поэтому сетка стартует с 27 июля.
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

export interface TaskNoteFixture {
	date?: string | null;
	done?: string[];
	repeat?: string | null;
	/** Свойство «Стоп повтор» - пишется, только если передано. */
	stopped?: boolean;
	body?: string;
}

/**
 * Текст заметки-задачи со свойствами - как их пишет Obsidian.
 *
 * Наименования задачи среди свойств нет: оно берётся из имени файла, поэтому в
 * тестах имя файла и есть название задачи.
 */
export const taskNoteText = ({
	date = null,
	done = [],
	repeat = null,
	stopped,
	body = '',
}: TaskNoteFixture = {}): string => {
	const lines = ['---', `Дата: ${date ?? ''}`.trimEnd()];

	lines.push('Выполнено:');
	for (const doneDate of done) lines.push(`  - ${doneDate}`);

	lines.push(`Повтор: ${repeat ?? ''}`.trimEnd());
	if (stopped !== undefined) lines.push(`Стоп повтор: ${stopped}`);
	lines.push('---');
	if (body) lines.push('', body);

	return `${lines.join('\n')}\n`;
};

export interface PluginDoubleOptions {
	/** Содержимое хранилища: путь -> текст файла. */
	files?: Record<string, string>;
	/** Папки, существующие без файлов внутри. */
	folders?: string[];
	/** Значение настройки плагина. */
	tasksFolderPath?: string;
}

export interface PluginDouble {
	plugin: TaskCalendarPlugin;
	app: App;
	vault: Vault;
	/** Сменить настройку и уведомить подписчиков - как делает вкладка настроек. */
	changeTasksFolderPath: (path: string) => void;
	/** Сколько подписчиков на настройки живо - для проверки отписки. */
	settingsListenerCount: () => number;
}

/** Плагин-двойник: компоненту нужны settings, app и подписка на настройки. */
export const createPluginDouble = ({
	files = {},
	folders = [],
	tasksFolderPath = '/',
}: PluginDoubleOptions = {}): PluginDouble => {
	const app = new App(new Vault(files, folders));
	const listeners = new Set<() => void>();

	const plugin = {
		app,
		settings: { tasksFolderPath },
		onSettingsChange(listener: () => void) {
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		},
	} as unknown as TaskCalendarPlugin;

	const changeTasksFolderPath = (path: string): void => {
		plugin.settings.tasksFolderPath = path;
		for (const listener of listeners) listener();
	};

	return {
		plugin,
		app,
		vault: app.vault,
		changeTasksFolderPath,
		settingsListenerCount: () => listeners.size,
	};
};
