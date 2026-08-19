import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import momentLib from 'moment';
import TaskCalendar from '../src/components/TaskCalendar.vue';
import { bodyBlockDates, extractBody, type SelectedTask } from '../src/taskFormat';
import { MarkdownRenderer, Notice, TFile } from './mocks/obsidian';
import {
	createPluginDouble,
	PluginDoubleOptions,
	taskNoteText,
	TODAY,
	useFixedClock,
} from './helpers';

/** Тело заметки без блока свойств - по нему проверяем, что записал плагин. */
const bodyOf = (content: string): string => extractBody(content);

/** Первая ячейка сетки августа 2026: месяц начинается в субботу. */
const GRID_START = '2026-07-27';

const mountCalendar = async (options: PluginDoubleOptions = {}) => {
	const context = createPluginDouble(options);
	const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });
	await flushPromises();

	return { wrapper, ...context };
};

/** Ячейка дня по дате - в разметке дат нет, считаем смещение от начала сетки. */
const cellFor = (wrapper: VueWrapper, date: string, gridStart = GRID_START) => {
	const index = momentLib(date).diff(momentLib(gridStart), 'days');
	const cells = wrapper.findAll('.week-day');

	expect(index, `дата ${date} вне сетки`).toBeGreaterThanOrEqual(0);
	expect(index, `дата ${date} вне сетки`).toBeLessThan(cells.length);

	return cells[index];
};

/** Есть ли на дне невыполненные задачи - то же, что рисует точку. */
const hasTaskOn = (wrapper: VueWrapper, date: string): boolean =>
	Boolean((wrapper.vm as unknown as { daysWithTasks: Record<string, boolean> })
		.daysWithTasks[date]);

/** Отрисована ли точка на дне. */
const hasDot = (wrapper: VueWrapper, date: string): boolean =>
	cellFor(wrapper, date).find('.week-day--dot').exists();

const selectedTasks = (wrapper: VueWrapper): SelectedTask[] =>
	(wrapper.vm as unknown as { selectedTasks: SelectedTask[] }).selectedTasks;

const completedTasks = (wrapper: VueWrapper): SelectedTask[] =>
	(wrapper.vm as unknown as { completedTasks: SelectedTask[] }).completedTasks;

const overdueTasks = (wrapper: VueWrapper): SelectedTask[] =>
	(wrapper.vm as unknown as { overdueTasks: SelectedTask[] }).overdueTasks;

/** Невыполненные задачи выбранного дня - середина списка. */
const pendingItems = (wrapper: VueWrapper) =>
	wrapper.findAll('.tasks__item:not(.--is-done):not(.--is-overdue)');

/** Просроченные - над задачами дня, отличаются рамкой. */
const overdueItems = (wrapper: VueWrapper) => wrapper.findAll('.tasks__item.--is-overdue');

/**
 * Порядок карточек в списке: просроченные, задачи дня, закрытые. Разделителей
 * между ними нет - порядок и вид карточки и есть вся разметка.
 */
const itemKinds = (wrapper: VueWrapper): string[] =>
	wrapper.findAll('.tasks__item').map((item) => {
		if (item.classes('--is-overdue')) return 'просроченная';

		return item.classes('--is-done') ? 'закрытая' : 'дня';
	});

/** Закрытые в этот день - хвост списка с перечёркнутым заголовком. */
const doneItems = (wrapper: VueWrapper) => wrapper.findAll('.tasks__item.--is-done');

/**
 * Отметить все чекбоксы первой карточки - задача закрывается только целиком.
 * После каждой галочки ждём пересчёта: файл переписывается, и разметка едет.
 */
const checkAll = async (wrapper: VueWrapper, item = 0) => {
	for (;;) {
		const card = wrapper.findAll('.tasks__item')[item];
		const box = card?.findAll('input.task-list-item-checkbox')
			.find((input) => !(input.element as HTMLInputElement).checked);

		if (!box) break;

		await box.trigger('click');
		vi.advanceTimersByTime(300);
		await flushPromises();
	}

	vi.advanceTimersByTime(300);
	await flushPromises();
};

/** Дать сработать debounce пересчёта и дождаться всех чтений. */
const settle = async () => {
	vi.advanceTimersByTime(300);
	await flushPromises();
};

const clickDay = async (wrapper: VueWrapper, date: string) => {
	await cellFor(wrapper, date).trigger('click');
	await flushPromises();
};

