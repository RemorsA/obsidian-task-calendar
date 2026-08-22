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

/**
 * Порядок карточек в списке: просроченные, задачи дня, выполненные. Разделителей
 * между ними нет - порядок и вид карточки и есть вся разметка.
 */
const itemKinds = (wrapper: VueWrapper): string[] =>
	wrapper.findAll('.tasks__item').map((item) => {
		if (item.classes('--is-overdue')) return 'просроченная';

		return item.classes('--is-done') ? 'выполненная' : 'дня';
	});

/** Тексты карточек - по ним видно, что и в каком порядке показано. */
const itemTexts = (wrapper: VueWrapper): string[] =>
	wrapper.findAll('.tasks__item-body').map((body) => body.text().trim());

/** Дать сработать debounce событий хранилища. */
const settle = async () => {
	await vi.advanceTimersByTimeAsync(300);
	await flushPromises();
};

const clickDay = async (wrapper: VueWrapper, date: string) => {
	await cellFor(wrapper, date).trigger('click');
	await flushPromises();
};

/** Поменять дату у карточки штатным полем выбора. */
const pickDate = async (wrapper: VueWrapper, item: number, date: string) => {
	const card = wrapper.findAll('.tasks__item')[item];
	await card.find('.tasks__item-date-button').trigger('click');

	const input = card.find('.tasks__item-date-input');
	(input.element as HTMLInputElement).value = date;
	await input.trigger('change');
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
	});

	it('выбранный день по умолчанию сегодняшний', async () => {
		const { wrapper } = await mountCalendar();

		expect(cellFor(wrapper, TODAY).classes()).toContain('--is-focused');
	});

	it('клик по дню переносит выделение', async () => {
		const { wrapper } = await mountCalendar();

		await clickDay(wrapper, '2026-08-20');

		expect(cellFor(wrapper, '2026-08-20').classes()).toContain('--is-focused');
		expect(cellFor(wrapper, TODAY).classes()).not.toContain('--is-focused');
	});
});

describe('навигация по месяцам', () => {
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

	it('выполненная задача точку не даёт', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: '2026-08-20',
					done: '2026-08-20',
					body: ['- [x] Задача'],
				}),
			},
		});

		expect(hasDot(wrapper, '2026-08-20')).toBe(false);
	});

	it('точка считается от ↔️, а не от 📅', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: '2026-08-10',
					move: '2026-08-20',
					repeat: 'Каждый день',
				}),
			},
		});

		expect(hasDot(wrapper, '2026-08-10')).toBe(false);
		expect(hasDot(wrapper, '2026-08-20')).toBe(true);
	});

	it('блок без чекбоксов точки не даёт', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: '2026-08-20', body: ['- Просто пункт'] }) },
		});

		expect(hasDot(wrapper, '2026-08-20')).toBe(false);
	});
});

