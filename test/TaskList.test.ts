import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import momentLib from 'moment';
import TaskList from '../src/components/TaskList.vue';
import { MarkdownRenderer, Notice, parseFrontmatter, Platform, TFile } from './mocks/obsidian';
import {
	createPluginDouble,
	PluginDoubleOptions,
	taskFileText,
	TODAY,
	useFixedClock,
} from './helpers';

/** Имя файла, который плагин создаст сейчас: часы стоят на 13.08.2026 12:00:00. */
const NOW_NAME = '20260813_120000';

const mountList = async (options: PluginDoubleOptions = {}) => {
	const context = createPluginDouble(options);
	const wrapper = mount(TaskList, { props: { plugin: context.plugin } });
	await flushPromises();

	return { wrapper, ...context };
};

/** Карточки задач сверху вниз, без группы «Выполнено». */
const cardTexts = (wrapper: VueWrapper): string[] =>
	wrapper.findAll('.task__calendar-list-section.--is-tasks .tasks__item-body').map((body) => body.text().trim());

/** Группа «Выполнено». */
const doneGroup = (wrapper: VueWrapper) => wrapper.find('.task__calendar-list-section.--is-done');

/** Карточки группы «Выполнено» сверху вниз. */
const doneTexts = (wrapper: VueWrapper): string[] =>
	doneGroup(wrapper).findAll('.tasks__item-body').map((body) => body.text().trim());

/** Модификаторы карточек сверху вниз. */
const modifiers = (wrapper: VueWrapper): string[][] =>
	wrapper.findAll('.tasks__item').map((item) => item.classes().filter((name) => name.startsWith('--')));

/** Свитч «Календарь в списке» включён: под календарём 100 ближайших невыполненных. */
const mountOpenList = (options: PluginDoubleOptions = {}) => mountList({ ...options, calendarInList: true });

/** Дать сработать debounce событий хранилища. */
const settle = async () => {
	await vi.advanceTimersByTimeAsync(300);
	await flushPromises();
};

beforeEach(() => {
	useFixedClock();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('свитч включён: 100 ближайших невыполненных', () => {
	it('одним списком без групп: невыполненные по «Дата и время», раньше выше', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'20260601_090000.md': taskFileText({ text: 'Долг', date: '2026-08-01T10:00:00' }),
				'20260602_090000.md': taskFileText({ text: 'Сегодня вечером', date: `${TODAY}T21:00:00` }),
				'20260603_090000.md': taskFileText({ text: 'Сегодня утром', date: `${TODAY}T08:00:00` }),
				'20260604_090000.md': taskFileText({ text: 'Будущее', date: '2026-09-01T07:00:00' }),
				'20260605_090000.md': taskFileText({ text: 'Перенесли вперёд', date: '2026-08-10T09:00:00', move: '2026-08-30' }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Долг', 'Перенесли вперёд', 'Сегодня утром', 'Сегодня вечером', 'Будущее']);
		expect(wrapper.find('.task__calendar-group').exists()).toBe(false);
		expect(wrapper.find('h2').exists()).toBe(false);
	});

	it('выполненные - не в списке, а в группе «Выполнено» под ним', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'1.md': taskFileText({ text: 'Открытая' }),
				'2.md': taskFileText({ text: 'Сделано сегодня', checked: true, doneDate: TODAY }),
				'3.md': taskFileText({ text: 'Сделано давно', checked: true, doneDate: '2025-01-01' }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Открытая']);
		expect(doneTexts(wrapper)).toEqual(['Сделано сегодня', 'Сделано давно']);
		expect(wrapper.findAll('.task__calendar-list-section').map((section) => section.classes()))
			.toEqual([expect.arrayContaining(['--is-tasks']), expect.arrayContaining(['--is-done'])]);
	});

	it('пустой список и список из одних выполненных так и говорят', async () => {
		const empty = await mountOpenList();
		expect(empty.wrapper.find('.task__calendar-list-empty').text()).toBe('Задач нет');

		const done = await mountOpenList({ files: { '1.md': taskFileText({ checked: true, doneDate: TODAY }) } });
		expect(done.wrapper.find('.task__calendar-list-empty').text()).toBe('Задач нет');
		expect(doneTexts(done.wrapper)).toEqual(['Задача']);
	});

	it('просроченные первыми отдельным правилом; «Дата переноса» на просрочку и место не влияет', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'a.md': taskFileText({ text: 'Сегодня', date: `${TODAY}T08:00:00` }),
				'b.md': taskFileText({ text: 'Перенесли назад', date: '2026-08-20T08:00:00', move: '2026-08-10' }),
				'c.md': taskFileText({ text: 'Перенесли вперёд', date: '2026-08-01T08:00:00', move: '2026-08-15' }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Перенесли вперёд', 'Сегодня', 'Перенесли назад']);
		expect(modifiers(wrapper)).toEqual([['--is-overdue'], [], []]);
	});

	it('не больше 100 задач - ближайшие', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 105; i++) {
			const day = momentLib('2026-08-01').add(i, 'day').format('YYYY-MM-DD');
			files[`${i}.md`] = taskFileText({ text: `Задача ${i}`, date: `${day}T08:00:00` });
		}

		const { wrapper } = await mountOpenList({ files });
		const texts = cardTexts(wrapper);

		expect(texts).toHaveLength(100);
		expect(texts[0]).toBe('Задача 0');
		expect(texts[99]).toBe('Задача 99');
	});

	it('календарь сверху, но день в нём не выбирается', async () => {
		const { wrapper } = await mountOpenList({ files: { 'a.md': taskFileText({ text: 'Дело' }) } });

		expect(wrapper.find('.task__calendar-list').element.firstElementChild?.classList)
			.toContain('task__calendar-container');
		expect(wrapper.find('button.week-day').exists()).toBe(false);
		expect(wrapper.find('.week-day.--is-focused').exists()).toBe(false);

		await wrapper.findAll('.week-day')[20].trigger('click');
		await flushPromises();

		expect(cardTexts(wrapper)).toEqual(['Дело']);
	});

	it('без даты - внизу, одинаковое время - раньше созданный файл выше', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'20260810_090000.md': taskFileText({ text: 'Без даты', date: null }),
				'20260801_090000.md': taskFileText({ text: 'Создана раньше', date: `${TODAY}T08:00:00` }),
				'20260805_090000.md': taskFileText({ text: 'Создана позже', date: `${TODAY}T08:00:00` }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Создана раньше', 'Создана позже', 'Без даты']);
	});
});