beforeEach(() => {
	useFixedClock();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('сетка календаря', () => {
	it('строит 6 недель и начинается с понедельника', async () => {
		const { wrapper } = await mountCalendar();

		expect(wrapper.findAll('.week-day')).toHaveLength(42);
		expect(wrapper.findAll('.week-name').map((w) => w.text()))
			.toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
	});

	it('дополняет сетку хвостами соседних месяцев', async () => {
		const { wrapper } = await mountCalendar();
		const cells = wrapper.findAll('.week-day');

		// 27 июля - понедельник перед 1 августа.
		expect(cells[0].text()).toBe('27');
		expect(cells[0].classes()).toContain('--is-other-month');

		expect(cellFor(wrapper, '2026-08-01').classes()).not.toContain('--is-other-month');
		expect(cellFor(wrapper, '2026-08-31').classes()).not.toContain('--is-other-month');
		expect(cellFor(wrapper, '2026-09-01').classes()).toContain('--is-other-month');
	});

	it('месяц, начинающийся в воскресенье, не съезжает на неделю', async () => {
		const { wrapper } = await mountCalendar();

		// Ноябрь 2026 начинается в воскресенье: сетка стартует с 26 октября.
		for (let i = 0; i < 3; i++) {
			await wrapper.find('.calendar__header-next-button').trigger('click');
		}

		expect(wrapper.find('.calendar__header-month-year-button').text()).toBe('Ноябрь 2026');

		const cells = wrapper.findAll('.week-day');
		expect(cells[0].text()).toBe('26');
		expect(cells[6].text()).toBe('1');
		expect(cells[6].classes()).not.toContain('--is-other-month');
	});

	it('помечает сегодняшний день ровно один раз', async () => {
		const { wrapper } = await mountCalendar();
		const todayCells = wrapper.findAll('.week-day.--is-today');

		expect(todayCells).toHaveLength(1);
		expect(todayCells[0].text()).toBe('13');
	});

	it('на старте выбран сегодняшний день', async () => {
		const { wrapper } = await mountCalendar();
		const focused = wrapper.findAll('.week-day.--is-focused');

		expect(focused).toHaveLength(1);
		expect(focused[0].text()).toBe('13');
	});
});

describe('навигация по месяцам', () => {
	const title = (wrapper: VueWrapper) => wrapper.find('.calendar__header-month-year-button');

	it('листает назад и вперёд', async () => {
		const { wrapper } = await mountCalendar();

		expect(title(wrapper).text()).toBe('Август 2026');

		await wrapper.find('.calendar__header-prev-button').trigger('click');
		expect(title(wrapper).text()).toBe('Июль 2026');

		await wrapper.find('.calendar__header-next-button').trigger('click');
		await wrapper.find('.calendar__header-next-button').trigger('click');
		expect(title(wrapper).text()).toBe('Сентябрь 2026');
	});

	it('переходит через границу года', async () => {
		const { wrapper } = await mountCalendar();

		for (let i = 0; i < 8; i++) {
			await wrapper.find('.calendar__header-prev-button').trigger('click');
		}

		expect(title(wrapper).text()).toBe('Декабрь 2025');
	});

	it('клик по заголовку возвращает к текущему месяцу', async () => {
		const { wrapper } = await mountCalendar();

		await wrapper.find('.calendar__header-prev-button').trigger('click');
		expect(title(wrapper).classes()).not.toContain('--is-current-month');

		await title(wrapper).trigger('click');
		expect(title(wrapper).text()).toBe('Август 2026');
		expect(title(wrapper).classes()).toContain('--is-current-month');
	});

	it('подсвечивает заголовок только на текущем месяце', async () => {
		const { wrapper } = await mountCalendar();

		// Тот же месяц, но другой год - подсветки быть не должно.
		for (let i = 0; i < 12; i++) {
			await wrapper.find('.calendar__header-next-button').trigger('click');
		}

		expect(title(wrapper).text()).toBe('Август 2027');
		expect(title(wrapper).classes()).not.toContain('--is-current-month');
	});
});

describe('состояние дней', () => {
	it('незакрытая задача в прошлом - просрочка', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Выбросить мусор.md': taskNoteText({ date: '2026-08-10' }) },
		});

		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(true);
	});

	it('незакрытая задача сегодня и в будущем - активная', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Сегодня.md': taskNoteText({ date: TODAY }),
				'Потом.md': taskNoteText({ date: '2026-08-20' }),
			},
		});

		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-20')).toBe(true);
	});

	it('закрытая разовая задача пропадает с календаря', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Закрытая.md': taskNoteText({
					date: '2026-08-11',
					done: ['2026-08-11'],
				}),
			},
		});

		expect(hasTaskOn(wrapper, '2026-08-11')).toBe(false);
		expect(wrapper.findAll('.week-day--dot')).toHaveLength(0);
	});

	it('выполненные дни повтора чистые, а «Дата» ждёт следующего раза', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: TODAY,
					done: ['2026-08-11', '2026-08-12'],
					repeat: 'каждый день',
				}),
			},
		});

		expect(hasTaskOn(wrapper, '2026-08-11')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-12')).toBe(false);
		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-14')).toBe(true);
		// До первого выполнения задачи ещё не было.
		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(false);
	});

	it('недельный повтор с днём недели отмечает только эти дни', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({
					date: TODAY,
					repeat: 'каждые 2 недели в субботу',
				}),
			},
		});

		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-15')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-22')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-29')).toBe(true);
	});

	it('повтор с перечислением дней недели читается из свойства', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Тренировка.md': taskNoteText({
					date: TODAY,
					repeat: 'каждую неделю в субботу, понедельник',
				}),
			},
		});

		expect(hasTaskOn(wrapper, '2026-08-15')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-17')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-22')).toBe(true);
	});

	it('точка стоит только на невыполненных днях', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-15',
					done: ['2026-08-13', '2026-08-14'],
					repeat: 'каждый день',
				}),
				'Забытая.md': taskNoteText({ date: '2026-08-10' }),
			},
		});

		expect(hasDot(wrapper, '2026-08-10')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(true);

		// Дни из журнала закрытий - чистые.
		expect(hasDot(wrapper, '2026-08-13')).toBe(false);
		expect(hasDot(wrapper, '2026-08-14')).toBe(false);

		expect(hasDot(wrapper, '2026-08-15')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-15')).toBe(true);
	});

	it('точка рисуется на днях с задачами и только на них', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Просроченная.md': taskNoteText({ date: '2026-08-10' }),
				'Сегодняшняя.md': taskNoteText({ date: '2026-08-11' }),
				'Будущая.md': taskNoteText({ date: '2026-08-20' }),
			},
		});

		expect(hasDot(wrapper, '2026-08-10')).toBe(true);
		expect(hasDot(wrapper, '2026-08-11')).toBe(true);
		expect(hasDot(wrapper, '2026-08-20')).toBe(true);
		expect(hasDot(wrapper, '2026-08-19')).toBe(false);
		expect(wrapper.findAll('.week-day--dot')).toHaveLength(3);
	});

	it('день без задач остаётся без точки', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Задача.md': taskNoteText({ date: '2026-08-20' }) },
		});

		expect(hasTaskOn(wrapper, '2026-08-19')).toBe(false);
	});

	it('повтор красит все свои дни', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-12',
					done: ['2026-08-12'],
					repeat: 'Каждые 2 дня',
				}),
			},
		});

		expect(hasTaskOn(wrapper, '2026-08-12')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-13')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-14')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-16')).toBe(true);
	});

	it('просрочка остаётся в своём дне и сегодня не трогает', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Забытая.md': taskNoteText({ date: '2026-08-10' }) },
		});

		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(true);
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
	});

	it('перенос даты в будущее убирает просрочку', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'Забытая.md': taskNoteText({ date: '2026-08-10' }) },
		});

		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(true);

		await vault.modify(
			new TFile('Забытая.md'),
			taskNoteText({ date: '2026-08-20' })
		);
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-20')).toBe(true);
	});

	it('заметка без свойства «Дата» задачей не считается', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Обычная заметка.md': '---\nТег: заметка\n---\n\nтекст\n',
				'Совсем простая.md': 'просто текст\n',
			},
		});

		expect(wrapper.findAll('.week-day--dot')).toHaveLength(0);
	});
});

describe('задачи выбранного дня', () => {
	const files = {
		'Дела/Купить молоко.md': taskNoteText({
			date: '2026-08-12',
			done: ['2026-08-12', '2026-08-10'],
			repeat: 'Каждый день',
			body: '- [ ] Подзадача 1\n- [ ] Подзадача 2\n\t- [ ] Подзадача 2.1',
		}),
		'Дела/Отбросить сомнения.md': taskNoteText({ date: '2026-08-14' }),
	};

	it('на старте показывает задачи сегодняшнего дня', async () => {
		const { wrapper } = await mountCalendar({ files });

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Купить молоко']);
	});

	it('отдаёт наименование, путь до файла и текст после свойств', async () => {
		const { wrapper } = await mountCalendar({ files });

		await clickDay(wrapper, '2026-08-14');

		expect(selectedTasks(wrapper)).toEqual([
			{
				// Наименование - имя файла, свойства под него нет.
				task: 'Купить молоко',
				link: 'Дела/Купить молоко.md',
				date: '2026-08-14',
				body: '- [ ] Подзадача 1\n- [ ] Подзадача 2\n\t- [ ] Подзадача 2.1',
			},
			{
				task: 'Отбросить сомнения',
				link: 'Дела/Отбросить сомнения.md',
				date: '2026-08-14',
				body: '',
			},
		]);
	});

	it('в теле остаются только списки', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({
					date: TODAY,
					body: [
						'## Заголовок',
						'Обычный абзац',
						'- [ ] Подзадача 1',
						'',
						'\t- [ ] Подзадача 1.1',
						'> цитата',
						'1. Пункт нумерованного',
						'Ещё абзац',
					].join('\n'),
				}),
			},
		});

		expect(selectedTasks(wrapper)[0].body).toBe(
			'- [ ] Подзадача 1\n\t- [ ] Подзадача 1.1\n1. Пункт нумерованного'
		);
	});

	it('тело без списков не показывается вовсе', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({
					date: TODAY,
					body: '## Заголовок\n\nОбычный абзац',
				}),
			},
		});

		expect(selectedTasks(wrapper)[0].body).toBe('');
		expect(wrapper.find('.tasks__item-body').exists()).toBe(false);
	});

	it('день без задач очищает список', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Задача.md': taskNoteText({ date: '2026-08-20' }) },
		});

		await clickDay(wrapper, '2026-08-20');
		expect(selectedTasks(wrapper)).toHaveLength(1);

		await clickDay(wrapper, '2026-08-19');
		expect(selectedTasks(wrapper)).toEqual([]);
	});

	it('просроченная задача приходит в свой день, а не в сегодня', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Забытая.md': taskNoteText({ date: '2026-08-10' }) },
		});

		await clickDay(wrapper, TODAY);
		expect(selectedTasks(wrapper)).toEqual([]);

		await clickDay(wrapper, '2026-08-10');
		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Забытая']);
	});

	it('ответ на устаревший клик не перетирает выбор', async () => {
		const context = createPluginDouble({
			files: {
				'Медленная.md': taskNoteText({ date: '2026-08-18' }),
				'Быстрая.md': taskNoteText({ date: '2026-08-19' }),
			},
		});

		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });
		await flushPromises();

		// Тело «Медленной» читается дольше, чем тело «Быстрой».
		let releaseSlow = (): void => {};
		const slow = new Promise<void>((resolve) => {
			releaseSlow = resolve;
		});
		vi.spyOn(context.vault, 'cachedRead').mockImplementation(async (file) => {
			if (file.path === 'Медленная.md') await slow;

			return context.vault.contentOf(file.path) ?? '';
		});

		await cellFor(wrapper, '2026-08-18').trigger('click');
		await cellFor(wrapper, '2026-08-19').trigger('click');
		await flushPromises();

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Быстрая']);

		releaseSlow();
		await flushPromises();

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Быстрая']);
	});

	it('ошибка чтения тела не роняет список', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const context = createPluginDouble({
			files: { 'Битая.md': taskNoteText({ date: TODAY, body: '- пункт' }) },
		});
		context.vault.failures.read = new Set(['Битая.md']);

		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });
		await flushPromises();

		expect(selectedTasks(wrapper)).toEqual([
			{ task: 'Битая', link: 'Битая.md', date: TODAY, body: '' },
		]);
	});
});