describe('список задач', () => {
	it('показывает задачи выбранного дня и только их тело', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: TODAY,
					repeat: 'Каждый день',
					body: ['- [ ] Купить молоко'],
				}),
			},
		});

		expect(itemTexts(wrapper)).toEqual(['Купить молоко']);
		expect(wrapper.text()).not.toContain('Каждый день');
	});

	it('в пустом дне карточек нет', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: '2026-08-20' }) },
		});

		expect(wrapper.findAll('.tasks__item')).toHaveLength(0);
	});

	it('порядок групп: просроченные, задачи дня, выполненные', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'долг.md': taskFileText({ date: '2026-08-10', body: ['- [ ] Долг'] }),
				'дело.md': taskFileText({ date: TODAY, body: ['- [ ] Дело'] }),
				'готово.md': taskFileText({
					date: TODAY,
					done: TODAY,
					body: ['- [x] Готово'],
				}),
			},
		});

		expect(itemKinds(wrapper)).toEqual(['просроченная', 'дня', 'выполненная']);
		expect(itemTexts(wrapper)).toEqual(['Долг', 'Дело', 'Готово']);
	});

	it('просроченные видны в списке любого выбранного дня', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'долг.md': taskFileText({ date: '2026-08-10', body: ['- [ ] Долг'] }) },
		});

		await clickDay(wrapper, '2026-08-25');

		expect(itemKinds(wrapper)).toEqual(['просроченная']);
	});

	it('на своём дне просроченная не задваивается', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'долг.md': taskFileText({ date: '2026-08-10', body: ['- [ ] Долг'] }) },
		});

		await clickDay(wrapper, '2026-08-10');

		expect(itemKinds(wrapper)).toEqual(['просроченная']);
	});

	it('просроченные идут от старого долга к свежему', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'свежий.md': taskFileText({ date: '2026-08-12', body: ['- [ ] Свежий'] }),
				'старый.md': taskFileText({ date: '2026-08-01', body: ['- [ ] Старый'] }),
			},
		});

		expect(itemTexts(wrapper)).toEqual(['Старый', 'Свежий']);
	});

	it('задачи дня идут по наименованию', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'я.md': taskFileText({ date: TODAY, body: ['- [ ] Яблоко'] }),
				'а.md': taskFileText({ date: TODAY, body: ['- [ ] 📞 Абрикос'] }),
			},
		});

		expect(itemTexts(wrapper)).toEqual(['📞 Абрикос', 'Яблоко']);
	});

	it('выполненная показывается целиком, с отмеченными чекбоксами', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: TODAY,
					done: TODAY,
					body: ['- [x] Раз', '- [x] Два'],
				}),
			},
		});

		const boxes = wrapper.findAll('.tasks__item.--is-done input.task-list-item-checkbox');

		expect(boxes).toHaveLength(2);
		expect(boxes.every((box) => (box.element as HTMLInputElement).checked)).toBe(true);
	});

	it('группа выполненных считается по ✅, а не по галочкам', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				// Все галочки сняты, но ✅ написали руками - задача выполненная.
				'note.md': taskFileText({ date: TODAY, done: TODAY, body: ['- [ ] Дело'] }),
			},
		});

		expect(itemKinds(wrapper)).toEqual(['выполненная']);
	});

	it('карточка задачи, перенесённой на другой день, стоит в новом дне', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: TODAY,
					move: '2026-08-20',
					repeat: 'Каждый день',
					body: ['- [ ] Дело'],
				}),
			},
		});

		expect(wrapper.findAll('.tasks__item')).toHaveLength(0);

		await clickDay(wrapper, '2026-08-20');

		expect(itemTexts(wrapper)).toEqual(['Дело']);
	});
});