describe('свитч включён: группа «Выполнено»', () => {
	/** Выполненная задача: время выполнения - с точностью до минуты, как пишет плагин. */
	const done = (text: string, doneDate: string, date = '2026-08-01T08:00:00') =>
		taskFileText({ text, date, checked: true, doneDate });

	it('под списком, заголовок - кнопка со стрелкой и числом; только что выполненные сверху', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'20260801_090000.md': done('Вчера', '2026-08-12T18:00:00', '2026-08-20T08:00:00'),
				'20260802_090000.md': done('Только что', `${TODAY}T11:59:00`),
				'20260803_090000.md': done('Утром', `${TODAY}T08:30:00`),
				'20260804_090000.md': done('Давно', '2025-01-01T08:00:00'),
				'20260805_090000.md': taskFileText({ text: 'Открытая' }),
			},
		});

		const heading = doneGroup(wrapper).find('h2.task__calendar-group-heading');
		const toggle = heading.find('button.task__calendar-group-toggle');

		expect(toggle.find('.task__calendar-group-arrow').exists()).toBe(true);
		expect(toggle.find('.task__calendar-group-title').text()).toBe('Выполнено');
		expect(toggle.find('.task__calendar-group-count').text()).toBe('4');
		expect(toggle.attributes('aria-expanded')).toBe('true');
		expect(doneTexts(wrapper)).toEqual(['Только что', 'Утром', 'Вчера', 'Давно']);
		// День в заголовке карточки - день задачи, как в списке.
		expect(doneGroup(wrapper).findAll('.tasks__item-date').map((date) => date.text()))
			.toEqual(['Суббота 1 августа', 'Суббота 1 августа', 'Четверг 20 августа', 'Суббота 1 августа']);
		expect(doneGroup(wrapper).findAll('.tasks__item').every((item) => item.classes('--is-done'))).toBe(true);
	});

	it('видно не больше 20 - только что выполненные; число в заголовке - все выполненные', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 25; i++) {
			const moment = momentLib('2026-07-01T08:00:00').add(i, 'hour').format('YYYY-MM-DD[T]HH:mm:ss');
			files[`${i}.md`] = done(`Сделано ${i}`, moment);
		}

		const { wrapper } = await mountOpenList({ files });
		const texts = doneTexts(wrapper);

		expect(texts).toHaveLength(20);
		expect(texts[0]).toBe('Сделано 24');
		expect(texts[19]).toBe('Сделано 5');
		expect(doneGroup(wrapper).find('.task__calendar-group-count').text()).toBe('25');
	});

	it('выполненные в одну минуту - позже созданный файл выше', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'20260801_090000.md': done('Создана раньше', `${TODAY}T10:00:00`),
				'20260805_090000.md': done('Создана позже', `${TODAY}T10:00:00`),
			},
		});

		expect(doneTexts(wrapper)).toEqual(['Создана позже', 'Создана раньше']);
	});

	it('сворачивается заголовком: карточки остаются, но недоступны; состояние - в настройках', async () => {
		const { wrapper, plugin } = await mountOpenList({ files: { 'a.md': done('Сделано', `${TODAY}T10:00:00`) } });
		const toggle = () => doneGroup(wrapper).find('.task__calendar-group-toggle');
		const body = () => doneGroup(wrapper).find('.task__calendar-list-section-body');

		expect(body().attributes('inert')).toBeUndefined();

		await toggle().trigger('click');
		await flushPromises();

		expect(doneGroup(wrapper).classes()).toContain('--is-collapsed');
		expect(toggle().attributes('aria-expanded')).toBe('false');
		expect(body().attributes()).toHaveProperty('inert');
		expect(doneTexts(wrapper)).toEqual(['Сделано']);
		expect(doneGroup(wrapper).find('.task__calendar-group-count').text()).toBe('1');
		expect(plugin.settings.doneCollapsed).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

		await toggle().trigger('click');
		await flushPromises();

		expect(doneGroup(wrapper).classes()).not.toContain('--is-collapsed');
		expect(body().attributes('inert')).toBeUndefined();
		expect(plugin.settings.doneCollapsed).toBe(false);
	});

	it('свёрнутая в настройках остаётся свёрнутой', async () => {
		const { wrapper } = await mountOpenList({
			doneCollapsed: true,
			files: { 'a.md': done('Сделано', `${TODAY}T10:00:00`) },
		});

		expect(doneGroup(wrapper).classes()).toContain('--is-collapsed');
		expect(doneGroup(wrapper).find('.task__calendar-group-toggle').attributes('aria-expanded')).toBe('false');
	});

	it('подчёркивание заголовка - отдельный элемент под кнопкой, а не её рамка', async () => {
		const { wrapper } = await mountOpenList({ files: { 'a.md': done('Сделано', `${TODAY}T10:00:00`) } });
		const heading = doneGroup(wrapper).find('.task__calendar-group-heading');

		expect(heading.find('.task__calendar-group-line').attributes('aria-hidden')).toBe('true');
		expect(heading.find('.task__calendar-group-toggle .task__calendar-group-line').exists()).toBe(false);
	});

	it('снятая галочка в группе возвращает задачу в список', async () => {
		const { wrapper, vault } = await mountOpenList({ files: { 'a.md': done('Сделано', `${TODAY}T10:00:00`) } });

		await doneGroup(wrapper).find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf('a.md') ?? '')).toMatchObject({ Выполнено: false, 'Дата выполнения': null });
		expect(cardTexts(wrapper)).toEqual(['Сделано']);
		expect(doneGroup(wrapper).exists()).toBe(false);
	});

	it('в режиме дня группы нет: выполненные дня - в конце дня', async () => {
		const { wrapper } = await mountList({
			files: {
				'a.md': taskFileText({ text: 'Открытая' }),
				'b.md': done('Сделано', `${TODAY}T10:00:00`, `${TODAY}T08:00:00`),
			},
		});

		expect(doneGroup(wrapper).exists()).toBe(false);
		expect(wrapper.find('h2').exists()).toBe(false);
		expect(cardTexts(wrapper)).toEqual(['Открытая', 'Сделано']);
	});
});

