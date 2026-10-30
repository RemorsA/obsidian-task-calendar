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
	/** ↔️ - день показа перенесённого экземпляра. */
	move?: string | null;
	/** 🔁 - текст повтора. */
	repeat?: string | null;
	/** ✅ - отметка выполнения. */
	done?: string | null;
	/**
	 * Тело: первая строка - строка задачи, параметры дописываются к ней сами;
	 * остальные - подзадачи со своим отступом.
	 */
	body?: string[];
}

/** Строки одного блока задачи: параметры в каноническом порядке в конце строки задачи. */
export const taskBlockLines = (block: TaskBlockFixture = {}): string[] => {
	const [task, ...subtasks] = block.body ?? ['- [ ] Задача'];
	const params = [`📅 ${block.date ?? TODAY}`];

	if (block.move) params.push(`↔️ ${block.move}`);
	if (block.repeat) params.push(`🔁 ${block.repeat}`);
	if (block.done) params.push(`✅ ${block.done}`);

	return [`${task} ${params.join(' ')}`, ...subtasks];
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
	/** Папка для новых задач - значение настройки плагина. */
	tasksFolderPath?: string;
}

export interface PluginDouble {
	plugin: TaskCalendarPlugin;
	app: App;
	vault: Vault;
	taskMap: TaskMap;
}

/** Плагин-двойник: карте задач нужны app и settings, компоненту - ещё и карта. */
export const createPluginDouble = ({
	files = {},
	folders = [],
	tasksFolderPath = '/',
}: PluginDoubleOptions = {}): PluginDouble => {
	const app = new App(new Vault(files, folders));

	const plugin = {
		app,
		settings: { tasksFolderPath },
	} as unknown as TaskCalendarPlugin;

	const taskMap = new TaskMap(plugin);
	plugin.taskMap = taskMap;

	return {
		plugin,
		app,
		vault: app.vault,
		taskMap,
	};
};