describe('череда повтора в календаре', () => {
	const weekend = {
		files: {
			'note.md': taskFileText({
				date: '2026-08-22',
				repeat: 'Каждую неделю в Субботу, Воскресенье',
				body: ['- [ ] Дело'],
			}),
		},
	};

	it('точки стоят на всех днях череды после 📅', async () => {
		const { wrapper } = await mountCalendar(weekend);

		for (const day of ['2026-08-22', '2026-08-23', '2026-08-29', '2026-08-30', '2026-09-05']) {
			expect(hasDot(wrapper, day), day).toBe(true);
		}
	});

	it('до 📅 точек нет: задачи тогда ещё не было', async () => {
		const { wrapper } = await mountCalendar(weekend);

		for (const day of ['2026-08-15', '2026-08-16']) {
			expect(hasDot(wrapper, day), day).toBe(false);
		}
	});

	it('в будни череды нет', async () => {
		const { wrapper } = await mountCalendar(weekend);

		expect(hasDot(wrapper, '2026-08-25')).toBe(false);
	});

	it('у выполненной задачи череда не рисуется', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: '2026-08-22',
					repeat: 'Каждый день',
					done: '2026-08-22',
					body: ['- [x] Дело'],
				}),
			},
		});

		expect(hasDot(wrapper, '2026-08-23')).toBe(false);
	});

	it('у разовой задачи череды нет', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: '2026-08-22' }) },
		});

		expect(hasDot(wrapper, '2026-08-22')).toBe(true);
		expect(hasDot(wrapper, '2026-08-23')).toBe(false);
	});

	it('на расчётном дне череды показывается карточка', async () => {
		const { wrapper } = await mountCalendar(weekend);

		await clickDay(wrapper, '2026-08-29');

		expect(itemKinds(wrapper)).toEqual(['дня']);
		expect(itemTexts(wrapper)).toEqual(['Дело']);
	});

	it('отметка на расчётном дне выполняет только этот день', async () => {
		const { wrapper, vault } = await mountCalendar(weekend);

		await clickDay(wrapper, '2026-08-29');
		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		const content = vault.contentOf('note.md') ?? '';

		// У дня появился свой блок, текущий остался на своём месте.
		expect(content).toContain('- 📅 2026-08-29');
		expect(content).toContain('- 📅 2026-08-22');
		expect(content).toContain('- 🔁 Каждую неделю в Субботу, Воскресенье');
		expect(itemKinds(wrapper)).toEqual(['выполненная']);
	});

	it('выполненный наперёд день теряет точку, остальная череда на месте', async () => {
		const { wrapper } = await mountCalendar(weekend);

		await clickDay(wrapper, '2026-08-29');
		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(hasDot(wrapper, '2026-08-29')).toBe(false);
		expect(hasDot(wrapper, '2026-08-22')).toBe(true);
		expect(hasDot(wrapper, '2026-08-23')).toBe(true);
		expect(hasDot(wrapper, '2026-08-30')).toBe(true);
	});

	it('на дне со своим блоком расчётной карточки нет', async () => {
		const { wrapper } = await mountCalendar(weekend);

		await clickDay(wrapper, '2026-08-29');
		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		// Одна карточка: блок этого дня. Расчёт от текущего блока его перескочил.
		expect(wrapper.findAll('.tasks__item')).toHaveLength(1);
	});

	it('череда перескакивает выполненный наперёд день', async () => {
		const { wrapper, vault } = await mountCalendar(weekend);

		await clickDay(wrapper, '2026-08-29');
		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		// Закрываем текущий день, потом следующий: 29-е занято, череда идёт на 30-е.
		await clickDay(wrapper, '2026-08-22');
		await wrapper.find('.tasks__item:not(.--is-done) input.task-list-item-checkbox')
			.trigger('click');
		await flushPromises();

		await clickDay(wrapper, '2026-08-23');
		await wrapper.find('.tasks__item:not(.--is-done) input.task-list-item-checkbox')
			.trigger('click');
		await flushPromises();

		expect(vault.contentOf('note.md')).toContain('- 📅 2026-08-30');
		expect(hasDot(wrapper, '2026-08-30')).toBe(true);
	});

	it('просроченная задача расчётной карточкой не задваивается', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: '2026-08-10',
					repeat: 'Каждый день',
					body: ['- [ ] Долг'],
				}),
			},
		});

		await clickDay(wrapper, '2026-08-20');

		expect(itemKinds(wrapper)).toEqual(['просроченная']);
	});
});

describe('кнопки карточки', () => {
	it('кнопка перехода открывает заметку на правку', async () => {
		const { wrapper, app } = await mountCalendar({
			files: { 'Задачи/note.md': taskFileText({ date: TODAY }) },
			tasksFolderPath: '/Задачи',
		});

		await wrapper.find('.tasks__item-link-button').trigger('click');
		await flushPromises();

		expect(app.workspace.openLinkCalls).toEqual([{
			linktext: 'Задачи/note.md',
			sourcePath: '',
			newLeaf: false,
			openViewState: { state: { mode: 'source' } },
		}]);
	});

	it('в поле выбора даты стоит дата показа карточки', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({ date: '2026-08-01', move: TODAY, repeat: 'Каждый день' }),
			},
		});

		expect((wrapper.find('.tasks__item-date-input').element as HTMLInputElement).value)
			.toBe(TODAY);
	});

	it('у задачи с 🔁 выбор даты пишет ↔️', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY, repeat: 'Каждый день' }) },
		});

		await pickDate(wrapper, 0, '2026-08-20');

		expect(vault.contentOf('note.md')).toContain('- ↔️ 2026-08-20');
		expect(vault.contentOf('note.md')).toContain(`- 📅 ${TODAY}`);
	});

	it('у задачи без повтора выбор даты двигает саму 📅', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY }) },
		});

		await pickDate(wrapper, 0, '2026-08-20');

		expect(vault.contentOf('note.md')).toContain('- 📅 2026-08-20');
		expect(vault.contentOf('note.md')).not.toContain('↔️');
	});

	it('пустое значение поля ничего не пишет', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY }) },
		});

		const input = wrapper.find('.tasks__item-date-input');
		(input.element as HTMLInputElement).value = '';
		await input.trigger('change');
		await flushPromises();

		expect(vault.calls.process).toBe(0);
	});
});

