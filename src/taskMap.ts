import { Notice, TAbstractFile, TFile, TFolder, debounce, moment } from 'obsidian';
import type TaskCalendarPlugin from './TaskCalendarPlugin';
import {
	allChecked,
	applyEdits,
	blockBase,
	blockAppendAt,
	blockShape,
	isValidBlock,
	buildTaskFile,
	DATE_FORMAT,
	Edit,
	nextFreeDate,
	normalizeDate,
	occurrenceBlockLines,
	ParamName,
	ParsedBlock,
	parseBlocks,
	parseRepeat,
	readTasks,
	removeParamEdit,
	repeatBlockLines,
	setParamEdit,
	Task,
	taskFileName,
	taskVaultPath,
	toggleCheckboxEdit,
} from './taskFormat';

/**
 * Карта задач - производный индекс над файлами, с API на запись.
 *
 * Источник истины всегда файл: события хранилища обновляют карту, а запись через
 * API карты правит файл (`vault.process`). Хранилище на запись при старте не
 * сканируется - индексация только читает.
 *
 * Карта живёт в плагине, а не в календаре: автоматика чекбокса должна срабатывать
 * и когда вкладка календаря закрыта, а галку поставили руками в заметке.
 */

/** Состояние блока с прошлой индексации - по нему узнаётся переключение. */
interface BlockState {
	/**
	 * Отпечаток блока без галочек. Номер блока сам по себе ненадёжен: вставили
	 * блок выше - и все номера съехали. Отпечаток отличает «тот же блок,
	 * переключили чекбокс» от «на этот номер попал другой блок».
	 */
	shape: string;
	checked: boolean;
}

/**
 * Дни, у которых в файле уже есть свой блок. Считаются по дате показа - по ней
 * блок стоит в календаре, и второй блок на этот день дал бы вторую карточку.
 */
const takenDays = (blocks: ParsedBlock[]): Set<string> => {
	const days = new Set<string>();

	for (const block of blocks) {
		const day = blockBase(block);
		if (day) days.add(day);
	}

	return days;
};

/** Дешёвый хэш содержимого: защита от цикла «запись -> событие -> запись». */
const hashOf = (text: string): string => {
	let hash = 5381;

	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;

	return `${text.length}:${hash}`;
};

/** Сколько файлов читаем одновременно при полном скане. */
const SCAN_CHUNK = 20;

export class TaskMap {
	private readonly plugin: TaskCalendarPlugin;

	/** Задачи по пути файла. */
	private tasksByPath = new Map<string, Task[]>();
	/** Состояния блоков по пути файла и номеру блока. */
	private states = new Map<string, Map<number, BlockState>>();
	/** Хэш содержимого по пути: то же содержимое - переиндексировать нечего. */
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
		if (!this.snapshot) {
			const tasks: Task[] = [];
			for (const list of this.tasksByPath.values()) tasks.push(...list);
			this.snapshot = tasks;
		}