describe('карточка', () => {
	const PATH = 'Задачи/20260810_090000.md';

	it('заголовок - день из «Дата и время» («Дата переноса» не влияет), тело - задача и подзадачи', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				[PATH]: taskFileText({
					text: 'Купить',
					date: '2026-08-10',
					move: '2026-08-20',
					subtasks: [['молоко', true], ['хлеб', false]],
				}),
			},
		});
		const card = wrapper.find('.tasks__item');
		const boxes = card.findAll('input.task-list-item-checkbox');

		expect(card.find('.tasks__item-date').text()).toBe('Понедельник 10 августа');
		expect(card.find('.tasks__item-body').text()).toContain('Купить');
		expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([false, true, false]);
	});

	it('день в заголовке - «Суббота 14 июля»: день недели, число, месяц; год - только не текущий', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'а.md': taskFileText({ text: 'Август', date: '2026-08-14' }),
				'б.md': taskFileText({ text: 'Июль', date: '2027-07-04' }),
				'в.md': taskFileText({ text: 'Январь', date: '2027-01-09' }),
			},
		});

		expect(wrapper.findAll('.tasks__item-date').map((date) => date.text()))
			.toEqual(['Пятница 14 августа', 'Суббота 9 января 2027', 'Воскресенье 4 июля 2027']);
	});

	it('у задачи без даты в заголовке так и написано', async () => {
		const { wrapper } = await mountOpenList({ files: { [PATH]: taskFileText({ date: null }) } });

		expect(wrapper.find('.tasks__item-date').text()).toBe('Без даты');
	});

	it('просроченная отличается видом карточки', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'1.md': taskFileText({ date: '2026-08-01' }),
				'3.md': taskFileText({ date: TODAY }),
			},
		});

		expect(modifiers(wrapper)).toEqual([['--is-overdue'], []]);
	});

	it('кнопка редактирования открывает файл задачи на правку', async () => {
		const { wrapper, app } = await mountOpenList({ files: { [PATH]: taskFileText() } });

		await wrapper.find('.tasks__item-edit-button').trigger('click');
		await flushPromises();

		expect(app.workspace.openLinkCalls).toEqual([{
			linktext: PATH,
			sourcePath: '',
			newLeaf: false,
			openViewState: { state: { mode: 'source' } },
		}]);
	});

	it('файл не открылся - уведомление', async () => {
		const { wrapper, app } = await mountOpenList({ files: { [PATH]: taskFileText() } });
		app.workspace.openLinkFails = true;
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await wrapper.find('.tasks__item-edit-button').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось открыть задачу');
	});

	it('галочка задачи закрывает её, и карточка уходит из списка в «Выполнено»', async () => {
		const { wrapper, vault } = await mountOpenList({ files: { [PATH]: taskFileText({ text: 'Дело' }) } });

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf(PATH) ?? '')).toMatchObject({
			Выполнено: true,
			'Дата выполнения': '2026-08-13T12:00:00',
		});
		expect(cardTexts(wrapper)).toEqual([]);
		expect(doneTexts(wrapper)).toEqual(['Дело']);
	});

	it('на телефоне галочка отзывается вибрацией сразу, на компьютере - нет', async () => {
		const vibrate = vi.fn();
		Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });

		try {
			const { wrapper, vault } = await mountOpenList({ files: { [PATH]: taskFileText({ subtasks: [['Раз', false]] }) } });

			await wrapper.findAll('input.task-list-item-checkbox')[1].trigger('click');
			expect(vibrate).not.toHaveBeenCalled();

			Platform.isMobile = true;
			await wrapper.findAll('input.task-list-item-checkbox')[1].trigger('click');
			// Вибрация - до записи: отклик не ждёт файла.
			expect(vibrate).toHaveBeenCalledWith(100);
			await flushPromises();

			expect(parseFrontmatter(vault.contentOf(PATH) ?? '')?.['Подзадача-1-выполнено']).toBe(false);
		} finally {
			Platform.isMobile = false;
			Reflect.deleteProperty(navigator, 'vibrate');
		}
	});

	it('вложенные подзадачи - с отступом по уровню; без показанного родителя - уровнем выше', async () => {
		await mountOpenList({
			files: {
				[PATH]: taskFileText({
					text: 'Главная задача',
					subtasks: [['Раз', false], ['Раз-раз', true, '1-1'], ['Раз-два', false, '1-2'], ['Без родителя', false, '3-1']],
				}),
			},
		});

		expect(MarkdownRenderer.calls[MarkdownRenderer.calls.length - 1].markdown).toBe([
			'- [ ] Главная задача',
			'\t- [ ] Раз',
			'\t\t- [x] Раз-раз',
			'\t\t- [ ] Раз-два',
			'\t- [ ] Без родителя',
		].join('\n'));
	});

	it('галочка вложенной подзадачи пишет её «-выполнено»', async () => {
		const { wrapper, vault } = await mountOpenList({
			files: { [PATH]: taskFileText({ subtasks: [['Раз', false], ['Раз-раз', false, '1-1'], ['Раз-два', false, '1-2']] }) },
		});

		await wrapper.findAll('input.task-list-item-checkbox')[3].trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf(PATH) ?? '')).toMatchObject({
			'Подзадача-1-1-выполнено': false,
			'Подзадача-1-2-выполнено': true,
		});
	});

	it('галочка подзадачи пишет свою подзадачу', async () => {
		const { wrapper, vault } = await mountOpenList({
			files: { [PATH]: taskFileText({ subtasks: [['Раз', false], ['Два', false]] }) },
		});

		await wrapper.findAll('input.task-list-item-checkbox')[2].trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf(PATH) ?? '')).toMatchObject({
			Выполнено: false,
			'Подзадача-1-выполнено': false,
			'Подзадача-2-выполнено': true,
		});
	});

	it('выполненный повтор: в списке остаётся следующий, на завтра', async () => {
		const { wrapper } = await mountOpenList({
			files: { [PATH]: taskFileText({ text: 'Полить фикус', repeat: 'Каждый день' }) },
		});

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(cardTexts(wrapper)).toEqual(['Полить фикус']);
		expect(wrapper.find('.task__calendar-list-section.--is-tasks .tasks__item-date').text()).toBe('Пятница 14 августа');
		expect(doneTexts(wrapper)).toEqual(['Полить фикус']);
	});

	it('снятая галочка возвращает выполненную в список', async () => {
		// Выполненную видно только в дне календаря - режим по умолчанию.
		const { wrapper, plugin } = await mountList({
			files: { [PATH]: taskFileText({ text: 'Дело', checked: true, doneDate: TODAY }) },
		});

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		plugin.settings.calendarInList = true;
		await plugin.saveSettings();
		await flushPromises();

		expect(cardTexts(wrapper)).toEqual(['Дело']);
	});
});

