export type Language = 'ru' | 'de' | 'ch' | 'en';

export interface Translations {
	[key: string]: string;
}

export interface TasksCalendarSettings {
	tasksFolderPath: string;
	tasksCreateFolderPath: string;
	filenameFormat: string;
	language: Language;
	openOnStartup: boolean;
}