describe('«Дата» неподвижна', () => {
	it('плагин не переписывает свойства при скане', async () => {
		const { app } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-10',
					done: ['2026-08-10', '2026-08-11'],
					repeat: 'каждый день',
				}),
			},
		});

		// Раньше здесь «Дата» уезжала на первый невыполненный повтор. Теперь она
		// точка отсчёта, и трогать заметку скану незачем.
		expect(app.fileManager.calls).toHaveLength(0);
	});

	it('отметка выполнения «Дату» не двигает', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: TODAY,
					repeat: 'каждый день',
					body: '- [ ] Купить молоко',
				}),
			},
		});

		await checkAll(wrapper);

		expect(vault.contentOf('Купить молоко.md')).toContain(`Дата: ${TODAY}`);
		expect(vault.contentOf('Купить молоко.md')).toContain(`  - ${TODAY}`);
	});

	it('повторы считаются от «Даты» вперёд', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-11',
					done: ['2026-08-12'],
					repeat: 'каждый день',
				}),
			},
		});

		// До «Даты» задачи нет, дальше - каждый день, кроме дня из журнала.
		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-11')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-12')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-13')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-20')).toBe(true);
	});

	it('невыполненные повторы в прошлом остаются просроченными', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-10',
					done: [TODAY],
					repeat: 'каждый день',
				}),
			},
		});

		// Закрыли только сегодня - три пропущенных дня никуда не делись.
		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-11')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-12')).toBe(true);
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
	});

	it('разовую задачу закрывает первая же запись в «Выполнено»', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'Разовая.md': taskNoteText({ date: TODAY, body: '- [ ] Разовая' }) },
		});

		await checkAll(wrapper);

		expect(vault.contentOf('Разовая.md')).toContain(`Дата: ${TODAY}`);
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
	});
});

describe('список задач под календарём', () => {
	const body = '- [ ] Подзадача 1\n- [ ] Подзадача 2\n\t- [ ] Подзадача 2.1';

	const withTasks = () => mountCalendar({
		files: {
			'Дела/Купить молоко.md': taskNoteText({
				date: TODAY,
				repeat: 'каждый день',
				body,
			}),
			'Дела/Отбросить сомнения.md': taskNoteText({ date: TODAY }),
		},
	});

	it('показывает по строке на задачу дня', async () => {
		const { wrapper } = await withTasks();

		expect(pendingItems(wrapper)).toHaveLength(2);
		expect(selectedTasks(wrapper).map((task) => task.task))
			.toEqual(['Купить молоко', 'Отбросить сомнения']);
		// Тело есть только у той, где оно непустое.
		expect(wrapper.findAll('.tasks__item-body')).toHaveLength(1);
	});

	it('смена дня перерисовывает список', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Сегодня.md': taskNoteText({ date: TODAY, body: '- сегодня' }),
				'Завтра.md': taskNoteText({ date: '2026-08-14', body: '- завтра' }),
			},
		});

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Сегодня']);

		await clickDay(wrapper, '2026-08-14');

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Завтра']);
	});

	it('день без задач - пустой список', async () => {
		const { wrapper } = await withTasks();

		// 10 августа - раньше «Даты», повтор туда не разворачивается.
		await clickDay(wrapper, '2026-08-10');

		expect(pendingItems(wrapper)).toHaveLength(0);
	});

	it('кнопка открывает заметку в режиме правки', async () => {
		const { wrapper, app } = await withTasks();

		await wrapper.find('.tasks__item-link-button').trigger('click');
		await flushPromises();

		expect(app.workspace.openLinkCalls).toHaveLength(1);
		expect(app.workspace.openLinkCalls[0].linktext).toBe('Дела/Купить молоко.md');
		expect(app.workspace.openLinkCalls[0].openViewState).toEqual({ state: { mode: 'source' } });
	});

	it('ошибка открытия не роняет календарь', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { wrapper, app } = await withTasks();
		app.workspace.openLinkFails = true;

		await wrapper.find('.tasks__item-link-button').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось открыть заметку');
		expect(pendingItems(wrapper)).toHaveLength(2);
	});

	it('день попадает в «Выполнено», только когда отмечены все чекбоксы', async () => {
		const { wrapper, vault } = await withTasks();

		// Одна галочка из трёх - задача ещё в работе.
		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(vault.contentOf('Дела/Купить молоко.md')).not.toContain(`  - ${TODAY}`);

		await checkAll(wrapper);

		expect(vault.contentOf('Дела/Купить молоко.md')).toContain(`  - ${TODAY}`);
	});

	it('снятая галочка снова открывает задачу', async () => {
		const { wrapper, vault } = await withTasks();

		await checkAll(wrapper);
		expect(vault.contentOf('Дела/Купить молоко.md')).toContain(`  - ${TODAY}`);

		await doneItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(vault.contentOf('Дела/Купить молоко.md')).not.toContain(`  - ${TODAY}`);
		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
	});

	it('отмеченный день повтора уходит с календаря, а следующий остаётся', async () => {
		const { wrapper, vault } = await withTasks();

		await checkAll(wrapper);

		// «Дата» осталась на месте - двигается не она, а журнал закрытий.
		expect(vault.contentOf('Дела/Купить молоко.md')).toContain(`Дата: ${TODAY}`);
		// Сегодня молоко закрыто, назавтра повтор ждёт снова.
		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Отбросить сомнения']);

		await clickDay(wrapper, '2026-08-14');

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Купить молоко']);
	});

	it('повторная отметка того же дня не задваивает запись', async () => {
		const { wrapper, vault } = await withTasks();

		await checkAll(wrapper);
		// Второй проход по уже отмеченным чекбоксам ничего не меняет.
		await checkAll(wrapper);

		const content = vault.contentOf('Дела/Купить молоко.md') ?? '';
		expect(content.split(`  - ${TODAY}`)).toHaveLength(2);
	});

	it('галочка подзадачи правит строку в файле', async () => {
		const { wrapper, vault } = await withTasks();

		await wrapper.findAll('input.task-list-item-checkbox')[1].trigger('click');
		await flushPromises();

		const content = vault.contentOf('Дела/Купить молоко.md') ?? '';
		expect(content).toContain('- [ ] Подзадача 1');
		expect(content).toContain('- [x] Подзадача 2');
		// Соседняя вложенная подзадача не тронута.
		expect(content).toContain('\t- [ ] Подзадача 2.1');
	});

	it('повторная галочка подзадачи снимает отметку', async () => {
		const { wrapper, vault } = await withTasks();

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		vi.advanceTimersByTime(300);
		await flushPromises();
		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(vault.contentOf('Дела/Купить молоко.md')).toContain('- [ ] Подзадача 1');
	});

	it('ссылка в теле задачи открывает заметку', async () => {
		const { wrapper, app } = await mountCalendar({
			files: {
				'Дела/Купить молоко.md': taskNoteText({
					date: TODAY,
					body: '- [ ] Спросить у [[Соседа]]',
				}),
			},
		});

		await wrapper.find('.tasks__item-body a.internal-link').trigger('click');
		await flushPromises();

		expect(app.workspace.openLinkCalls).toHaveLength(1);
		expect(app.workspace.openLinkCalls[0].linktext).toBe('Соседа');
		expect(app.workspace.openLinkCalls[0].sourcePath).toBe('Дела/Купить молоко.md');
	});

	it('ошибка записи подзадачи не роняет календарь', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { wrapper, vault } = await withTasks();
		vault.failures.modify = new Set(['Дела/Купить молоко.md']);

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось отметить подзадачу');
		expect(pendingItems(wrapper)).toHaveLength(2);
	});

	it('отмеченная разовая задача уходит из списка и с календаря', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'Разовая.md': taskNoteText({ date: TODAY, body: '- [ ] Разовая' }) },
		});

		await checkAll(wrapper);

		expect(vault.contentOf('Разовая.md')).toContain(`  - ${TODAY}`);
		expect(pendingItems(wrapper)).toHaveLength(0);
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
		// Из списка дня она не исчезает совсем - уезжает в хвост, отметку можно снять.
		expect(doneItems(wrapper)).toHaveLength(1);
	});

	it('ошибка записи отметки не роняет календарь', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const context = createPluginDouble({
			files: { 'Разовая.md': taskNoteText({ date: TODAY, body: '- [ ] Разовая' }) },
		});
		context.vault.failures.modify = new Set(['Разовая.md']);
		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });
		await flushPromises();

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось отметить подзадачу');
		expect(pendingItems(wrapper)).toHaveLength(1);
	});
});