describe('кнопка новой задачи', () => {
	it('внизу списка одна кнопка с плюсом, полей создания нет', async () => {
		const { wrapper } = await mountList({ files: { 'a.md': taskFileText() } });
		const buttons = wrapper.findAll('.task__calendar-create-open');

		expect(buttons).toHaveLength(1);
		expect(buttons[0].attributes('aria-label')).toBe('Новая задача');
		// Кнопка - последняя в колонке, после карточек: прилипает к низу.
		expect(wrapper.find('.task__calendar-list').element.lastElementChild).toBe(buttons[0].element);
		// Поля только у галочек карточек: ни текста, ни даты, ни повтора.
		expect(wrapper.findAll('textarea, input:not([type="checkbox"])')).toHaveLength(0);
	});

	it('создаёт файл с сегодняшним днём и 08:00, остальное пустое, и сразу открывает его на правку', async () => {
		const { wrapper, vault, app } = await mountList({ tasksFolderPath: '/Задачи', folders: ['Задачи'] });

		await wrapper.find('.task__calendar-create-open').trigger('click');
		await flushPromises();

		const path = `Задачи/${NOW_NAME}.md`;
		expect(parseFrontmatter(vault.contentOf(path) ?? '')).toEqual({
			Задача: null,
			Выполнено: false,
			'Дата и время': '2026-08-13T08:00:00',
			'Дата выполнения': null,
			Повтор: null,
			'Дата переноса': null,
		});
		expect(app.workspace.openLinkCalls).toEqual([{
			linktext: path,
			sourcePath: '',
			newLeaf: false,
			openViewState: { state: { mode: 'source' } },
		}]);
		// Пустой файл - ещё не задача: в списке его нет, пока не заполнят «Задача».
		expect(cardTexts(wrapper)).toEqual([]);
	});

	it('заполнили «Задача» - карточка появляется в списке', async () => {
		const { wrapper, vault } = await mountList({ tasksFolderPath: '/' });

		await wrapper.find('.task__calendar-create-open').trigger('click');
		await flushPromises();
		await vault.modify(new TFile(`${NOW_NAME}.md`), taskFileText({ text: 'Купить молоко' }));
		await settle();

		expect(cardTexts(wrapper)).toEqual(['Купить молоко']);
	});

	it('файл не создался - не открывается ничего', async () => {
		const { wrapper, vault, app } = await mountList({ tasksFolderPath: '/' });
		vault.failures.create = new Set([`${NOW_NAME}.md`]);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await wrapper.find('.task__calendar-create-open').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось создать задачу');
		expect(app.workspace.openLinkCalls).toEqual([]);
	});
});

