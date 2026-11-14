import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import momentLib from 'moment';
import TaskCalendar from '../src/components/TaskCalendar.vue';
import { TFile } from './mocks/obsidian';
import {
	createPluginDouble,
	PluginDoubleOptions,
	taskFileText,
	TODAY,
	useFixedClock,
} from './helpers';

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

/** Отрисована ли точка на дне. */
const hasDot = (wrapper: VueWrapper, date: string): boolean =>
	cellFor(wrapper, date).find('.week-day--dot').exists();

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

describe('сетка календаря', () => {
	it('рисует 42 дня и названия недели', async () => {
		const { wrapper } = await mountCalendar();

		expect(wrapper.findAll('.week-day')).toHaveLength(42);
		expect(wrapper.findAll('.week-name').map((day) => day.text()))
			.toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
	});

	it('показывает текущий месяц и подсвечивает сегодня', async () => {
		const { wrapper } = await mountCalendar();

		expect(wrapper.find('.calendar__header-month-year-button').text()).toBe('Август 2026');
		expect(cellFor(wrapper, TODAY).classes()).toContain('--is-today');
		expect(cellFor(wrapper, GRID_START).classes()).toContain('--is-other-month');
	});

	it('день не выбирается: ячейка не кнопка, клик ничего не меняет', async () => {
		const { wrapper } = await mountCalendar();
		const cell = cellFor(wrapper, '2026-08-20');

		expect(cell.element.tagName).toBe('DIV');

		const before = wrapper.html();
		await cell.trigger('click');

		expect(wrapper.html()).toBe(before);
		expect(wrapper.emitted('select')).toBeUndefined();
		expect(wrapper.find('.--is-focused').exists()).toBe(false);
	});

	it('списка задач и поля создания под сеткой нет', async () => {
		const { wrapper } = await mountCalendar({ files: { 'a.md': taskFileText() } });

		expect(wrapper.find('.tasks__item').exists()).toBe(false);
		expect(wrapper.find('.task__calendar-create').exists()).toBe(false);
	});

	it('листает назад и вперёд', async () => {
		const { wrapper } = await mountCalendar();

		await wrapper.find('.calendar__header-prev-button').trigger('click');
		expect(wrapper.find('.calendar__header-month-year-button').text()).toBe('Июль 2026');

		await wrapper.find('.calendar__header-next-button').trigger('click');
		await wrapper.find('.calendar__header-next-button').trigger('click');
		expect(wrapper.find('.calendar__header-month-year-button').text()).toBe('Сентябрь 2026');
	});

	it('кнопка месяца возвращает к текущему', async () => {
		const { wrapper } = await mountCalendar();
		const label = wrapper.find('.calendar__header-month-year-button');

		await wrapper.find('.calendar__header-prev-button').trigger('click');
		expect(label.classes()).not.toContain('--is-current-month');

		await label.trigger('click');
		expect(label.text()).toBe('Август 2026');
		expect(label.classes()).toContain('--is-current-month');
	});
});

describe('выбор дня в списке', () => {
	/** Календарь, как его ставит список: с выбранным днём. */
	const mountSelectable = async (selectedDate = TODAY) => {
		const context = createPluginDouble();
		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin, selectedDate } });
		await flushPromises();

		return wrapper;
	};

	it('ячейка - кнопка, выбранный день помечен --is-focused', async () => {
		const wrapper = await mountSelectable('2026-08-20');
		const cell = cellFor(wrapper, '2026-08-20');

		expect(cell.element.tagName).toBe('BUTTON');
		expect(cell.attributes('type')).toBe('button');
		expect(cell.attributes('aria-pressed')).toBe('true');
		expect(cell.classes()).toContain('--is-focused');
		expect(wrapper.findAll('.--is-focused')).toHaveLength(1);
		expect(cellFor(wrapper, TODAY).classes()).toContain('--is-today');
	});

	it('клик по дню сообщает его списку, выбирает день сам список', async () => {
		const wrapper = await mountSelectable();

		await cellFor(wrapper, GRID_START).trigger('click');

		expect(wrapper.emitted('select')).toEqual([[GRID_START]]);

		await wrapper.setProps({ selectedDate: GRID_START });
		expect(cellFor(wrapper, GRID_START).classes()).toContain('--is-focused');
		expect(cellFor(wrapper, TODAY).classes()).not.toContain('--is-focused');
	});
});

