export type Language = 'ru' | 'en';

export interface Translations {
	[key: string]: string;
}

export interface TasksCalendarSettings {
	tasksFolderPath: string;
	filenameFormat: string;
	openOnStartup: boolean;
}