describe('режим дня: свитч выключен (по умолчанию)', () => {
	/** Первая ячейка сетки августа 2026: месяц начинается в субботу. */
	const GRID_START = '2026-07-27';

	/** Ячейка дня в календаре списка - по смещению от начала сетки. */
	const dayCell = (wrapper: VueWrapper, date: string, gridStart = GRID_START) =>
		wrapper.findAll('.week-day')[momentLib(date).diff(momentLib(gridStart), 'days')];

	const selectDay = async (wrapper: VueWrapper, date: string, gridStart = GRID_START) => {
		await dayCell(wrapper, date, gridStart).trigger('click');
		await flushPromises();
	};

	it('календарь сверху, под ним без заголовков просроченные и сегодняшний день', async () => {
		const { wrapper } = await mountList({
			files: {
				'1.md': taskFileText({ text: 'Долг', date: '2026-08-01' }),
				'2.md': taskFileText({ text: 'Сегодня', date: TODAY }),
				'3.md': taskFileText({ text: 'Завтра', date: '2026-08-14' }),
				'4.md': taskFileText({ text: 'Без даты', date: null }),
				'5.md': taskFileText({ text: 'Сделано сегодня', checked: true, doneDate: TODAY }),
				'6.md': taskFileText({ text: 'Сделано вчера', date: '2026-08-12', checked: true, doneDate: '2026-08-12' }),
			},
		});

		expect(wrapper.find('.task__calendar-list').element.firstElementChild?.classList)
			.toContain('task__calendar-container');
		expect(dayCell(wrapper, TODAY).classes()).toContain('--is-focused');
		// Просроченные первыми, выполненные в этот день - в конце, у каждой свой вид.
		expect(cardTexts(wrapper)).toEqual(['Долг', 'Сегодня', 'Сделано сегодня']);
		expect(modifiers(wrapper)).toEqual([['--is-overdue'], [], ['--is-done']]);
	});

	it('клик по дню показывает его задачи, просроченные видны в любой день', async () => {
		const { wrapper } = await mountList({
			files: {
				'1.md': taskFileText({ text: 'Долг', date: '2026-08-01' }),
				'2.md': taskFileText({ text: 'Сегодня', date: TODAY }),
				'3.md': taskFileText({ text: 'Двадцатое', date: '2026-08-20' }),
			},
		});

		await selectDay(wrapper, '2026-08-20');

		expect(dayCell(wrapper, '2026-08-20').classes()).toContain('--is-focused');
		expect(dayCell(wrapper, TODAY).classes()).not.toContain('--is-focused');
		expect(cardTexts(wrapper)).toEqual(['Долг', 'Двадцатое']);
	});

	it('в день задачи - по «Дата и время», раньше выше', async () => {
		const { wrapper } = await mountList({
			files: {
				'20260801_090000.md': taskFileText({ text: 'Утро', date: `${TODAY}T08:00:00` }),
				'20260812_090000.md': taskFileText({ text: 'Обед', date: `${TODAY}T13:00:00` }),
				'20260805_090000.md': taskFileText({ text: 'Вечер', date: `${TODAY}T20:00:00` }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Утро', 'Обед', 'Вечер']);
	});

	it('повторная задача видна в каждый свой будущий день, как точка календаря', async () => {
		const { wrapper } = await mountList({
			files: { 'a.md': taskFileText({ text: 'Зарядка', repeat: 'Каждую неделю' }) },
		});

		await selectDay(wrapper, '2026-08-20');
		expect(cardTexts(wrapper)).toEqual(['Зарядка']);
		expect(dayCell(wrapper, '2026-08-20').find('.week-day--dot').exists()).toBe(true);

		await selectDay(wrapper, '2026-08-21');
		expect(cardTexts(wrapper)).toEqual([]);
	});

	it('у карточек нет дня в заголовке, кнопка редактирования на месте', async () => {
		const { wrapper, app } = await mountList({
			files: {
				'a.md': taskFileText({ text: 'Сегодня' }),
				'b.md': taskFileText({ text: 'Долг', date: '2026-08-01' }),
			},
		});

		expect(wrapper.findAll('.tasks__item')).toHaveLength(2);
		expect(wrapper.find('.tasks__item-date').exists()).toBe(false);
		expect(wrapper.findAll('.tasks__item-edit-button')).toHaveLength(2);

		await wrapper.find('.tasks__item-edit-button').trigger('click');
		await flushPromises();
		expect(app.workspace.openLinkCalls.map((call) => call.linktext)).toEqual(['b.md']);
	});

	it('пустой день - «Задач нет», как и пустой список при включённом свитче', async () => {
		const { wrapper } = await mountList({ files: { 'a.md': taskFileText({ text: 'Дело' }) } });

		expect(wrapper.find('.task__calendar-list-empty').exists()).toBe(false);

		await selectDay(wrapper, '2026-08-20');

		expect(wrapper.find('.task__calendar-container').exists()).toBe(true);
		expect(wrapper.find('.task__calendar-list-empty').text()).toBe('Задач нет');
		expect(wrapper.findAll('.tasks__item')).toHaveLength(0);
	});

	it('свитч в настройках переключает режим на лету, выбранный день остаётся', async () => {
		const { wrapper, plugin } = await mountList({
			files: {
				'a.md': taskFileText({ text: 'Дело' }),
				'b.md': taskFileText({ text: 'Двадцатое', date: '2026-08-20' }),
			},
		});

		await selectDay(wrapper, '2026-08-20');
		expect(cardTexts(wrapper)).toEqual(['Двадцатое']);

		plugin.settings.calendarInList = true;
		await plugin.saveSettings();
		await flushPromises();

		expect(wrapper.find('.task__calendar-container').exists()).toBe(true);
		expect(wrapper.find('.week-day.--is-focused').exists()).toBe(false);
		expect(cardTexts(wrapper)).toEqual(['Дело', 'Двадцатое']);
		expect(wrapper.find('.tasks__item-date').text()).toBe('Четверг 13 августа');

		plugin.settings.calendarInList = false;
		await plugin.saveSettings();
		await flushPromises();

		expect(dayCell(wrapper, '2026-08-20').classes()).toContain('--is-focused');
		expect(cardTexts(wrapper)).toEqual(['Двадцатое']);
	});

	it('кнопка новой задачи та же: «Дата и время» - сегодня 08:00, выбранный день на него не влияет', async () => {
		const { wrapper, vault, app } = await mountList({ tasksFolderPath: '/' });

		await selectDay(wrapper, '2026-08-20');
		await wrapper.find('.task__calendar-create-open').trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf(`${NOW_NAME}.md`) ?? '')?.['Дата и время']).toBe(`${TODAY}T08:00:00`);
		expect(app.workspace.openLinkCalls.map((call) => call.linktext)).toEqual([`${NOW_NAME}.md`]);
	});

	it('при размонтировании отписывается от настроек', async () => {
		const { wrapper, settingsListeners } = await mountList();

		expect(settingsListeners.size).toBe(1);

		wrapper.unmount();

		expect(settingsListeners.size).toBe(0);
	});
});

describe('связь с картой', () => {
	it('правка свойств в файле сразу видна в карточке', async () => {
		const { wrapper, vault } = await mountOpenList({ files: { 'a.md': taskFileText({ text: 'Было' }) } });

		await vault.modify(new TFile('a.md'), taskFileText({ text: 'Стало', date: '2026-08-14' }));
		await settle();

		expect(cardTexts(wrapper)).toEqual(['Стало']);
		expect(wrapper.find('.tasks__item-date').text()).toBe('Пятница 14 августа');
	});

	it('удалённая задача уходит из списка', async () => {
		const { wrapper, vault } = await mountList({ files: { 'a.md': taskFileText() } });

		await vault.delete(new TFile('a.md'));
		await settle();

		expect(wrapper.findAll('.tasks__item')).toHaveLength(0);
	});

	it('при размонтировании отписывается от карты', async () => {
		const context = createPluginDouble();
		const unsubscribe = vi.fn();
		const onChange = vi.spyOn(context.taskMap, 'onChange').mockReturnValue(unsubscribe);

		const wrapper = mount(TaskList, { props: { plugin: context.plugin } });
		await flushPromises();

		expect(unsubscribe).not.toHaveBeenCalled();

		wrapper.unmount();

		// Подписан и список, и календарь над ним - отписываются оба.
		expect(onChange).toHaveBeenCalledTimes(2);
		expect(unsubscribe).toHaveBeenCalledTimes(2);
	});
});
