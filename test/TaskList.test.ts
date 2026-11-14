import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import momentLib from 'moment';
import TaskList from '../src/components/TaskList.vue';
import { Notice, parseFrontmatter, Platform, TFile } from './mocks/obsidian';
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

/** Карточки подряд: тексты тел сверху вниз - групп в списке нет. */
const cardTexts = (wrapper: VueWrapper): string[] =>
	wrapper.findAll('.tasks__item-body').map((body) => body.text().trim());

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

	it('выполненные в списке не показываются', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'1.md': taskFileText({ text: 'Открытая' }),
				'2.md': taskFileText({ text: 'Сделано сегодня', checked: true, doneDate: TODAY }),
				'3.md': taskFileText({ text: 'Сделано давно', checked: true, doneDate: '2025-01-01' }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Открытая']);
	});

	it('пустой список и список из одних выполненных так и говорят', async () => {
		const empty = await mountOpenList();
		expect(empty.wrapper.find('.task__calendar-list-empty').text()).toBe('Задач нет');

		const done = await mountOpenList({ files: { '1.md': taskFileText({ checked: true, doneDate: TODAY }) } });
		expect(done.wrapper.find('.task__calendar-list-empty').text()).toBe('Задач нет');
	});

	it('просроченные первыми отдельным правилом: перенесённая на прошедший день - наверху', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'a.md': taskFileText({ text: 'Сегодня', date: `${TODAY}T08:00:00` }),
				'b.md': taskFileText({ text: 'Перенесли назад', date: '2026-08-20T08:00:00', move: '2026-08-10' }),
				'c.md': taskFileText({ text: 'Перенесли вперёд', date: '2026-08-01T08:00:00', move: '2026-08-15' }),
			},
		});

		expect(cardTexts(wrapper)).toEqual(['Перенесли назад', 'Перенесли вперёд', 'Сегодня']);
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

describe('карточка', () => {
	const PATH = 'Задачи/20260810_090000.md';

	it('заголовок - день показа, тело - задача и подзадачи', async () => {
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

		expect(card.find('.tasks__item-date').text()).toBe('август 20 2026');
		expect(card.find('.tasks__item-body').text()).toContain('Купить');
		expect(boxes.map((box) => (box.element as HTMLInputElement).checked)).toEqual([false, true, false]);
	});

	it('день в заголовке - месяц словом, число двумя цифрами, год: «июль 04 2027»', async () => {
		const { wrapper } = await mountOpenList({
			files: {
				'а.md': taskFileText({ text: 'Июль', date: '2027-07-04' }),
				'б.md': taskFileText({ text: 'Январь', date: '2027-01-09' }),
			},
		});

		expect(wrapper.findAll('.tasks__item-date').map((date) => date.text()).sort())
			.toEqual(['июль 04 2027', 'январь 09 2027']);
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

	it('галочка задачи закрывает её, и карточка уходит из списка', async () => {
		const { wrapper, vault } = await mountOpenList({ files: { [PATH]: taskFileText({ text: 'Дело' }) } });

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf(PATH) ?? '')).toMatchObject({
			Выполнено: true,
			'Дата выполнения': TODAY,
		});
		expect(cardTexts(wrapper)).toEqual([]);
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
		expect(wrapper.find('.tasks__item-date').text()).toBe('август 14 2026');
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

	it('создаёт файл с текущими датой и временем, остальное пустое, и сразу открывает его на правку', async () => {
		const { wrapper, vault, app } = await mountList({ tasksFolderPath: '/Задачи', folders: ['Задачи'] });

		await wrapper.find('.task__calendar-create-open').trigger('click');
		await flushPromises();

		const path = `Задачи/${NOW_NAME}.md`;
		expect(parseFrontmatter(vault.contentOf(path) ?? '')).toEqual({
			Задача: null,
			Выполнено: false,
			'Дата и время': '2026-08-13T12:00:00',
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
				'3.md': taskFileText({ text: 'Двадцатое', date: '2026-08-10', move: '2026-08-20' }),
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

	it('пустой день - без плашки, только календарь', async () => {
		const { wrapper } = await mountList();

		expect(wrapper.find('.task__calendar-container').exists()).toBe(true);
		expect(wrapper.find('.task__calendar-list-empty').exists()).toBe(false);
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
		expect(wrapper.find('.tasks__item-date').text()).toBe('август 13 2026');

		plugin.settings.calendarInList = false;
		await plugin.saveSettings();
		await flushPromises();

		expect(dayCell(wrapper, '2026-08-20').classes()).toContain('--is-focused');
		expect(cardTexts(wrapper)).toEqual(['Двадцатое']);
	});

	it('кнопка новой задачи та же: «Дата и время» - сейчас, выбранный день на него не влияет', async () => {
		const { wrapper, vault, app } = await mountList({ tasksFolderPath: '/' });

		await selectDay(wrapper, '2026-08-20');
		await wrapper.find('.task__calendar-create-open').trigger('click');
		await flushPromises();

		expect(parseFrontmatter(vault.contentOf(`${NOW_NAME}.md`) ?? '')?.['Дата и время']).toBe(`${TODAY}T12:00:00`);
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
		expect(wrapper.find('.tasks__item-date').text()).toBe('август 14 2026');
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
