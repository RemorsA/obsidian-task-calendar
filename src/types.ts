/** Тип представления, под которым календарь зарегистрирован в Obsidian. */
export const VIEW_TYPE_TASK_CALENDAR = 'task-calendar';

export type TaskCalendarSettings = {
	/**
	 * Папка, в которую кладутся задачи, созданные из календаря. '/' - корень
	 * хранилища. На поиск задач не влияет: сканируется всё хранилище.
	 *
	 * Имя ключа осталось с тех пор, когда папка ограничивала и скан: так значение
	 * из data.json подхватывается без миграции.
	 */
	tasksFolderPath: string;
};

export const DEFAULT_SETTINGS: TaskCalendarSettings = {
	tasksFolderPath: '/',
};
