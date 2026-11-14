import { Notice, TAbstractFile, TFile, TFolder, debounce, moment } from 'obsidian';
import type TaskCalendarPlugin from './TaskCalendarPlugin';
import {
	automate,
	buildTaskFile,
	DATE_FORMAT,
	DATE_TIME_FORMAT,
	Frontmatter,
	frontmatterOf,
	NewTask,
	PROPS,
	readTask,
	readTaskFile,
	stateOf,
	subtaskCheckedKey,
	Task,
	taskFileName,
	TaskState,
} from './taskFormat';

/**
 * Карта задач - производный индекс над файлами, с API на запись.
 *
 * Источник истины всегда файл: события хранилища обновляют карту, а запись через
 * API карты правит свойства файла (`processFrontMatter`). Хранилище на запись при
 * старте не сканируется - индексация только читает.
 *
 * Карта живёт в плагине, а не в виде: автоматика должна срабатывать и когда
 * список закрыт, а галку поставили руками в панели свойств.
 */

/** Дешёвый хэш содержимого: защита от цикла «запись -> событие -> запись». */
const hashOf = (text: string): string => {
	let hash = 5381;

	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;

	return `${text.length}:${hash}`;
};

/** Сколько файлов без кэша метаданных читаем одновременно при полном скане. */
const SCAN_CHUNK = 20;

const today = (): string => moment().format(DATE_FORMAT);

export class TaskMap {
	private readonly plugin: TaskCalendarPlugin;

	/** Задачи по пути файла. */
	private tasks = new Map<string, Task>();
	/** Состояния задач с прошлой индексации: по ним узнаётся переход. */
	private states = new Map<string, TaskState>();
	/**
	 * Хэш содержимого по пути: то же содержимое - переиндексировать нечего. Есть
	 * только у прочитанных файлов: задача, взятая при старте из кэша метаданных,
	 * хэша не имеет до первого события.
	 */
	private hashes = new Map<string, string>();
	/** Плоский список задач. Пересобирается лениво, а не на каждое событие. */
	private snapshot: Task[] | null = null;

	private listeners = new Set<() => void>();
	/** Пути, тронутые с прошлого пересчёта, и пути, которых больше нет. */
	private touched = new Set<string>();
	private dropped = new Set<string>();
	private started = false;

	constructor(plugin: TaskCalendarPlugin) {
		this.plugin = plugin;
	}

	/** Подписаться на изменения карты. Возвращает функцию отписки. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Все задачи хранилища. Порядок произвольный - сортирует потребитель. */
	all(): Task[] {
		if (!this.snapshot) this.snapshot = [...this.tasks.values()];

		return this.snapshot;
	}

	byPath(path: string): Task | null {
		return this.tasks.get(path) ?? null;
	}

	/** Подписки на хранилище и первичная индексация. */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;

		const { vault, metadataCache } = this.plugin.app;

		vault.on('create', this.handleUpsert);
		vault.on('modify', this.handleUpsert);
		vault.on('delete', this.handleDelete);
		vault.on('rename', this.handleRename);
		metadataCache.on('changed', this.handleMetadata);

		await this.refresh();
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;

		const { vault, metadataCache } = this.plugin.app;