describe('закрытые задачи в хвосте списка', () => {
	it('закрытая в этот день разовая задача уезжает в хвост', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Разовая.md': taskNoteText({ date: TODAY, done: [TODAY] }),
			},
		});

		expect(pendingItems(wrapper)).toHaveLength(0);
		expect(doneItems(wrapper)).toHaveLength(1);
		expect(completedTasks(wrapper).map((task) => task.task)).toEqual(['Разовая']);
		// Точку в календаре закрытая задача не ставит.
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
	});

	it('закрытые стоят в конце списка и без разделителя', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Разовая.md': taskNoteText({ date: TODAY, done: [TODAY] }),
				'Ждёт.md': taskNoteText({ date: TODAY }),
			},
		});

		expect(itemKinds(wrapper)).toEqual(['дня', 'закрытая']);
		expect(wrapper.find('.tasks__divider').exists()).toBe(false);
	});

	it('закрытые идут после невыполненных', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Закрытая.md': taskNoteText({ date: TODAY, done: [TODAY] }),
				'Ждёт.md': taskNoteText({ date: TODAY }),
			},
		});

		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Ждёт']);
		expect(completedTasks(wrapper).map((task) => task.task)).toEqual(['Закрытая']);
	});

	it('прошедшее закрытие повтора видно в своём дне', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: TODAY,
					done: [TODAY],
					repeat: 'каждый день',
				}),
			},
		});

		expect(doneItems(wrapper)).toHaveLength(1);

		await clickDay(wrapper, '2026-08-14');

		expect(pendingItems(wrapper)).toHaveLength(1);
		expect(doneItems(wrapper)).toHaveLength(0);
	});

	it('день, вписанный в журнал мимо повторки, тоже виден', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Через день.md': taskNoteText({
					date: TODAY,
					done: ['2026-08-14'],
					repeat: 'каждые 2 дня',
				}),
			},
		});

		// 14 августа повтором не является - но запись в журнале есть, и снять её нужно.
		await clickDay(wrapper, '2026-08-14');

		expect(doneItems(wrapper)).toHaveLength(1);
	});

	it('у закрытой задачи список показан целиком', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Разовая.md': taskNoteText({
					date: TODAY,
					done: [TODAY],
					body: '- [x] Подзадача 1\n- [x] Подзадача 2\n\t- [x] Подзадача 2.1',
				}),
			},
		});

		const boxes = doneItems(wrapper)[0].findAll('input.task-list-item-checkbox');

		// Список не срезается: видно, что именно закрыли.
		expect(boxes).toHaveLength(3);
		expect(boxes.map((box) => (box.element as HTMLInputElement).checked))
			.toEqual([true, true, true]);
	});

	it('у закрытого повтора показан блок этого дня', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-12',
					done: [TODAY],
					repeat: 'каждый день',
					body: [
						'- 2026-08-12',
						'\t- [ ] Раз',
						`- ${TODAY}`,
						'\t- [x] Раз',
						'\t- [x] Два',
					].join('\n'),
				}),
			},
		});

		const boxes = doneItems(wrapper)[0].findAll('input.task-list-item-checkbox');

		// Блок 12 августа сюда не попадает - у каждой итерации свой набор.
		expect(boxes).toHaveLength(2);
		expect(boxes.map((box) => (box.element as HTMLInputElement).checked))
			.toEqual([true, true]);
	});

	it('снятая галочка у закрытой возвращает её в работу', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Разовая.md': taskNoteText({
					date: TODAY,
					done: [TODAY],
					body: '- [x] Раз\n- [x] Два',
				}),
			},
		});

		await doneItems(wrapper)[0].findAll('input.task-list-item-checkbox')[1].trigger('click');
		await settle();

		const content = vault.contentOf('Разовая.md') ?? '';

		expect(content).not.toContain(`  - ${TODAY}`);
		// Снялась только своя галочка - остальное сделанное на месте.
		expect(content).toContain('- [x] Раз');
		expect(content).toContain('- [ ] Два');
		expect(pendingItems(wrapper)).toHaveLength(1);
	});

	it('отмена у повторяющейся задачи «Дату» не трогает, а день возвращает', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-10',
					done: [TODAY],
					repeat: 'каждый день',
					body: `- ${TODAY}\n\t- [x] Купить молоко`,
				}),
			},
		});

		await doneItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await settle();

		expect(vault.contentOf('Купить молоко.md')).toContain('Дата: 2026-08-10');
		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
	});

	it('снятая галочка трогает только свой день, остальной журнал цел', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Купить молоко.md': taskNoteText({
					date: '2026-08-12',
					done: ['2026-08-12', TODAY],
					repeat: 'каждый день',
					body: `- ${TODAY}\n\t- [x] Купить молоко`,
				}),
			},
		});

		await doneItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await settle();

		const content = vault.contentOf('Купить молоко.md') ?? '';

		expect(content).not.toContain(`  - ${TODAY}`);
		// У 12 августа блока нет - сверка его не трогает, запись на месте.
		expect(content).toContain('  - 2026-08-12');
	});

	it('ошибка снятия галочки не роняет календарь', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const context = createPluginDouble({
			files: {
				'Разовая.md': taskNoteText({ date: TODAY, done: [TODAY], body: '- [x] Разовая' }),
			},
		});
		context.vault.failures.modify = new Set(['Разовая.md']);
		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });
		await flushPromises();

		await doneItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось отметить подзадачу');
		expect(doneItems(wrapper)).toHaveLength(1);
	});

	it('кнопка ссылки у закрытой задачи открывает заметку', async () => {
		const { wrapper, app } = await mountCalendar({
			files: {
				'Дела/Разовая.md': taskNoteText({ date: TODAY, done: [TODAY] }),
			},
		});

		await doneItems(wrapper)[0].find('.tasks__item-link-button').trigger('click');
		await flushPromises();

		expect(app.workspace.openLinkCalls[0].linktext).toBe('Дела/Разовая.md');
	});

	it('смена дня перерисовывает хвост', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Вчера.md': taskNoteText({ date: '2026-08-12', done: ['2026-08-12'] }),
			},
		});

		expect(doneItems(wrapper)).toHaveLength(0);

		await clickDay(wrapper, '2026-08-12');

		expect(doneItems(wrapper)).toHaveLength(1);
	});
});