describe('отметка подзадач', () => {
	it('клик по чекбоксу отмечает строку в файле', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY, body: ['- [ ] Раз', '- [ ] Два'] }) },
		});

		await wrapper.findAll('input.task-list-item-checkbox')[1].trigger('click');
		await flushPromises();

		expect(vault.contentOf('note.md')).toContain('- [ ] Раз');
		expect(vault.contentOf('note.md')).toContain('- [x] Два');
	});

	it('последняя галочка закрывает задачу и переносит карточку в конец списка', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY, body: ['- [ ] Дело'] }) },
		});

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(vault.contentOf('note.md')).toContain(`- ✅ ${TODAY}`);
		expect(itemKinds(wrapper)).toEqual(['выполненная']);
	});

	it('снятая галочка возвращает задачу в работу', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'note.md': taskFileText({ date: TODAY, done: TODAY, body: ['- [x] Дело'] }),
			},
		});

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(vault.contentOf('note.md')).not.toContain('✅');
		expect(itemKinds(wrapper)).toEqual(['дня']);
	});

	it('закрытие повтора показывает следующий день, а сегодняшний уходит в хвост', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: TODAY,
					repeat: 'Каждый день',
					body: ['- [ ] Дело'],
				}),
			},
		});

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		expect(itemKinds(wrapper)).toEqual(['выполненная']);
		expect(hasDot(wrapper, '2026-08-14')).toBe(true);

		await clickDay(wrapper, '2026-08-14');

		expect(itemKinds(wrapper)).toEqual(['дня']);
		expect(wrapper.find('.tasks__item input.task-list-item-checkbox').element)
			.toHaveProperty('checked', false);
	});

	it('после выполнения перенесённой задачи на дне переноса одна карточка', async () => {
		const { wrapper } = await mountCalendar({
			files: {
				'note.md': taskFileText({
					date: TODAY,
					move: '2026-08-16',
					repeat: 'Каждый день',
					body: ['- [ ] Дело'],
				}),
			},
		});

		await clickDay(wrapper, '2026-08-16');
		expect(itemKinds(wrapper)).toEqual(['дня']);

		await wrapper.find('input.task-list-item-checkbox').trigger('click');
		await flushPromises();

		// Новый повтор ушёл на 17-е, на 16-м осталась только выполненная карточка.
		expect(itemKinds(wrapper)).toEqual(['выполненная']);
		expect(hasDot(wrapper, '2026-08-16')).toBe(false);
		expect(hasDot(wrapper, '2026-08-17')).toBe(true);

		await clickDay(wrapper, '2026-08-17');

		expect(itemKinds(wrapper)).toEqual(['дня']);
	});
});

