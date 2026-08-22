import { vi } from 'vitest';
import { App, Vault } from './mocks/obsidian';
import { TaskMap } from '../src/taskMap';
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

export interface TaskBlockFixture {
	/** 📅 - обязательный параметр блока. */
	date?: string;
	/** ↔️ - перемещённая дата. */
	move?: string | null;
	/** 🔁 - текст повтора. */
	repeat?: string | null;
	/** ✅ - отметка выполнения. */
	done?: string | null;
	/** Строки тела без отступа - таб добавляется сам. */
	body?: string[];
}

/** Строки одного блока задачи в каноническом порядке параметров. */
export const taskBlockLines = (block: TaskBlockFixture = {}): string[] => {
	const lines = [`- 📅 ${block.date ?? TODAY}`];

	if (block.move) lines.push(`- ↔️ ${block.move}`);
	if (block.repeat) lines.push(`- 🔁 ${block.repeat}`);
	if (block.done) lines.push(`- ✅ ${block.done}`);

	for (const line of block.body ?? ['- [ ] Задача']) lines.push(`\t${line}`);

	return lines;
};

/**
 * Текст файла задачи: блоки подряд, пустая строка в начале и в конце - ровно
 * так, как файл пишет сам плагин.
 */
export const taskFileText = (...blocks: TaskBlockFixture[]): string => {
	const lines: string[] = [''];

	for (const block of (blocks.length > 0 ? blocks : [{}])) lines.push(...taskBlockLines(block));

	lines.push('');

	return lines.join('\n');
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
	taskMap: TaskMap;
	/** Сменить настройку и уведомить подписчиков - как делает вкладка настроек. */
	changeTasksFolderPath: (path: string) => void;
	/** Сколько подписчиков на настройки живо - для проверки отписки. */
	settingsListenerCount: () => number;
}

/** Плагин-двойник: карте задач нужны app и settings, компоненту - ещё и карта. */
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

	const taskMap = new TaskMap(plugin);
	plugin.taskMap = taskMap;

	const changeTasksFolderPath = (path: string): void => {
		plugin.settings.tasksFolderPath = path;
		for (const listener of listeners) listener();
	};

	return {
		plugin,
		app,
		vault: app.vault,
		taskMap,
		changeTasksFolderPath,
		settingsListenerCount: () => listeners.size,
	};
};