describe('фильтр по папке с задачами', () => {
	it('читает только задачи указанной папки', async () => {
		const { wrapper } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: {
				'Задачи/Своя.md': taskNoteText({ date: '2026-08-03' }),
				'Другое/Чужая.md': taskNoteText({ date: '2026-08-04' }),
			},
			folders: ['Задачи', 'Другое'],
		});

		expect(hasTaskOn(wrapper, '2026-08-03')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-04')).toBe(false);
	});

	it('работает с вложенной папкой и лишними слэшами', async () => {
		const { wrapper } = await mountCalendar({
			tasksFolderPath: '/Задачи/Личные/',
			files: {
				'Задачи/Личные/Своя.md': taskNoteText({ date: '2026-08-03' }),
				'Задачи/Рабочие/Чужая.md': taskNoteText({ date: '2026-08-04' }),
			},
			folders: ['Задачи', 'Задачи/Личные', 'Задачи/Рабочие'],
		});

		expect(hasTaskOn(wrapper, '2026-08-03')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-04')).toBe(false);
	});

	it('папка с похожим именем не цепляется', async () => {
		const { wrapper } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: {
				'Старые Задачи/Чужая.md': taskNoteText({ date: '2026-08-04' }),
				'Задачи.md': taskNoteText({ date: '2026-08-05' }),
				'Задачи/Своя.md': taskNoteText({ date: '2026-08-06' }),
			},
			folders: ['Старые Задачи', 'Задачи'],
		});

		expect(hasTaskOn(wrapper, '2026-08-04')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-05')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-06')).toBe(true);
	});
});

describe('реактивность файлов задач', () => {
	/** Дать debounce отработать и дождаться перерисовки. */
	it('перемещение файла в папку задач подхватывается', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: { 'Входящие/Уборка.md': taskNoteText({ date: '2026-08-18' }) },
			folders: ['Задачи', 'Входящие'],
		});

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);

		await vault.rename(new TFile('Входящие/Уборка.md'), 'Задачи/Уборка.md');
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);
	});

	it('перемещение файла из папки задач убирает отметку', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: { 'Задачи/Уборка.md': taskNoteText({ date: '2026-08-18' }) },
			folders: ['Задачи', 'Архив'],
		});

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);

		await vault.rename(new TFile('Задачи/Уборка.md'), 'Архив/Уборка.md');
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);
	});

	it('переименование внутри папки не теряет задачу', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: { 'Задачи/Уборка.md': taskNoteText({ date: '2026-08-18' }) },
			folders: ['Задачи'],
		});

		await vault.rename(new TFile('Задачи/Уборка.md'), 'Задачи/Генеральная уборка.md');
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);

		await clickDay(wrapper, '2026-08-18');

		// Имя задачи берётся из имени файла - оно тоже должно обновиться.
		expect(selectedTasks(wrapper)).toEqual([
			{
				task: 'Генеральная уборка',
				link: 'Задачи/Генеральная уборка.md',
				date: '2026-08-18',
				body: '',
			},
		]);
	});

	it('созданный файл появляется в календаре', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			folders: ['Задачи'],
		});

		await vault.create('Задачи/Новая.md', taskNoteText({ date: '2026-08-19' }));
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-19')).toBe(true);
	});

	it('удалённый файл пропадает из календаря', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: { 'Задачи/Уборка.md': taskNoteText({ date: '2026-08-18' }) },
			folders: ['Задачи'],
		});

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);

		await vault.delete(new TFile('Задачи/Уборка.md'));
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);
	});

	it('правка свойств подхватывается через кэш метаданных', async () => {
		const { wrapper, app, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: { 'Задачи/Уборка.md': taskNoteText({ date: '2026-08-18' }) },
			folders: ['Задачи'],
		});

		const file = new TFile('Задачи/Уборка.md');
		vault.contentOf(file.path);
		await vault.modify(file, taskNoteText({ date: '2026-08-25' }));
		app.metadataCache.trigger('changed', file);
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-25')).toBe(true);
	});

	it('список выбранного дня обновляется вместе с файлом', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: {
				'Задачи/Уборка.md': taskNoteText({ date: TODAY, body: '- старый пункт' }),
			},
			folders: ['Задачи'],
		});

		expect(selectedTasks(wrapper)[0].body).toBe('- старый пункт');

		await vault.modify(
			new TFile('Задачи/Уборка.md'),
			taskNoteText({ date: TODAY, body: '- новый пункт' })
		);
		await settle();

		expect(selectedTasks(wrapper)[0].body).toBe('- новый пункт');
	});

	it('заметка без всех четырёх свойств задачей не считается', async () => {
		const { wrapper, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: {
				// Все свойства, кроме «Повтор».
				'Задачи/Почти задача.md': [
					'---',
					'Задача: Почти',
					'Дата: 2026-08-18',
					'Выполнено:',
					'---',
					'',
					'текст',
					'',
				].join('\n'),
			},
			folders: ['Задачи'],
		});

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);

		// Дописали недостающее свойство - заметка стала задачей.
		await vault.modify(
			new TFile('Задачи/Почти задача.md'),
			taskNoteText({ date: '2026-08-18' })
		);
		await settle();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);
	});

	it('чужая заметка с похожим свойством в календарь не лезет', async () => {
		const { wrapper } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: {
				'Задачи/Дневник.md': [
					'---',
					'Дата: 2026-08-19',
					'Настроение: хорошее',
					'---',
					'',
					'запись',
					'',
				].join('\n'),
			},
			folders: ['Задачи'],
		});

		expect(hasTaskOn(wrapper, '2026-08-19')).toBe(false);
	});

	it('изменение файла вне папки задач не вызывает пересчёт', async () => {
		const { app, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: {
				'Задачи/Уборка.md': taskNoteText({ date: TODAY }),
				'Архив/Чужая.md': taskNoteText({ date: TODAY }),
			},
			folders: ['Задачи', 'Архив'],
		});
		const scansBefore = app.metadataCache.calls.getFileCache;

		await vault.modify(new TFile('Архив/Чужая.md'), taskNoteText({ date: '2026-08-20' }));
		await settle();

		expect(app.metadataCache.calls.getFileCache).toBe(scansBefore);
	});
});

describe('смена папки в настройках', () => {
	it('задачи перечитываются без перезапуска плагина', async () => {
		const { wrapper, changeTasksFolderPath } = await mountCalendar({
			tasksFolderPath: 'Старая',
			files: {
				'Старая/Своя.md': taskNoteText({ date: '2026-08-18' }),
				'Новая/Другая.md': taskNoteText({ date: '2026-08-20' }),
			},
			folders: ['Старая', 'Новая'],
		});

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-20')).toBe(false);

		changeTasksFolderPath('Новая');
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);
		expect(hasTaskOn(wrapper, '2026-08-20')).toBe(true);
	});

	it('новый путь сразу применяется и к фильтру событий', async () => {
		const { app, vault, changeTasksFolderPath } = await mountCalendar({
			tasksFolderPath: 'Старая',
			files: { 'Новая/Другая.md': taskNoteText({ date: TODAY }) },
			folders: ['Старая', 'Новая'],
		});

		changeTasksFolderPath('Новая');
		vi.advanceTimersByTime(300);
		await flushPromises();

		const scansBefore = app.metadataCache.calls.getFileCache;
		vault.trigger('modify', new TFile('Новая/Другая.md'));
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(app.metadataCache.calls.getFileCache).toBeGreaterThan(scansBefore);
	});

	it('лишние слэши в новом пути не мешают', async () => {
		const { wrapper, changeTasksFolderPath } = await mountCalendar({
			tasksFolderPath: '/',
			files: { 'Задачи/Личные/Своя.md': taskNoteText({ date: '2026-08-18' }) },
			folders: ['Задачи', 'Задачи/Личные'],
		});

		changeTasksFolderPath('/Задачи/Личные/');
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);
	});

	it('закрытие календаря снимает подписку на настройки', async () => {
		const { wrapper, settingsListenerCount } = await mountCalendar();

		expect(settingsListenerCount()).toBe(1);

		wrapper.unmount();

		expect(settingsListenerCount()).toBe(0);
	});
});