		this.schedule.cancel();
		vault.off('create', this.handleUpsert);
		vault.off('modify', this.handleUpsert);
		vault.off('delete', this.handleDelete);
		vault.off('rename', this.handleRename);
		metadataCache.off('changed', this.handleMetadata);
	}

	/**
	 * Полный пересбор при старте плагина. Сканируется всё хранилище: задачей файл
	 * делают свойства, а не папка, в которой он лежит.
	 *
	 * Файлы при этом не читаются (оптимизация 14.11.2026: 4600 заметок рабочего
	 * хранилища читались с диска при каждом запуске). Свойства берутся из кэша
	 * метаданных Obsidian - он у Obsidian уже есть и переживает перезапуск;
	 * заметка без «Задача» в нём пропускается сразу. С диска читаются только
	 * файлы, которых в кэше ещё нет.
	 */
	async refresh(): Promise<void> {
		this.tasks.clear();
		this.states.clear();
		this.hashes.clear();
		this.snapshot = null;
		this.touched.clear();
		this.dropped.clear();

		const { vault, metadataCache } = this.plugin.app;
		const uncached: TFile[] = [];

		for (const file of vault.getMarkdownFiles()) {
			const cache = metadataCache.getFileCache(file);

			if (cache) this.storeCached(file.path, cache.frontmatter);
			else uncached.push(file);
		}

		// Группами, а не по одной и не все разом: последовательное чтение тысячи
		// заметок растягивается, а одновременное упирается в диск.
		for (let i = 0; i < uncached.length; i += SCAN_CHUNK) {
			await Promise.all(uncached.slice(i, i + SCAN_CHUNK).map((file) => this.indexFile(file)));
		}

		this.notify();
	}

	/**
	 * Задача из свойств кэша метаданных - без чтения файла и без хэша. Объект
	 * свойств принадлежит Obsidian: `readTask` его только читает.
	 */
	private storeCached(path: string, frontmatter: unknown): void {
		const task = readTask(path, frontmatter);
		if (!task) return;

		this.tasks.set(path, task);
		this.states.set(path, stateOf(task));
	}

	/**
	 * Папка для новых задач без слэшей по краям. Пусто - корень хранилища.
	 * На скан не влияет: читается только в момент создания задачи.
	 */
	private folder(): string {
		return this.plugin.settings.tasksFolderPath.replace(/^\/+|\/+$/g, '');
	}

	/** Заметка Markdown - кандидат в файлы задач, где бы она ни лежала. */
	private isNote(path: string): boolean {
		return path.endsWith('.md');
	}

	private notify(): void {
		this.snapshot = null;
		for (const listener of this.listeners) listener();
	}

	/**
	 * Событие стоит разбора. У файла смотрим расширение, у папки - нет: что в ней
	 * лежит, видно только после обхода.
	 */
	private matters(file: TAbstractFile): boolean {
		return file instanceof TFolder || this.isNote(file.path);
	}

	private handleUpsert = (file: TAbstractFile): void => {
		if (!this.matters(file)) return;

		this.touched.add(file.path);
		this.schedule();
	};

	private handleDelete = (file: TAbstractFile): void => {
		if (!this.matters(file) && !this.hashes.has(file.path)) return;

		this.dropped.add(file.path);
		this.schedule();
	};

	/**
	 * Перемещение в Obsidian - это тоже rename, и обработчику приходит **старый
	 * путь**: без него переехавшая задача висела бы в списке дважды - по старому
	 * пути и по новому. Переехать может и папка целиком - тогда разбирать придётся
	 * всё, что внутри.
	 */
	private handleRename = (file: TAbstractFile, oldPath?: string): void => {
		if (oldPath === undefined && !this.matters(file)) return;

		if (oldPath !== undefined) this.dropped.add(oldPath);
		if (this.matters(file)) this.touched.add(file.path);

		this.schedule();
	};

	/**
	 * Obsidian перечитал свойства файла. Правку могли сделать мимо событий
	 * хранилища - пришла синхронизация, пока Obsidian был закрыт, а при старте
	 * кэш ещё был прежним. Разбираем только задачи и файлы, которые ими были:
	 * обычные заметки не читаем.
	 */
	private handleMetadata = (file: TFile): void => {
		if (!this.isNote(file.path)) return;

		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const isTask = !!frontmatter && PROPS.text in frontmatter;
		if (!isTask && !this.tasks.has(file.path)) return;

		this.touched.add(file.path);
		this.schedule();
	};

	private schedule = debounce(() => { void this.flush(); }, 300, true);

	/** Разобрать накопленные события. */
	private async flush(): Promise<void> {
		const dropped = [...this.dropped];
		const touched = [...this.touched];
		this.dropped.clear();
		this.touched.clear();

		let changed = false;

		for (const path of dropped) {
			if (this.forgetTree(path)) changed = true;
		}

		for (const path of touched) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);

			if (file instanceof TFile && this.isNote(path)) {
				if (await this.indexFile(file)) changed = true;
				continue;
			}

			// Папка переехала целиком - разбираем, что внутри.
			if (file instanceof TFolder) {
				if (await this.indexFolder(path)) changed = true;
				continue;
			}

			// Файл уехал или исчез, пока ждал debounce.
			if (this.forgetTree(path)) changed = true;
		}

		if (changed) this.notify();
	}

	/** Разобрать заметки внутри папки: она могла переехать целиком. */
	private async indexFolder(path: string): Promise<boolean> {
		const files = this.plugin.app.vault.getMarkdownFiles()
			.filter((file) => file.path.startsWith(`${path}/`));

		let changed = false;

		for (const file of files) {
			if (await this.indexFile(file)) changed = true;
		}

		return changed;
	}

	/**
	 * Забыть путь вместе со всем, что под ним: удалить могли и папку целиком.
	 * Смотрим и задачи, и хэши: у задачи из кэша метаданных хэша нет.
	 */
	private forgetTree(path: string): boolean {
		let changed = this.forget(path);
		const prefix = `${path}/`;

		for (const known of new Set([...this.tasks.keys(), ...this.hashes.keys()])) {
			if (known.startsWith(prefix) && this.forget(known)) changed = true;
		}

		return changed;
	}

	private forget(path: string): boolean {
		const known = this.tasks.delete(path);
		this.states.delete(path);
		this.hashes.delete(path);

		return known;
	}

	private fileOf(path: string): TFile | null {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);

		return file instanceof TFile ? file : null;
	}

	private async read(file: TFile): Promise<string | null> {
		try {
			return await this.plugin.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`${file.path}:`, error);

			return null;
		}
	}

	/** Прочитать файл и свести карту с его содержимым. */
	private async indexFile(file: TFile): Promise<boolean> {
		const content = await this.read(file);

		return content === null ? false : this.syncContent(file, content);
	}

	/**
	 * Свести карту с содержимым файла и, если в свойствах случился переход,
	 * применить автоматику - одной записью.
	 *
	 * Цикла нет: после записи запоминается хэш результата, и `modify` от своей же
	 * записи упирается в него и уходит ни с чем.
	 *
	 * Состояния у задачи нет - значит, её видят впервые: правки, сделанные при
	 * выключенном плагине, не догоняются, файл не правится.
	 */
	private async syncContent(file: TFile, content: string): Promise<boolean> {
		if (this.hashes.get(file.path) === hashOf(content)) return false;

		const previous = this.states.get(file.path);
		const frontmatter = frontmatterOf(content);

		// Пробуем автоматику на копии: писать стоит, только если что-то меняется.
		if (previous && frontmatter && automate({ ...frontmatter }, previous, today()).changed) {
			await this.writeTask(file, previous, () => true);

			return true;
		}

		this.store(file.path, content);

		return true;
	}

	/**
	 * Записать свойства задачи: сначала правка `change`, затем автоматика - одной
	 * записью. Файл следующего повтора создаётся после, рядом с исходным.
	 *
	 * `change` вернул false - править нечего, и автоматика тоже не нужна.
	 */
	private async writeTask(
		file: TFile,
		previous: TaskState,
		change: (frontmatter: Frontmatter, task: Task) => boolean
	): Promise<void> {
		// Через as: присваивание в замыкании TypeScript не видит и сузил бы до null.
		let next = null as NewTask | null;

		try {
			await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
				const task = readTask(file.path, frontmatter);
				if (!task || !change(frontmatter, task)) return;

				next = automate(frontmatter, previous, today()).next;
			});
		} catch (error) {
			console.error(`${file.path}:`, error);
			new Notice('Не удалось записать задачу');

			return;
		}

		const written = await this.read(file);
		if (written !== null) this.store(file.path, written);

		// Следующий повтор - рядом с исходным, а не в папке из настроек: файл, который
		// убрали в свою папку, там и продолжается (решение 13.11.2026).
		if (next) await this.createFile(this.folderOf(file.path), next);
	}

	/** Папка файла по пути без слэшей по краям. */
	private folderOf(path: string): string {
		const at = path.lastIndexOf('/');

		return at === -1 ? '' : path.slice(0, at);
	}

	/** Запомнить разбор файла: задачу, её состояние и хэш содержимого. */
	private store(path: string, content: string): void {
		const task = readTaskFile(path, content);

		if (task) {
			this.tasks.set(path, task);
			this.states.set(path, stateOf(task));
		} else {
			this.tasks.delete(path);
			this.states.delete(path);
		}

		this.hashes.set(path, hashOf(content));
		this.snapshot = null;
	}

	/**
	 * Переключить галочку в карточке: 0 - сама задача, дальше подзадачи по порядку.
	 * Дальше та же автоматика, что при правке свойств руками.
	 *
	 * Результат сводится в карту сразу, не дожидаясь события: галочку ставят
	 * свойства файла, а не браузер, и до конца debounce карточка стояла бы в
	 * прежнем виде.
	 */
	async toggle(path: string, index: number): Promise<void> {
		const task = this.byPath(path);
		const file = this.fileOf(path);
		if (!task || !file || index < 0 || index > task.subtasks.length) return;

		const previous = this.states.get(path) ?? stateOf(task);

		await this.writeTask(file, previous, (frontmatter, fresh) => {
			if (index === 0) {
				frontmatter[PROPS.checked] = !fresh.checked;

				return true;
			}

			const subtask = fresh.subtasks[index - 1];
			if (!subtask) return false;

			frontmatter[subtaskCheckedKey(subtask.number)] = !subtask.checked;

			return true;
		});

		this.notify();
	}

	/**
	 * Новая задача - шаблон для ручного заполнения (просьба пользователя
	 * 14.11.2026, вместо окна с полями): файл `ГГГГММДД_ЧЧММСС.md` в папке для
	 * новых задач, `Дата и время` - текущие дата и время, те же, что в имени
	 * файла, `Выполнено: false`, остальное пустое. Задачей файл станет, когда
	 * заполнят `Задача`. Возвращает путь файла или null, если создать не вышло.
	 */
	async createBlankTask(): Promise<string | null> {
		const folder = this.folder();
		const now = moment();

		try {
			await this.ensureFolder(folder);
		} catch (error) {
			console.error(`${folder}:`, error);
			new Notice('Не удалось создать папку задач');

			return null;
		}

		return this.createFile(
			folder,
			{ text: '', dateTime: now.format(DATE_TIME_FORMAT), repeat: null, subtasks: [] },
			now
		);
	}

	/**
	 * Файл задачи в папке. Имя - время создания; занято (две задачи в одну
	 * секунду) - с суффиксом `_2`, `_3`.
	 *
	 * Карта сводится сразу: карточка должна появиться, не дожидаясь debounce.
	 */
	private async createFile(folder: string, task: NewTask, now = moment()): Promise<string | null> {
		const { vault } = this.plugin.app;
		const base = `${folder ? `${folder}/` : ''}${taskFileName(now)}`;
		let path = `${base}.md`;

		for (let n = 2; vault.getAbstractFileByPath(path); n++) path = `${base}_${n}.md`;

		const content = buildTaskFile(task);

		try {
			await vault.create(path, content);
		} catch (error) {
			console.error(`${path}:`, error);
			new Notice('Не удалось создать задачу');

			return null;
		}

		this.store(path, content);
		this.notify();

		return path;
	}

	/** Папки для новых задач может не быть - создаём при первой записи, с родителями. */
	private async ensureFolder(folder: string): Promise<void> {
		if (!folder) return;

		const { vault } = this.plugin.app;
		const parts = folder.split('/');

		for (let i = 0; i < parts.length; i++) {
			const path = parts.slice(0, i + 1).join('/');
			if (vault.getAbstractFileByPath(path)) continue;

			await vault.createFolder(path);
		}
	}
}