describe('создание задачи', () => {
	const type = async (wrapper: VueWrapper, text: string) => {
		await wrapper.find('.task__calendar-create-input').setValue(text);
	};

	it('кнопки выключены, пока поле пустое', async () => {
		const { wrapper } = await mountCalendar();
		const buttons = wrapper.findAll('.task__calendar-create-button');

		expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true);

		await type(wrapper, 'Дело');

		expect(buttons.every((button) => button.attributes('disabled') === undefined)).toBe(true);
	});

	it('плейсхолдер подставляет выбранную дату', async () => {
		const { wrapper } = await mountCalendar();

		await clickDay(wrapper, '2026-08-20');

		expect(wrapper.find('.task__calendar-create-input').attributes('placeholder'))
			.toBe('Новая задача на 2026-08-20');
	});

	it('Enter создаёт задачу и не открывает файл', async () => {
		const { wrapper, vault, app } = await mountCalendar({ tasksFolderPath: '/' });

		await type(wrapper, 'Купить молоко');
		await wrapper.find('.task__calendar-create').trigger('submit');
		await flushPromises();

		expect(vault.contentOf(`${TODAY} - Купить молоко.md`))
			.toBe(`\n- 📅 ${TODAY}\n\t- [ ] Купить молоко\n`);
		expect(app.workspace.openLinkCalls).toHaveLength(0);
		expect((wrapper.find('.task__calendar-create-input').element as HTMLInputElement).value)
			.toBe('');
	});

	it('левая кнопка создаёт задачу и открывает файл', async () => {
		const { wrapper, app } = await mountCalendar({ tasksFolderPath: '/' });

		await type(wrapper, 'Купить молоко');
		await wrapper.findAll('.task__calendar-create-button')[0].trigger('click');
		await flushPromises();

		expect(app.workspace.openLinkCalls).toEqual([{
			linktext: `${TODAY} - Купить молоко.md`,
			sourcePath: '',
			newLeaf: false,
			openViewState: { state: { mode: 'source' } },
		}]);
	});

	it('созданная задача сразу видна в списке дня', async () => {
		const { wrapper } = await mountCalendar({ tasksFolderPath: '/' });

		await clickDay(wrapper, '2026-08-20');
		await type(wrapper, 'Дело');
		await wrapper.find('.task__calendar-create').trigger('submit');
		await flushPromises();

		expect(itemTexts(wrapper)).toEqual(['Дело']);
		expect(hasDot(wrapper, '2026-08-20')).toBe(true);
	});
});

describe('реакция на изменения хранилища', () => {
	it('новая задача появляется без перезапуска', async () => {
		const { wrapper, vault } = await mountCalendar({ tasksFolderPath: '/' });

		await vault.create('новая.md', taskFileText({ date: TODAY, body: ['- [ ] Новая'] }));
		await settle();

		expect(itemTexts(wrapper)).toEqual(['Новая']);
	});

	it('правка заметки в редакторе видна в карточке', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY, body: ['- [ ] Было'] }) },
		});

		await vault.modify(
			new TFile('note.md'),
			taskFileText({ date: TODAY, body: ['- [ ] Стало'] })
		);
		await settle();

		expect(itemTexts(wrapper)).toEqual(['Стало']);
	});

	it('дописанная в заметке подзадача возвращает выполненную задачу в работу', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: {
				'note.md': taskFileText({ date: TODAY, done: TODAY, body: ['- [x] Дело'] }),
			},
		});

		expect(itemKinds(wrapper)).toEqual(['выполненная']);

		await vault.modify(
			new TFile('note.md'),
			taskFileText({ date: TODAY, done: TODAY, body: ['- [x] Дело', '- [ ] Ещё'] })
		);
		await settle();

		expect(itemKinds(wrapper)).toEqual(['дня']);
		expect(hasDot(wrapper, TODAY)).toBe(true);
	});

	it('удалённая задача уходит из списка', async () => {
		const { wrapper, vault } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY }) },
		});

		await vault.delete(new TFile('note.md'));
		await settle();

		expect(wrapper.findAll('.tasks__item')).toHaveLength(0);
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

	it('карту поднимает сам календарь, если плагин ещё не успел', async () => {
		const { wrapper } = await mountCalendar({
			files: { 'note.md': taskFileText({ date: TODAY, body: ['- [ ] Дело'] }) },
		});

		expect(wrapper.find('.task__calendar-tasks-loading').exists()).toBe(false);
		expect(itemTexts(wrapper)).toEqual(['Дело']);
	});
});
