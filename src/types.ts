/** Тип представления, под которым календарь зарегистрирован в Obsidian. */
export const VIEW_TYPE_TASK_CALENDAR = 'task-calendar';

export type TaskCalendarSettings = {
	/** Папка хранилища, в которой лежат заметки-задачи. '/' - всё хранилище. */
	tasksFolderPath: string;
};

export const DEFAULT_SETTINGS: TaskCalendarSettings = {
	tasksFolderPath: '/',
};