describe('реакция на изменения хранилища', () => {
	it('подписывается на события хранилища и кэша, а при закрытии отписывается', async () => {
		const { wrapper, app, vault } = await mountCalendar();

		expect(vault.handlerCount('modify')).toBe(1);
		expect(vault.handlerCount('create')).toBe(1);
		expect(vault.handlerCount('delete')).toBe(1);
		expect(vault.handlerCount('rename')).toBe(1);
		expect(app.metadataCache.handlerCount('changed')).toBe(1);

		wrapper.unmount();

		expect(vault.handlerCount('modify')).toBe(0);
		expect(vault.handlerCount('create')).toBe(0);
		expect(vault.handlerCount('delete')).toBe(0);
		expect(vault.handlerCount('rename')).toBe(0);
		expect(app.metadataCache.handlerCount('changed')).toBe(0);
	});

	// Регрессия: подписка навешивалась после await в onMounted, и вкладка,
	// закрытая во время чтения хранилища, оставляла обработчики навсегда.
	it('закрытие во время загрузки не оставляет подписок', async () => {
		const context = createPluginDouble();
		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });

		wrapper.unmount();
		await flushPromises();

		expect(context.vault.handlerCount('modify')).toBe(0);
		expect(context.app.metadataCache.handlerCount('changed')).toBe(0);
	});

	it('перечитывает задачи после внешнего изменения файла', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'Задача.md': taskNoteText({ date: '2026-08-20' }) },
		});

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(false);

		await vault.modify(
			new TFile('Задача.md'),
			taskNoteText({ date: '2026-08-18' })
		);
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(hasTaskOn(wrapper, '2026-08-18')).toBe(true);
		expect(hasTaskOn(wrapper, '2026-08-20')).toBe(false);
	});

	it('склеивает серию изменений в один пересчёт', async () => {
		const { app, vault } = await mountCalendar({
			files: { 'Задача.md': taskNoteText({ date: TODAY }) },
		});
		const scansAfterMount = app.metadataCache.calls.getFileCache;

		for (let i = 0; i < 5; i++) {
			vault.trigger('modify', new TFile('Задача.md'));
			vi.advanceTimersByTime(50);
		}
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(app.metadataCache.calls.getFileCache - scansAfterMount).toBe(1);
	});

	it('не реагирует на файлы вне папки задач', async () => {
		const { app, vault } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			files: { 'Задачи/Задача.md': taskNoteText({ date: TODAY }) },
			folders: ['Задачи', 'Другое'],
		});
		const scansAfterMount = app.metadataCache.calls.getFileCache;

		vault.trigger('modify', new TFile('Другое/Чужой.md'));
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(app.metadataCache.calls.getFileCache).toBe(scansAfterMount);
	});

	it('после закрытия отложенный пересчёт не срабатывает', async () => {
		const { wrapper, app, vault } = await mountCalendar({
			files: { 'Задача.md': taskNoteText({ date: TODAY }) },
		});

		vault.trigger('modify', new TFile('Задача.md'));
		const scansBeforeUnmount = app.metadataCache.calls.getFileCache;
		wrapper.unmount();
		vi.advanceTimersByTime(300);
		await flushPromises();

		expect(app.metadataCache.calls.getFileCache).toBe(scansBeforeUnmount);
	});
});

describe('подсветка сегодняшнего дня', () => {
	it('переживает полночь', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'Задача.md': taskNoteText({ date: TODAY }) },
		});

		expect(cellFor(wrapper, TODAY).classes()).toContain('--is-today');

		// Календарь держат открытым сутками - день должен переехать сам.
		vi.setSystemTime(new Date('2026-08-14T00:30:00'));
		await vault.modify(new TFile('Задача.md'), taskNoteText({ date: TODAY }));
		await settle();

		expect(cellFor(wrapper, TODAY).classes()).not.toContain('--is-today');
		expect(cellFor(wrapper, '2026-08-14').classes()).toContain('--is-today');
	});
});

describe('отметка из самой заметки', () => {
	it('отметили все чекбоксы в файле - день попал в «Выполнено»', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({ date: TODAY, body: '- [ ] Раз\n- [ ] Два' }),
			},
		});

		expect(hasTaskOn(wrapper, TODAY)).toBe(true);

		// Так выглядит правка руками в редакторе или прилетевшая синхронизацией.
		await vault.modify(
			new TFile('Уборка.md'),
			taskNoteText({ date: TODAY, body: '- [x] Раз\n- [x] Два' })
		);
		await settle();

		expect(vault.contentOf('Уборка.md')).toContain(`  - ${TODAY}`);

		// Запись журнала - это ещё одно изменение файла, календарь догоняет следом.
		await settle();
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
	});

	it('снятая в файле галочка убирает день из «Выполнено»', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({ date: TODAY, done: [TODAY], body: '- [x] Раз' }),
			},
		});

		await vault.modify(
			new TFile('Уборка.md'),
			taskNoteText({ date: TODAY, done: [TODAY], body: '- [ ] Раз' })
		);
		await settle();

		// Выполнение считается по чекбоксам: снятая галочка снова открывает день.
		expect(vault.contentOf('Уборка.md')).not.toContain(`  - ${TODAY}`);

		await settle();
		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
	});

	it('закрытая разовая с отмеченным телом больше не переписывается', async () => {
		const { app, wrapper } = await mountCalendar({
			files: {
				// Так выглядит закрытая разовая: день в журнале, тело отмечено целиком.
				'Уборка.md': taskNoteText({
					date: TODAY,
					done: [TODAY],
					body: '- [x] Раз\n- [x] Два',
				}),
			},
		});

		await settle();
		await settle();

		// Журнал и тело сходятся - писать нечего. Иначе плагин ходил бы по кругу:
		// закрыл, открыл, закрыл.
		expect(app.fileManager.calls).toHaveLength(0);
		expect(completedTasks(wrapper).map((task) => task.task)).toEqual(['Уборка']);
	});

	it('задача без чекбоксов журнал не теряет', async () => {
		const { vault } = await mountCalendar({
			files: {
				// Дату вписали руками, отмечать в теле нечем - трогать её нельзя.
				'Без тела.md': taskNoteText({ date: TODAY, done: [TODAY], body: 'просто текст' }),
			},
		});

		expect(vault.contentOf('Без тела.md')).toContain(`  - ${TODAY}`);
	});

	it('остановленную задачу сверка не трогает', async () => {
		const { vault } = await mountCalendar({
			files: {
				'Пауза.md': taskNoteText({
					date: TODAY,
					done: [TODAY],
					repeat: 'каждый день',
					stopped: true,
					body: '- [ ] Раз',
				}),
			},
		});

		// Тело говорит «не сделано», но пауза значит «не лезь».
		expect(vault.contentOf('Пауза.md')).toContain(`  - ${TODAY}`);
	});

	it('своя же запись не уходит в бесконечный круг', async () => {
		const { vault } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({ date: TODAY, body: '- [x] Раз' }),
			},
		});

		const writes = vault.calls.modify;

		for (let i = 0; i < 3; i++) await settle();

		// Одна запись журнала - и всё успокоилось.
		expect(vault.calls.modify).toBe(writes);
	});
});