describe('точки на днях', () => {
	it('точка на дне невыполненной задачи, и в прошлом, и в будущем', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'прошлое.md': taskFileText({ date: '2026-08-10' }),
				'будущее.md': taskFileText({ date: '2026-08-20' }),
			},
		});

		expect(hasDot(wrapper, '2026-08-10')).toBe(true);
		expect(hasDot(wrapper, '2026-08-20')).toBe(true);
		expect(hasDot(wrapper, '2026-08-11')).toBe(false);
	});

	it('выполненная задача и задача без даты точки не дают', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'выполнена.md': taskFileText({ date: '2026-08-20', checked: true, doneDate: '2026-08-20' }),
				'без даты.md': taskFileText({ date: null }),
			},
		});

		expect(wrapper.findAll('.week-day--dot')).toHaveLength(0);
	});

	it('«Дата переноса» на точку не влияет - точка на дне из «Дата и время»', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'a.md': taskFileText({ date: '2026-08-15', move: '2026-08-18' }) },
		});

		expect(hasDot(wrapper, '2026-08-15')).toBe(true);
		expect(hasDot(wrapper, '2026-08-18')).toBe(false);
	});

	it('повтор: точки на всех будущих днях после «Дата», до неё - нет', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'a.md': taskFileText({ date: '2026-08-15', repeat: 'Каждую неделю Суббота, Воскресенье' }) },
		});

		const days = ['2026-08-15', '2026-08-16', '2026-08-22', '2026-08-23', '2026-08-29', '2026-08-30', '2026-09-05', '2026-09-06'];

		for (const day of days) expect(hasDot(wrapper, day), day).toBe(true);
		expect(hasDot(wrapper, '2026-08-08')).toBe(false);
		expect(hasDot(wrapper, '2026-08-17')).toBe(false);
	});

	it('повтор досчитывается в следующем месяце', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'a.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый месяц' }) },
		});

		await wrapper.find('.calendar__header-next-button').trigger('click');

		// Сетка сентября начинается с 31 августа.
		expect(cellFor(wrapper, '2026-09-13', '2026-08-31').find('.week-day--dot').exists()).toBe(true);
		expect(cellFor(wrapper, '2026-09-12', '2026-08-31').find('.week-day--dot').exists()).toBe(false);
	});

	it('у выполненного повтора и нераспознанного повтора дни не размножаются', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'выполнен.md': taskFileText({ date: '2026-08-14', checked: true, doneDate: TODAY, repeat: 'Каждый день' }),
				'кривой.md': taskFileText({ date: '2026-08-20', repeat: 'Каждую ндлю' }),
			},
		});

		expect(hasDot(wrapper, '2026-08-15')).toBe(false);
		expect(hasDot(wrapper, '2026-08-20')).toBe(true);
		expect(hasDot(wrapper, '2026-08-27')).toBe(false);
	});
});

describe('связь с картой', () => {
	it('правка файла сразу видна на точках', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'a.md': taskFileText({ date: '2026-08-20' }) },
		});

		await vault.modify(new TFile('a.md'), taskFileText({ date: '2026-08-21' }));
		await settle();

		expect(hasDot(wrapper, '2026-08-20')).toBe(false);
		expect(hasDot(wrapper, '2026-08-21')).toBe(true);
	});

	it('карту поднимает сам календарь, если плагин ещё не успел', async () => {
		const { wrapper } = await mountCalendar({ files: { 'a.md': taskFileText({ date: '2026-08-20' }) } });

		expect(hasDot(wrapper, '2026-08-20')).toBe(true);
	});

	it('при размонтировании отписывается от карты', async () => {
		const context = createPluginDouble();
		const unsubscribe = vi.fn();
		vi.spyOn(context.taskMap, 'onChange').mockReturnValue(unsubscribe);

		const wrapper = mount(TaskCalendar, { props: { plugin: context.plugin } });
		await flushPromises();

		expect(unsubscribe).not.toHaveBeenCalled();

		wrapper.unmount();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
