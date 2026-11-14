import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskMap } from '../src/taskMap';
import { App, Notice, parseFrontmatter, TFile, Vault } from './mocks/obsidian';
import {
	createPluginDouble,
	PluginDoubleOptions,
	taskFileText,
	TaskFixture,
	taskProps,
	TODAY,
	useFixedClock,
} from './helpers';

/** Имя файла, который плагин создаст сейчас: часы стоят на 13.08.2026 12:00:00. */
const NOW_NAME = '20260813_120000';

let map: TaskMap;
let vault: Vault;
let app: App;

const setup = async (options: PluginDoubleOptions = {}) => {
	const double = createPluginDouble(options);
	map = double.taskMap;
	vault = double.vault;
	app = double.app;
	await map.start();
};

/** Дать сработать debounce событий хранилища. */
const settle = async () => {
	await vi.advanceTimersByTimeAsync(300);
};

/** Правка файла руками - в редакторе или в панели свойств. */
const editFile = async (path: string, fixture: TaskFixture) => {
	await vault.modify(new TFile(path), taskFileText(fixture));
	await settle();
};

const propsOf = (path: string) => parseFrontmatter(vault.contentOf(path) ?? '');

beforeEach(() => {
	useFixedClock();
});

afterEach(() => {
	map?.stop();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('индексация', () => {
	it('находит задачи по всему хранилищу, где бы они ни лежали и как бы ни назывались', async () => {
		await setup({
			files: {
				'Задачи/20260810_090000.md': taskFileText({ text: 'Раз' }),
				'Проекты/Дом/ремонт.md': taskFileText({ text: 'Два' }),
				'20260801_100000.md': taskFileText({ text: 'Три' }),
			},
			tasksFolderPath: '/Задачи',
		});

		expect(map.all().map((task) => task.text).sort()).toEqual(['Два', 'Раз', 'Три']);
		expect(map.byPath('Проекты/Дом/ремонт.md')).toMatchObject({
			folder: 'Проекты/Дом',
			fileName: 'ремонт',
		});
	});

	it('заметка без «Задача» и файл без свойств задачами не считаются', async () => {
		await setup({
			files: {
				'Заметка.md': '# Просто заметка\n',
				'Свойства.md': '---\ntags: дом\n---\nТекст\n',
				'Картинка.png': '',
			},
		});

		expect(map.all()).toEqual([]);
	});

	it('старый инлайн-формат больше не читается', async () => {
		await setup({ files: { '2026.md': '\n- [ ] Купить молоко 📅 2026-08-13 🔁 Каждый день\n' } });

		expect(map.all()).toEqual([]);
	});

	it('при старте ничего не пишет, даже если всё отмечено, а даты выполнения нет', async () => {
		await setup({ files: { 'a.md': taskFileText({ checked: true }) } });

		// Отметили при выключенном плагине - перехода не было, автоматика молчит.
		expect(app.fileManager.calls).toHaveLength(0);
		expect(vault.calls.modify).toBe(0);
	});

	it('битый YAML и нечитаемый файл индексацию не роняют', async () => {
		const double = createPluginDouble({
			files: {
				'битый.md': '---\nсломанный yaml\n---\n',
				'нечитаемый.md': taskFileText({ text: 'Не прочитать' }),
				'живой.md': taskFileText({ text: 'Живой' }),
			},
		});
		double.vault.failures.read = new Set(['нечитаемый.md']);
		// Читать при старте приходится только то, чего нет в кэше метаданных.
		double.app.metadataCache.uncached.add('нечитаемый.md');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		map = double.taskMap;

		await map.start();

		expect(map.all().map((task) => task.text)).toEqual(['Живой']);
	});

	it('старт не читает файлы: свойства берутся из кэша метаданных Obsidian', async () => {
		await setup({
			files: {
				'Задачи/а.md': taskFileText({ text: 'Первая' }),
				'Задачи/б.md': taskFileText({ text: 'Вторая', subtasks: [['под', true]] }),
				'Заметка.md': '# Просто заметка\n',
			},
		});

		expect(vault.calls.cachedRead).toBe(0);
		expect(vault.calls.read).toBe(0);
		expect(map.all().map((task) => task.text).sort()).toEqual(['Вторая', 'Первая']);
		expect(map.byPath('Задачи/б.md')?.subtasks).toEqual([{ number: 1, text: 'под', checked: true }]);
	});

	it('файл, которого ещё нет в кэше метаданных, читается с диска', async () => {
		const double = createPluginDouble({
			files: {
				'а.md': taskFileText({ text: 'Из кэша' }),
				'б.md': taskFileText({ text: 'С диска' }),
			},
		});
		double.app.metadataCache.uncached.add('б.md');
		map = double.taskMap;

		await map.start();

		expect(double.vault.calls.cachedRead).toBe(1);
		expect(map.all().map((task) => task.text).sort()).toEqual(['Из кэша', 'С диска']);
	});

	it('задача из кэша - и автоматика на первую же правку после старта', async () => {
		const PATH = 'Задачи/20260810_090000.md';
		await setup({ files: { [PATH]: taskFileText() } });

		await editFile(PATH, { checked: true });

		expect(propsOf(PATH)?.['Дата выполнения']).toBe(TODAY);
	});

	it('кэш догнал файл (changed) - задача перечитывается, обычные заметки не читаются', async () => {
		const double = createPluginDouble({
			files: {
				'задача.md': taskFileText({ text: 'Новый текст' }),
				'заметка.md': '# Заметка\n',
			},
		});
		// При старте кэш ещё прежний: правка пришла синхронизацией, пока Obsidian был закрыт.
		double.app.metadataCache.stale.set('задача.md', taskProps({ text: 'Старый текст' }));
		map = double.taskMap;
		await map.start();
		expect(map.byPath('задача.md')?.text).toBe('Старый текст');

		double.app.metadataCache.stale.delete('задача.md');
		double.app.metadataCache.trigger('changed', new TFile('задача.md'));
		double.app.metadataCache.trigger('changed', new TFile('заметка.md'));
		await settle();

		expect(map.byPath('задача.md')?.text).toBe('Новый текст');
		expect(double.vault.calls.cachedRead).toBe(1);
	});

	it('удалили папку - забываются и задачи из кэша, у которых нет хэша', async () => {
		await setup({ files: { 'Папка/а.md': taskFileText({ text: 'В папке' }), 'б.md': taskFileText({ text: 'Снаружи' }) } });

		await vault.deleteFolder('Папка');
		await settle();

		expect(map.all().map((task) => task.text)).toEqual(['Снаружи']);
	});
});

describe('автоматика при правке свойств', () => {
	const PATH = 'Задачи/20260810_090000.md';

	it('отметили задачу в свойствах - ставится дата выполнения', async () => {
		await setup({ files: { [PATH]: taskFileText() } });

		await editFile(PATH, { checked: true });

		expect(propsOf(PATH)).toMatchObject({ Выполнено: true, 'Дата выполнения': TODAY });
		expect(map.byPath(PATH)?.doneDate).toBe(TODAY);
	});

	it('отмечена задача, но не подзадача - даты выполнения нет', async () => {
		await setup({ files: { [PATH]: taskFileText({ subtasks: [['Раз', false]] }) } });

		await editFile(PATH, { checked: true, subtasks: [['Раз', false]] });

		expect(propsOf(PATH)?.['Дата выполнения']).toBeNull();
		expect(app.fileManager.calls).toHaveLength(0);
	});

	it('сняли галочку - дата выполнения очищается', async () => {
		await setup({ files: { [PATH]: taskFileText({ checked: true, doneDate: TODAY }) } });

		await editFile(PATH, { checked: false, doneDate: TODAY });

		expect(propsOf(PATH)?.['Дата выполнения']).toBeNull();
		expect(map.byPath(PATH)?.doneDate).toBeNull();
	});

	it('выполнили повтор - повтор очищается, рядом появляется файл следующего', async () => {
		await setup({
			files: {
				[PATH]: taskFileText({
					text: 'Полить фикус',
					date: '2026-08-15',
					repeat: 'Каждую неделю Суббота, Воскресенье',
					subtasks: [['Налить воды', false]],
				}),
			},
			tasksFolderPath: '/Другая папка',
		});

		await editFile(PATH, {
			text: 'Полить фикус',
			checked: true,
			date: '2026-08-15T07:30:00',
			repeat: 'Каждую неделю Суббота, Воскресенье',
			subtasks: [['Налить воды', true]],
		});

		expect(propsOf(PATH)).toMatchObject({ 'Дата выполнения': TODAY, Повтор: null });
		// Рядом с выполненным, а не в папке из настроек; время - как у выполненного.
		expect(vault.contentOf(`Задачи/${NOW_NAME}.md`)).toBe([
			'---',
			'Задача: Полить фикус',
			'Выполнено: false',
			'Дата и время: 2026-08-16T07:30:00',
			'Дата выполнения:',
			'Повтор: Каждую неделю Суббота, Воскресенье',
			'Дата переноса:',
			'Подзадача-1: Налить воды',
			'Подзадача-1-выполнено: false',
			'---',
			'',
		].join('\n'));
		expect(map.byPath(`Задачи/${NOW_NAME}.md`)).toMatchObject({
			date: '2026-08-16',
			dateTime: '2026-08-16T07:30:00',
			repeat: 'Каждую неделю Суббота, Воскресенье',
		});
	});

	it('сняли галочку у выполненного повтора - повтор не возвращается, второй файл не создаётся', async () => {
		await setup({ files: { [PATH]: taskFileText({ repeat: 'Каждый день' }) } });

		await editFile(PATH, { checked: true, repeat: 'Каждый день' });
		const files = vault.paths().length;
		await editFile(PATH, { checked: false, doneDate: TODAY });

		expect(propsOf(PATH)).toMatchObject({ Повтор: null, 'Дата выполнения': null });
		expect(vault.paths()).toHaveLength(files);
	});

	it('вписали дату переноса повторной - повтор очищается, следующий файл по «Дата и время»', async () => {
		await setup({ files: { [PATH]: taskFileText({ date: '2026-08-15T08:00:00', repeat: 'Каждую неделю Суббота' }) } });

		await editFile(PATH, { date: '2026-08-15T08:00:00', move: '2026-08-17', repeat: 'Каждую неделю Суббота' });

		expect(propsOf(PATH)).toMatchObject({ 'Дата и время': '2026-08-15T08:00:00', 'Дата переноса': '2026-08-17', Повтор: null });
		expect(propsOf(`Задачи/${NOW_NAME}.md`)).toMatchObject({
			'Дата и время': '2026-08-22T08:00:00',
			Повтор: 'Каждую неделю Суббота',
			'Дата переноса': null,
		});
		expect(map.byPath(PATH)).toMatchObject({ move: '2026-08-17', repeat: null });
	});

	it('дата переноса у обычной задачи файл не трогает', async () => {
		await setup({ files: { [PATH]: taskFileText() } });

		await editFile(PATH, { move: '2026-08-20' });

		expect(app.fileManager.calls).toHaveLength(0);
		expect(vault.paths()).toEqual([PATH]);
		expect(map.byPath(PATH)?.move).toBe('2026-08-20');
	});

	it('удалили подзадачу из середины - остальные перенумеровываются', async () => {
		await setup({
			files: { [PATH]: taskFileText({ subtasks: [['Раз', true], ['Два', false], ['Три', true]] }) },
		});

		await vault.modify(new TFile(PATH), [
			'---',
			'Задача: Задача',
			'Выполнено: false',
			'Подзадача-1: Раз',
			'Подзадача-1-выполнено: true',
			'Подзадача-3: Три',
			'Подзадача-3-выполнено: true',
			'---',
			'',
		].join('\n'));
		await settle();

		expect(propsOf(PATH)).toEqual({
			Задача: 'Задача',
			Выполнено: false,
			'Подзадача-1': 'Раз',
			'Подзадача-1-выполнено': true,
			'Подзадача-2': 'Три',
			'Подзадача-2-выполнено': true,
		});
	});

	it('правка без перехода файл не трогает', async () => {
		await setup({ files: { [PATH]: taskFileText({ text: 'Старый текст' }) } });

		await editFile(PATH, { text: 'Новый текст', repeat: 'Каждый день' });

		expect(app.fileManager.calls).toHaveLength(0);
		expect(map.byPath(PATH)).toMatchObject({ text: 'Новый текст', repeat: 'Каждый день' });
	});

	it('своя запись автоматику повторно не запускает', async () => {
		await setup({ files: { [PATH]: taskFileText({ repeat: 'Каждый день' }) } });

		await editFile(PATH, { checked: true, repeat: 'Каждый день' });
		await settle();
		await settle();

		expect(app.fileManager.calls).toHaveLength(1);
		expect(vault.paths()).toHaveLength(2);
	});

	it('не получилось записать - уведомление, карта цела', async () => {
		await setup({ files: { [PATH]: taskFileText() } });
		app.fileManager.fails = true;
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await editFile(PATH, { checked: true });

		expect(Notice.messages).toContain('Не удалось записать задачу');
		expect(map.byPath(PATH)).not.toBeNull();
	});
});

describe('галочка из карточки', () => {
	const PATH = 'Задачи/20260810_090000.md';

	it('галочка задачи пишет «Выполнено», отмечено всё - и дату выполнения', async () => {
		await setup({ files: { [PATH]: taskFileText() } });

		await map.toggle(PATH, 0);

		expect(propsOf(PATH)).toMatchObject({ Выполнено: true, 'Дата выполнения': TODAY });
		// Карта сведена сразу, без ожидания событий хранилища.
		expect(map.byPath(PATH)?.doneDate).toBe(TODAY);
	});

	it('галочка подзадачи пишет её «-выполнено»', async () => {
		await setup({ files: { [PATH]: taskFileText({ subtasks: [['Раз', false], ['Два', false]] }) } });

		await map.toggle(PATH, 2);

		expect(propsOf(PATH)).toMatchObject({
			Выполнено: false,
			'Подзадача-1-выполнено': false,
			'Подзадача-2-выполнено': true,
			'Дата выполнения': null,
		});
	});

	it('последняя галочка повторной задачи создаёт файл следующего повтора', async () => {
		await setup({
			files: { [PATH]: taskFileText({ checked: true, repeat: 'Каждый день', subtasks: [['Раз', false]] }) },
		});

		await map.toggle(PATH, 1);

		expect(propsOf(PATH)).toMatchObject({ 'Дата выполнения': TODAY, Повтор: null });
		expect(map.byPath(`Задачи/${NOW_NAME}.md`)).toMatchObject({
			date: '2026-08-14',
			repeat: 'Каждый день',
			checked: false,
			subtasks: [{ number: 1, text: 'Раз', checked: false }],
		});
	});

	it('снятая галочка выполненной очищает дату выполнения', async () => {
		await setup({ files: { [PATH]: taskFileText({ checked: true, doneDate: TODAY }) } });

		await map.toggle(PATH, 0);

		expect(propsOf(PATH)).toMatchObject({ Выполнено: false, 'Дата выполнения': null });
	});

	it('номер вне карточки ничего не пишет', async () => {
		await setup({ files: { [PATH]: taskFileText() } });

		await map.toggle(PATH, 1);
		await map.toggle('нет такого.md', 0);

		expect(app.fileManager.calls).toHaveLength(0);
	});

	it('после своей записи событие хранилища ничего не повторяет', async () => {
		await setup({ files: { [PATH]: taskFileText({ repeat: 'Каждый день' }) } });

		await map.toggle(PATH, 0);
		await settle();

		expect(app.fileManager.calls).toHaveLength(1);
		expect(vault.paths()).toHaveLength(2);
	});
});

describe('новая задача - пустой шаблон', () => {
	it('файл ГГГГММДД_ЧЧММСС.md в папке из настроек, «Дата и время» - сейчас, остальное пустое, задачей пока не считается', async () => {
		await setup({ folders: ['Задачи'], tasksFolderPath: '/Задачи/' });

		const path = await map.createBlankTask();

		expect(path).toBe(`Задачи/${NOW_NAME}.md`);
		expect(vault.contentOf(path!)).toBe([
			'---',
			'Задача:',
			'Выполнено: false',
			'Дата и время: 2026-08-13T12:00:00',
			'Дата выполнения:',
			'Повтор:',
			'Дата переноса:',
			'---',
			'',
		].join('\n'));
		expect(map.byPath(path!)).toBeNull();
	});

	it('заполнили «Задача» - файл становится задачей и попадает в карту', async () => {
		await setup();
		const path = await map.createBlankTask();

		await editFile(path!, { text: 'Купить молоко', date: '2026-08-20T09:00:00' });

		expect(map.byPath(path!)).toMatchObject({ text: 'Купить молоко', dateTime: '2026-08-20T09:00:00' });
		expect(app.fileManager.calls).toHaveLength(0);
	});

	it('корень хранилища и папка, которой нет, - с родителями', async () => {
		await setup({ tasksFolderPath: '/' });
		expect(await map.createBlankTask()).toBe(`${NOW_NAME}.md`);

		await setup({ tasksFolderPath: 'Дела/Личные' });
		expect(await map.createBlankTask()).toBe(`Дела/Личные/${NOW_NAME}.md`);
		expect(vault.getAbstractFileByPath('Дела')).not.toBeNull();
	});

	it('две задачи в одну секунду - вторая с суффиксом', async () => {
		await setup();

		const paths = [await map.createBlankTask(), await map.createBlankTask(), await map.createBlankTask()];

		expect(paths).toEqual([`${NOW_NAME}.md`, `${NOW_NAME}_2.md`, `${NOW_NAME}_3.md`]);
	});

	it('не получилось создать - уведомление и null', async () => {
		await setup();
		vault.failures.create = new Set([`${NOW_NAME}.md`]);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await map.createBlankTask()).toBeNull();
		expect(Notice.messages).toContain('Не удалось создать задачу');
	});

	it('пустой шаблон автоматику не запускает', async () => {
		await setup();

		await map.createBlankTask();
		await settle();

		expect(app.fileManager.calls).toHaveLength(0);
	});
});

describe('события хранилища', () => {
	it('новый файл задачи появляется, удалённый уходит', async () => {
		await setup();

		await vault.create('Новая.md', taskFileText({ text: 'Новая' }));
		await settle();
		expect(map.byPath('Новая.md')?.text).toBe('Новая');

		await vault.delete(new TFile('Новая.md'));
		await settle();
		expect(map.all()).toEqual([]);
	});

	it('заметка становится задачей, когда в ней появилось «Задача», и перестаёт без него', async () => {
		await setup({ files: { 'Заметка.md': '# Заметка\n' } });

		await vault.modify(new TFile('Заметка.md'), taskFileText({ text: 'Теперь задача' }));
		await settle();
		expect(map.byPath('Заметка.md')?.text).toBe('Теперь задача');

		await vault.modify(new TFile('Заметка.md'), '---\nДата и время: 2026-08-13T08:00:00\n---\n');
		await settle();
		expect(map.all()).toEqual([]);
	});

	it('переезд файла - задача по новому пути и только по нему', async () => {
		await setup({ files: { 'Задачи/20260810_090000.md': taskFileText() }, folders: ['Архив'] });

		await vault.rename(new TFile('Задачи/20260810_090000.md'), 'Архив/20260810_090000.md');
		await settle();

		expect(map.all().map((task) => task.path)).toEqual(['Архив/20260810_090000.md']);
	});

	it('удаление и переезд папки целиком', async () => {
		await setup({
			files: {
				'Задачи/a.md': taskFileText({ text: 'А' }),
				'Задачи/Вложенная/b.md': taskFileText({ text: 'Б' }),
				'Другое/c.md': taskFileText({ text: 'В' }),
			},
		});

		await vault.renameFolder('Задачи', 'Архив');
		await settle();
		expect(map.all().map((task) => task.path).sort())
			.toEqual(['Архив/a.md', 'Архив/Вложенная/b.md', 'Другое/c.md']);

		await vault.deleteFolder('Архив');
		await settle();
		expect(map.all().map((task) => task.path)).toEqual(['Другое/c.md']);
	});

	it('подписчики узнают об изменениях, отписка работает', async () => {
		await setup();
		const listener = vi.fn();
		const unsubscribe = map.onChange(listener);

		await map.createBlankTask();
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		await map.createBlankTask();
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('stop снимает подписки на хранилище', async () => {
		await setup();

		map.stop();

		expect(vault.handlerCount('modify')).toBe(0);
		expect(vault.handlerCount('create')).toBe(0);
		expect(vault.handlerCount('delete')).toBe(0);
		expect(vault.handlerCount('rename')).toBe(0);
	});
});