describe('«Стоп повтор»', () => {
	it('отмеченная галочка убирает задачу с календаря целиком', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Пауза.md': taskNoteText({
					date: '2026-08-10',
					repeat: 'каждый день',
					stopped: true,
				}),
			},
		});

		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(false);
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);
		expect(selectedTasks(wrapper)).toEqual([]);
	});

	it('снятая галочка возвращает задачу', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Пауза.md': taskNoteText({ date: TODAY, repeat: 'каждый день', stopped: true }),
			},
		});

		await vault.modify(
			new TFile('Пауза.md'),
			taskNoteText({ date: TODAY, repeat: 'каждый день', stopped: false })
		);
		await settle();

		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
	});
});

describe('создание задачи', () => {
	const createTask = async (wrapper: VueWrapper, name: string) => {
		await wrapper.find('.task__calendar-create-input').setValue(name);
		await wrapper.find('.task__calendar-create').trigger('submit');
		await flushPromises();
	};

	it('создаёт заметку по шаблону на выбранный день', async () => {
		const { wrapper, vault, app } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			folders: ['Задачи'],
		});

		await clickDay(wrapper, '2026-08-20');
		await createTask(wrapper, 'Купить молоко');

		const content = vault.contentOf('Задачи/2026-08-20 - Купить молоко.md');

		expect(content).toBeDefined();
		expect(content).toContain('Дата: 2026-08-20');
		expect(content).toContain('Выполнено:');
		expect(content).toContain('Повтор:');
		// В теле сразу чекбокс - иначе задачу нечем закрыть.
		expect(content).toContain('- [ ] Купить молоко');
	});

	it('созданная заметка сразу открывается на правку', async () => {
		const { wrapper, app } = await mountCalendar({
			tasksFolderPath: 'Задачи',
			folders: ['Задачи'],
		});

		await clickDay(wrapper, '2026-08-20');
		await createTask(wrapper, 'Купить молоко');

		expect(app.workspace.openLinkCalls).toEqual([
			{
				linktext: 'Задачи/2026-08-20 - Купить молоко.md',
				sourcePath: '',
				newLeaf: false,
				openViewState: { state: { mode: 'source' } },
			},
		]);
	});

	it('созданная задача сразу видна в календаре', async () => {
		const { wrapper, vault } = await mountCalendar();

		await createTask(wrapper, 'Купить молоко');
		await settle();

		expect(vault.contentOf('2026-08-13 - Купить молоко.md')).toBeDefined();
		expect(selectedTasks(wrapper).map((task) => task.task)).toEqual(['Купить молоко']);
	});

	it('запрещённые символы из имени файла выкидываются', async () => {
		const { wrapper, vault } = await mountCalendar();

		await createTask(wrapper, 'Купить / молоко: срочно');

		expect(vault.contentOf('2026-08-13 - Купить молоко срочно.md')).toBeDefined();
	});

	it('пустое название ничего не создаёт', async () => {
		const { wrapper, vault } = await mountCalendar();

		await createTask(wrapper, '   ');

		expect(vault.getMarkdownFiles()).toHaveLength(0);
	});

	it('существующую заметку не перезаписывает', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { '2026-08-13 - Купить молоко.md': 'старое содержимое' },
		});

		await createTask(wrapper, 'Купить молоко');

		expect(vault.contentOf('2026-08-13 - Купить молоко.md')).toBe('старое содержимое');
		expect(Notice.messages).toContain('Такая задача уже есть');
	});

	it('ошибка создания не роняет календарь', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { wrapper, vault } = await mountCalendar();
		vault.failures.create = new Set(['2026-08-13 - Купить молоко.md']);

		await createTask(wrapper, 'Купить молоко');

		expect(Notice.messages).toContain('Не удалось создать задачу');
	});
});

describe('просроченные задачи над списком дня', () => {
	it('незакрытая задача из прошлого показывается на сегодня', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Забытая.md': taskNoteText({ date: '2026-08-10', body: '- [ ] Забытая' }),
			},
		});

		expect(overdueItems(wrapper)).toHaveLength(1);
		expect(overdueTasks(wrapper).map((task) => task.task)).toEqual(['Забытая']);
		// День карточки - её пропущенный, а не сегодняшний.
		expect(overdueTasks(wrapper)[0].date).toBe('2026-08-10');
		// В списке самого дня её нет: она стоит в своём дне, а не в сегодняшнем.
		expect(pendingItems(wrapper)).toHaveLength(0);
	});

	it('порядок в списке: просроченные, задачи дня, закрытые', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Забытая.md': taskNoteText({ date: '2026-08-10' }),
				'Сегодняшняя.md': taskNoteText({ date: TODAY }),
				'Закрытая.md': taskNoteText({ date: TODAY, done: [TODAY] }),
			},
		});

		expect(itemKinds(wrapper)).toEqual(['просроченная', 'дня', 'закрытая']);
	});

	it('разделителей в списке нет вовсе', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Забытая.md': taskNoteText({ date: '2026-08-10' }),
				'Сегодняшняя.md': taskNoteText({ date: TODAY }),
				'Закрытая.md': taskNoteText({ date: TODAY, done: [TODAY] }),
			},
		});

		expect(wrapper.findAll('.tasks__divider')).toHaveLength(0);
	});

	it('несколько долгов идут от старого к свежему', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Свежая.md': taskNoteText({ date: '2026-08-12' }),
				'Старая.md': taskNoteText({ date: '2026-08-01' }),
			},
		});

		expect(overdueTasks(wrapper).map((task) => task.task)).toEqual(['Старая', 'Свежая']);
	});

	it('на других днях просроченные не показываются', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Забытая.md': taskNoteText({ date: '2026-08-10' }) },
		});

		expect(overdueItems(wrapper)).toHaveLength(1);

		await clickDay(wrapper, '2026-08-14');

		expect(overdueItems(wrapper)).toHaveLength(0);

		// Вернулись на сегодня - долг снова на месте.
		await clickDay(wrapper, TODAY);

		expect(overdueItems(wrapper)).toHaveLength(1);
	});

	it('даже на своём дне карточка просрочки не задваивается', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'Забытая.md': taskNoteText({ date: '2026-08-10' }) },
		});

		await clickDay(wrapper, '2026-08-10');

		expect(overdueItems(wrapper)).toHaveLength(0);
		expect(pendingItems(wrapper)).toHaveLength(1);
	});

	it('повтор с кучей пропусков даёт одну карточку на самый старый день', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Побриться.md': taskNoteText({
					date: '2026-08-01',
					repeat: 'каждый день',
					body: '- [ ] Побриться',
				}),
			},
		});

		expect(overdueItems(wrapper)).toHaveLength(1);
		expect(overdueTasks(wrapper)[0].date).toBe('2026-08-01');
	});

	it('закрыли долг - карточка перерисовалась на следующий пропущенный день', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Побриться.md': taskNoteText({
					date: '2026-08-11',
					repeat: 'каждый день',
					body: '- [ ] Побриться',
				}),
			},
		});

		expect(overdueTasks(wrapper)[0].date).toBe('2026-08-11');

		await overdueItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await settle();
		await settle();

		// В журнал ушёл день карточки, а не сегодняшний.
		expect(vault.contentOf('Побриться.md')).toContain('  - 2026-08-11');
		expect(overdueTasks(wrapper)[0].date).toBe('2026-08-12');
	});

	it('после закрытия долга галочка в карточке снята', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				// Один чекбокс: первая же галочка закрывает день.
				'Побриться.md': taskNoteText({
					date: '2026-08-11',
					repeat: 'каждый день',
					body: '- [ ] Побриться',
				}),
			},
		});

		const box = () => overdueItems(wrapper)[0].find('input.task-list-item-checkbox');

		await box().trigger('click');
		await settle();
		await settle();

		const content = vault.contentOf('Побриться.md') ?? '';

		// Закрытый день оставил себе свой набор с галочкой, а под следующий повтор
		// завёлся чистый - его и показывает карточка.
		expect(content).toContain('  - 2026-08-11');
		expect(content).toContain('- 2026-08-11\n\t- [x] Побриться');
		expect(content).toContain('- 2026-08-12\n\t- [ ] Побриться');
		expect(overdueTasks(wrapper)[0].date).toBe('2026-08-12');
		// Разметка карточки не должна остаться от прошлого дня - галочка снята.
		expect((box().element as HTMLInputElement).checked).toBe(false);
	});

	it('закрытая разовая просрочка уходит совсем', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Забытая.md': taskNoteText({ date: '2026-08-10', body: '- [ ] Забытая' }),
			},
		});

		await overdueItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await settle();
		await settle();

		expect(vault.contentOf('Забытая.md')).toContain('  - 2026-08-10');
		expect(overdueItems(wrapper)).toHaveLength(0);
		expect(hasTaskOn(wrapper, '2026-08-10')).toBe(false);
	});

	it('остановленная и закрытая задачи в просрочку не попадают', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'Пауза.md': taskNoteText({
					date: '2026-08-01',
					repeat: 'каждый день',
					stopped: true,
				}),
				'Закрытая.md': taskNoteText({ date: '2026-08-10', done: ['2026-08-10'] }),
			},
		});

		expect(overdueItems(wrapper)).toHaveLength(0);
	});
});