		return this.snapshot;
	}

	byKey(key: string): Task | null {
		return this.all().find((task) => task.key === key) ?? null;
	}

	/** Подписки на хранилище и первичная индексация. */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;

		const { vault } = this.plugin.app;

		vault.on('create', this.handleUpsert);
		vault.on('modify', this.handleUpsert);
		vault.on('delete', this.handleDelete);
		vault.on('rename', this.handleRename);

		await this.refresh();
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;

		const { vault } = this.plugin.app;

		this.schedule.cancel();
		vault.off('create', this.handleUpsert);
		vault.off('modify', this.handleUpsert);
		vault.off('delete', this.handleDelete);
		vault.off('rename', this.handleRename);
	}

	/** Полный пересбор: старт плагина и смена папки в настройках. */
	async refresh(): Promise<void> {
		this.tasksByPath.clear();
		this.states.clear();
		this.hashes.clear();
		this.snapshot = null;
		this.touched.clear();
		this.dropped.clear();

		const files = this.plugin.app.vault.getMarkdownFiles()
			.filter((file) => this.inFolder(file.path));

		// Группами, а не по одной и не все разом: последовательное чтение тысячи
		// заметок растягивается, а одновременное упирается в диск.
		for (let i = 0; i < files.length; i += SCAN_CHUNK) {
			await Promise.all(files.slice(i, i + SCAN_CHUNK).map((file) => this.indexFile(file)));
		}

		this.notify();
	}

	/** Папка задач без слэшей по краям. Пусто - всё хранилище. */
	private folder(): string {
		return this.plugin.settings.tasksFolderPath.replace(/^\/+|\/+$/g, '');
	}

	/**
	 * Файл лежит в папке задач. Сравнение по границе пути, а не подстрокой: иначе
	 * папка «Задачи» цепляла бы и «Старые Задачи», и файл «Задачи.md».
	 * Сканирование рекурсивное - вложенные папки тоже.
	 */
	private inFolder(path: string): boolean {
		const folder = this.folder();

		return path.endsWith('.md') && (folder === '' || path.startsWith(`${folder}/`));
	}

	private notify(): void {
		this.snapshot = null;
		for (const listener of this.listeners) listener();
	}

	/**
	 * Событие стоит разбора. У файла путь проверяется строго, у папки - нет: что
	 * в ней лежит, видно только после обхода.
	 */
	private matters(file: TAbstractFile): boolean {
		return file instanceof TFolder || this.inFolder(file.path);
	}

	private handleUpsert = (file: TAbstractFile): void => {
		if (!this.matters(file)) return;

		this.touched.add(file.path);
		this.schedule();
	};

	private handleDelete = (file: TAbstractFile): void => {
		if (!this.matters(file) && !this.tasksByPath.has(file.path)) return;

		this.dropped.add(file.path);
		this.schedule();
	};

	/**
	 * Перемещение в Obsidian - это тоже rename, и обработчику приходит **старый
	 * путь**: без него унесённая из папки задача осталась бы висеть в календаре.
	 * Переехать может и папка целиком - тогда разбирать придётся всё, что внутри.
	 */
	private handleRename = (file: TAbstractFile, oldPath?: string): void => {
		if (oldPath === undefined && !this.matters(file)) return;

		if (oldPath !== undefined) this.dropped.add(oldPath);
		if (this.matters(file)) this.touched.add(file.path);

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

			if (file instanceof TFile && this.inFolder(path)) {
				if (await this.indexFile(file)) changed = true;
				continue;
			}

			// Папку могли принести в папку задач целиком - разбираем, что внутри.
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
			.filter((file) => file.path.startsWith(`${path}/`) && this.inFolder(file.path));

		let changed = false;

		for (const file of files) {
			if (await this.indexFile(file)) changed = true;
		}

		return changed;
	}

	/** Забыть путь вместе со всем, что под ним: удалить могли и папку целиком. */
	private forgetTree(path: string): boolean {
		let changed = this.forget(path);
		const prefix = `${path}/`;

		for (const known of [...this.tasksByPath.keys()]) {
			if (known.startsWith(prefix) && this.forget(known)) changed = true;
		}

		return changed;
	}

	private forget(path: string): boolean {
		const known = this.tasksByPath.delete(path);
		this.states.delete(path);
		this.hashes.delete(path);

		return known;
	}

	private fileOf(path: string): TFile | null {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);

		return file instanceof TFile ? file : null;
	}

	/** Прочитать файл и свести карту с его содержимым. */
	private async indexFile(file: TFile): Promise<boolean> {
		let content: string;

		try {
			content = await this.plugin.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`${file.path}:`, error);

			return false;
		}

		return this.syncContent(file, content);
	}

	/**
	 * Свести карту с содержимым файла и, если чекбоксы переключили, применить
	 * автоматику раздела 5 - одной записью.
	 *
	 * Единственная точка входа: и события хранилища, и собственная запись карты
	 * приходят сюда, поэтому триггер один и тот же, откуда бы галку ни поставили.
	 *
	 * Цикла нет: после записи запоминается хэш результата, и `modify` от своей же
	 * записи упирается в него и уходит ни с чем.
	 */
	private async syncContent(file: TFile, content: string): Promise<boolean> {
		if (this.hashes.get(file.path) === hashOf(content)) return false;

		const edits = this.automationEdits(file.path, content);
		let written = content;

		if (edits.length > 0) {
			written = await this.write(file, content, applyEdits(content.split('\n'), edits).join('\n'));
		}

		this.store(file.path, written);

		return true;
	}

	/**
	 * Что автоматика делает с файлом. Переход определяется сравнением состояния
	 * чекбоксов блока до и после; предыдущее состояние лежит в индексе.
	 *
	 * | не все отмечены -> все | поставить ✅ сегодня; есть 🔁 - сгенерировать
	 * |                        | следующий блок и убрать 🔁 из текущего |
	 * | все -> не все          | убрать ✅ |
	 * | остальное              | ничего, только обновить карту |
	 *
	 * Состояния у блока нет - значит, его видят впервые: отметки, сделанные при
	 * выключенном плагине, не догоняются, файл не правится.
	 */
	private automationEdits(path: string, content: string): Edit[] {
		const known = this.states.get(path);
		if (!known || known.size === 0) return [];

		const lines = content.split('\n');
		const blocks = parseBlocks(lines);
		const edits: Edit[] = [];
		const today = moment().format(DATE_FORMAT);
		// Дни, у которых уже есть свой блок: череда их перескакивает.
		const taken = takenDays(blocks);

		for (const block of blocks) {
			// Невалидный блок автоматика не трогает: сняли из тела все чекбоксы -
			// задача пропала с календаря, но её ✅ остаётся как написано.
			if (!isValidBlock(lines, block)) continue;

			const previous = known.get(block.index);
			if (!previous || previous.shape !== blockShape(block)) continue;

			const checked = allChecked(lines, block);
			if (checked === previous.checked) continue;

			if (!checked) {
				const remove = removeParamEdit(block, 'done');
				if (remove) edits.push(remove);
				continue;
			}

			edits.push(setParamEdit(block, 'done', today));

			// Повтора нет - задача просто закрылась.
			const repeat = parseRepeat(block.params.repeat?.value);
			const base = blockBase(block);
			const next = repeat && base ? nextFreeDate(base, repeat, taken) : null;
			if (!next) continue;

			// Новый блок встаёт непосредственно над закрытым, 🔁 уходит из него: в
			// цепочке остаётся ровно один блок с повтором.
			//
			// Над закрытым, а не в начало файла: уже лежащие блоки не двигаются.
			// Лежали выполненные сверху - там и останутся, ничего не сортируем.
			edits.push({
				at: block.start,
				remove: 0,
				insert: repeatBlockLines(lines, block, next),
			});

			const remove = removeParamEdit(block, 'repeat');
			if (remove) edits.push(remove);
		}

		return edits;
	}

	/**
	 * Записать файл. Содержимое сверяется с тем, что мы читали: успел измениться -
	 * своё не навязываем, событие хранилища всё равно приведёт нас сюда снова.
	 */
	private async write(file: TFile, before: string, next: string): Promise<string> {
		let written = next;

		try {
			await this.plugin.app.vault.process(file, (current) => {
				if (current === before) return next;

				written = current;

				return current;
			});
		} catch (error) {
			console.error(`${file.path}:`, error);
			new Notice('Не удалось записать задачу');
			written = before;
		}

		return written;
	}

	/** Запомнить разбор файла: задачи, состояния блоков и хэш содержимого. */
	private store(path: string, content: string): void {
		const lines = content.split('\n');
		const blocks = parseBlocks(lines);
		const tasks = readTasks(path, content);
		const states = new Map<number, BlockState>();

		for (const task of tasks) {
			const block = blocks.find((item) => item.index === task.blockIndex);
			if (!block) continue;

			states.set(task.blockIndex, {
				shape: blockShape(block),
				checked: task.checked,
			});
		}

		this.tasksByPath.set(path, tasks);
		this.states.set(path, states);
		this.hashes.set(path, hashOf(content));
		this.snapshot = null;
	}

	/**
	 * Переключить чекбокс задачи. Номер - порядковый сверху вниз, ровно как их
	 * отрисовал рендер карточки.
	 *
	 * `showOn` - день, с карточки которого пришла галочка. Совпадает с датой показа
	 * блока - обычная отметка. Отличается - значит отметили **расчётный день
	 * череды**: ему заводится свой блок (📅 этого дня, чистое тело, без 🔁) в конце
	 * файла, и выполняется только он. Текущий блок остаётся как был, а когда череда дойдёт
	 * до этого дня, она его перескочит - день уже занят своим блоком.
	 *
	 * Результат сводится в карту сразу, не дожидаясь события: галочку ставит текст
	 * заметки, а не браузер, и до конца debounce карточка стояла бы в прежнем виде.
	 */
	async toggleCheckbox(key: string, index: number, showOn?: string): Promise<void> {
		await this.edit(key, (content, blockIndex) => {
			const lines = content.split('\n');
			const blocks = parseBlocks(lines);
			const block = blocks.find((item) => item.index === blockIndex);
			if (!block) return null;

			// Отметили расчётный день череды - заводим блок этого дня.
			if (showOn && normalizeDate(showOn) && showOn !== blockBase(block)) {
				const fragment = this.occurrenceLines(lines, block, showOn, index);

				return fragment
					? applyEdits(lines, [{
						at: blockAppendAt(blocks),
						remove: 0,
						insert: fragment,
					}]).join('\n')
					: null;
			}

			const toggle = toggleCheckboxEdit(lines, block, index);

			return toggle ? applyEdits(lines, [toggle]).join('\n') : null;
		});
	}

	/**
	 * Строки блока отдельного дня череды с уже поставленной галочкой.
	 *
	 * Тело берётся у текущего блока со снятыми чекбоксами - это новый экземпляр
	 * задачи, а не копия чужих отметок. ✅ ставится **здесь же**, если галочка
	 * оказалась последней: блок только что появился, прошлого состояния у него в
	 * индексе нет, и автоматика переключения на него не сработает.
	 */
	private occurrenceLines(
		lines: string[],
		block: ParsedBlock,
		date: string,
		index: number
	): string[] | null {
		const fragment = occurrenceBlockLines(lines, block, date);
		const own = parseBlocks(fragment)[0];
		if (!own) return null;

		const toggle = toggleCheckboxEdit(fragment, own, index);
		if (!toggle) return null;

		const marked = applyEdits(fragment, [toggle]);
		const day = parseBlocks(marked)[0];

		return day && allChecked(marked, day)
			? applyEdits(marked, [setParamEdit(day, 'done', moment().format(DATE_FORMAT))])
			: marked;
	}

	/**
	 * Перенести задачу на другой день.
	 *
	 * У задачи с 🔁 пишется ↔️ - череда повтора считается от неподвижной 📅.
	 * У задачи без повтора двигается сама 📅: отдельная перемещённая дата ей не
	 * нужна.
	 */
	async moveTask(key: string, date: string): Promise<void> {
		const task = this.byKey(key);
		if (!task || !normalizeDate(date)) return;

		const name: ParamName = task.repeat ? 'move' : 'date';

		await this.edit(key, (content, blockIndex) => {
			const lines = content.split('\n');
			const block = parseBlocks(lines).find((item) => item.index === blockIndex);
			if (!block) return null;

			return applyEdits(lines, [setParamEdit(block, name, date)]).join('\n');
		});
	}

	/** Общая часть правок: найти файл, записать и свести карту с результатом. */
	private async edit(
		key: string,
		change: (content: string, blockIndex: number) => string | null
	): Promise<void> {
		const task = this.byKey(key);
		if (!task) return;

		const path = taskVaultPath(task);
		const file = this.fileOf(path);
		if (!file) return;

		let written: string | null = null;

		try {
			await this.plugin.app.vault.process(file, (current) => {
				const next = change(current, task.blockIndex);
				if (next === null || next === current) return current;

				written = next;

				return next;
			});
		} catch (error) {
			console.error(`${path}:`, error);
			new Notice('Не удалось записать задачу');

			return;
		}

		if (written === null) return;

		if (await this.syncContent(file, written)) this.notify();
	}

	/**
	 * Создать задачу на дату: новый файл в папке задач, 📅 и один снятый чекбокс с
	 * текстом из поля. Возвращает путь созданного файла или null.
	 *
	 * Имя файла складывается один раз при создании и дальше не меняется:
	 * переименование ломало бы ссылки `[[...]]` на заметку, а дата и текст в карте
	 * и так берутся из содержимого блока.
	 */
	async createTask(date: string, text: string): Promise<string | null> {
		const value = text.trim();
		if (!value || !normalizeDate(date)) return null;

		const { vault } = this.plugin.app;
		const folder = this.folder();

		try {
			await this.ensureFolder(folder);
		} catch (error) {
			console.error(`${folder}:`, error);
			new Notice('Не удалось создать папку задач');

			return null;
		}

		const base = taskFileName(date, value);
		const pathOf = (name: string): string => (folder ? `${folder}/${name}.md` : `${name}.md`);

		// Файл с таким именем уже есть - дописываем 2, 3 и так далее.
		let name = base;
		for (let n = 2; vault.getAbstractFileByPath(pathOf(name)); n++) name = `${base} ${n}`;

		const path = pathOf(name);

		try {
			const file = await vault.create(path, buildTaskFile(date, value));

			// Индексируем сразу: карточка должна появиться, не дожидаясь debounce.
			if (file instanceof TFile) {
				await this.indexFile(file);
				this.notify();
			}
		} catch (error) {
			console.error(`${path}:`, error);
			new Notice('Не удалось создать задачу');

			return null;
		}

		return path;
	}

	/** Папки задач может не быть - создаём при первой записи, вместе с родителями. */
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