describe('чекбоксы по итерациям повтора', () => {
	const withTask = (body: string, fixture = {}) => mountCalendar({
		files: { 'Уборка.md': taskNoteText({ date: TODAY, body, ...fixture }) },
	});

	it('закрытие повтора раскладывает набор по дням', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз\n- [ ] Два', {
			repeat: 'каждый день',
		});

		await checkAll(wrapper);

		const content = vault.contentOf('Уборка.md') ?? '';

		expect(content).toContain(`  - ${TODAY}`);
		// Закрытый день забрал себе отмеченный набор...
		expect(content).toContain(`- ${TODAY}\n\t- [x] Раз\n\t- [x] Два`);
		// ...а под следующий повтор завелась чистая копия.
		expect(content).toContain('- 2026-08-14\n\t- [ ] Раз\n\t- [ ] Два');
	});

	it('метка блока - пункт с датой, а не заголовок', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз', { repeat: 'каждый день' });

		await checkAll(wrapper);

		expect(vault.contentOf('Уборка.md')).not.toContain('## ');
	});

	it('у разовой задачи блоки не заводятся', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз\n- [ ] Два');

		await checkAll(wrapper);

		const content = vault.contentOf('Уборка.md') ?? '';

		expect(content).toContain(`  - ${TODAY}`);
		// Второго раза у разовой не будет - раскладывать по дням нечего.
		// Второго раза у разовой не будет - блока с датой в теле не появилось.
		expect(bodyOf(content)).toBe('- [x] Раз\n- [x] Два');
	});

	it('снятая галочка снова открывает день', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз\n- [ ] Два');

		await checkAll(wrapper);
		expect(hasTaskOn(wrapper, TODAY)).toBe(false);

		await doneItems(wrapper)[0].findAll('input.task-list-item-checkbox')[1].trigger('click');
		await settle();

		expect(vault.contentOf('Уборка.md')).not.toContain(`  - ${TODAY}`);
		expect(hasTaskOn(wrapper, TODAY)).toBe(true);
		// Отметку о сделанном при этом не потеряли.
		expect(vault.contentOf('Уборка.md')).toContain('- [x] Раз');
	});

	it('журнал в свойствах за блоки итераций не принимается', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				// Строка «  - 2026-08-12» в свойствах выглядит ровно как метка блока.
				'Уборка.md': taskNoteText({
					date: '2026-08-12',
					done: ['2026-08-12'],
					repeat: 'каждый день',
					body: '- [ ] Раз',
				}),
			},
		});

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await settle();

		const content = vault.contentOf('Уборка.md') ?? '';

		// Блок должен появиться один - под сегодняшний день, а не вокруг журнала.
		expect(bodyBlockDates(bodyOf(content))).toEqual([TODAY, '2026-08-14']);
	});

	it('частичная отметка в теле остаётся - сбрасывает только закрытие', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз\n- [ ] Два');

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await settle();

		const content = vault.contentOf('Уборка.md') ?? '';

		expect(content).toContain('- [x] Раз');
		expect(content).not.toContain(`  - ${TODAY}`);
	});

	it('частичная галочка встаёт в разметке сразу', async () => {
		const { wrapper } = await withTask('- [ ] Раз\n- [ ] Два');

		const boxes = () => wrapper.findAll('input.task-list-item-checkbox');

		await boxes()[0].trigger('click');
		await flushPromises();

		// Галочку ставит текст заметки, а не браузер, поэтому разметка обновляется
		// сразу после записи - иначе до конца debounce клик выглядел бы пустым.
		expect((boxes()[0].element as HTMLInputElement).checked).toBe(true);
		expect((boxes()[1].element as HTMLInputElement).checked).toBe(false);
	});

	it('повторный клик снимает галочку', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз\n- [ ] Два');

		const box = () => wrapper.findAll('input.task-list-item-checkbox')[0];

		await box().trigger('click');
		await flushPromises();
		await box().trigger('click');
		await flushPromises();

		expect((box().element as HTMLInputElement).checked).toBe(false);
		expect(vault.contentOf('Уборка.md')).toContain('- [ ] Раз');
	});

	it('у повтора набор чекбоксов один - блоки с датами не заводятся', async () => {
		const { wrapper, vault } = await withTask('- [ ] Раз', { repeat: 'каждый день' });

		await checkAll(wrapper);

		const content = vault.contentOf('Уборка.md') ?? '';

		expect(content).not.toContain('## ');
		expect(content.split('- [ ] Раз')).toHaveLength(2);
	});

	it('отмена сбрасывает чекбоксы, даже если их успели наставить снова', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'Уборка.md': taskNoteText({
					date: TODAY,
					done: [TODAY],
					body: '- [x] Раз\n- [ ] Два',
				}),
			},
		});

		await doneItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await settle();

		const content = vault.contentOf('Уборка.md') ?? '';

		expect(content).not.toContain(`  - ${TODAY}`);
		expect(content).not.toContain('[x]');
	});
});

describe('старые блоки-заголовки «## дата»', () => {
	const legacy = taskNoteText({
		date: '2026-08-12',
		// Журнал согласован с телом: 12 августа закрыт, сегодняшний день открыт.
		done: ['2026-08-12'],
		repeat: 'каждый день',
		body: [
			'## 2026-08-12',
			'- [x] Раз',
			'- [x] Два',
			'',
			`## ${TODAY}`,
			'- [ ] Раз',
			'- [ ] Два',
		].join('\n'),
	});

	it('в карточке показывается блок своего дня', async () => {
		const { wrapper } = await mountCalendar({ files: { 'Уборка.md': legacy } });

		// Без разбора старой метки здесь было бы четыре чекбокса из двух блоков.
		expect(pendingItems(wrapper)[0].findAll('input.task-list-item-checkbox'))
			.toHaveLength(2);
	});

	it('галочка правит блок своего дня', async () => {
		const { wrapper, vault } = await mountCalendar({ files: { 'Уборка.md': legacy } });

		await pendingItems(wrapper)[0].find('input.task-list-item-checkbox').trigger('click');
		await settle();

		const content = vault.contentOf('Уборка.md') ?? '';

		expect(content).toContain('## 2026-08-12\n- [x] Раз\n- [x] Два');
		expect(content).toContain(`## ${TODAY}\n- [x] Раз\n- [ ] Два`);
	});

	it('новый блок пишется пунктом, а не заголовком', async () => {
		const { wrapper, vault } = await mountCalendar({ files: { 'Уборка.md': legacy } });

		await checkAll(wrapper);

		// Старые заголовки остаются как были - переписывать заметку незачем.
		expect(vault.contentOf('Уборка.md')).toContain(`## ${TODAY}`);
		expect(vault.contentOf('Уборка.md')).toContain('- 2026-08-14\n\t- [ ] Раз');
	});
});
