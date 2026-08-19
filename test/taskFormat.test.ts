import { describe, expect, it } from 'vitest';
import {
	clearBodyChecks,
	collapseBodyBlocks,
	extractBody,
	extractLists,
	firstCheckboxText,
	firstPendingBefore,
	firstPendingUpTo,
	getDoneTasksForDate,
	getOverdueTasks,
	getTasksForDate,
	hasCheckboxes,
	hasPendingTasks,
	isBodyComplete,
	isClosed,
	nextOccurrenceAfter,
	normalizeDate,
	pendingDays,
	taskNameFromFile,
	occursOn,
	parseRepeat,
	readTaskNote,
	Repeat,
	TaskNote,
	toggleBodyCheckbox,
} from '../src/taskFormat';

const TODAY = '2026-08-13';

const note = (overrides: Partial<TaskNote> = {}): TaskNote => ({
	task: 'Задача',
	link: 'Задача.md',
	date: '2026-08-13',
	done: [],
	repeat: null,
	repeatRaw: null,
	stopped: false,
	...overrides,
});

describe('parseRepeat', () => {
	it('каждый день', () => {
		expect(parseRepeat('каждый день')).toEqual({ interval: 1, unit: 'day' });
		expect(parseRepeat('каждый 2 день')).toEqual({ interval: 2, unit: 'day' });
		expect(parseRepeat('каждые 3 дня')).toEqual({ interval: 3, unit: 'day' });
		expect(parseRepeat('каждые 10 дней')).toEqual({ interval: 10, unit: 'day' });
	});

	it('каждую неделю', () => {
		expect(parseRepeat('каждую неделю')).toEqual({ interval: 1, unit: 'week' });
		expect(parseRepeat('каждую 2 неделю')).toEqual({ interval: 2, unit: 'week' });
		expect(parseRepeat('каждые 3 неделю')).toEqual({ interval: 3, unit: 'week' });
		expect(parseRepeat('каждые 3 недели')).toEqual({ interval: 3, unit: 'week' });
		expect(parseRepeat('каждые 5 недель')).toEqual({ interval: 5, unit: 'week' });
	});

	it('каждый месяц', () => {
		expect(parseRepeat('каждый месяц')).toEqual({ interval: 1, unit: 'month' });
		expect(parseRepeat('каждый 2 месяц')).toEqual({ interval: 2, unit: 'month' });
		expect(parseRepeat('каждый 3 месяц')).toEqual({ interval: 3, unit: 'month' });
		expect(parseRepeat('каждые 6 месяцев')).toEqual({ interval: 6, unit: 'month' });
	});

	it('каждый год', () => {
		expect(parseRepeat('каждый год')).toEqual({ interval: 1, unit: 'year' });
		expect(parseRepeat('каждый 2 год')).toEqual({ interval: 2, unit: 'year' });
		expect(parseRepeat('каждые 2 года')).toEqual({ interval: 2, unit: 'year' });
		expect(parseRepeat('каждые 5 лет')).toEqual({ interval: 5, unit: 'year' });
	});

	it('число с наращением', () => {
		expect(parseRepeat('каждый 2-й день')).toEqual({ interval: 2, unit: 'day' });
		expect(parseRepeat('каждую 3-ю неделю')).toEqual({ interval: 3, unit: 'week' });
	});

	it('наречия без числа', () => {
		expect(parseRepeat('ежедневно')).toEqual({ interval: 1, unit: 'day' });
		expect(parseRepeat('еженедельно')).toEqual({ interval: 1, unit: 'week' });
		expect(parseRepeat('ежемесячно')).toEqual({ interval: 1, unit: 'month' });
		expect(parseRepeat('ежегодно')).toEqual({ interval: 1, unit: 'year' });
	});

	it('не зависит от регистра и лишних пробелов', () => {
		expect(parseRepeat('  КАЖДЫЕ   2   ДНЯ  ')).toEqual({ interval: 2, unit: 'day' });
		expect(parseRepeat('Каждый День')).toEqual({ interval: 1, unit: 'day' });
	});

	it('единица 1 - обычный повтор', () => {
		expect(parseRepeat('каждый 1 день')).toEqual({ interval: 1, unit: 'day' });
	});

	it('незнакомая форма - задача разовая', () => {
		expect(parseRepeat(null)).toBeNull();
		expect(parseRepeat('')).toBeNull();
		expect(parseRepeat('   ')).toBeNull();
		expect(parseRepeat('Иногда')).toBeNull();
		expect(parseRepeat('каждые 0 дней')).toBeNull();
		expect(parseRepeat(42)).toBeNull();
	});

	it('неделя с днём недели', () => {
		expect(parseRepeat('каждые 2 недели в субботу')).toEqual({ interval: 2, unit: 'week', weekdays: [6] });
		expect(parseRepeat('каждую неделю в понедельник')).toEqual({ interval: 1, unit: 'week', weekdays: [1] });
		expect(parseRepeat('каждую 3 неделю в пятницу')).toEqual({ interval: 3, unit: 'week', weekdays: [5] });
		expect(parseRepeat('каждую неделю во вторник')).toEqual({ interval: 1, unit: 'week', weekdays: [2] });
		expect(parseRepeat('каждую неделю в воскресенье')).toEqual({ interval: 1, unit: 'week', weekdays: [0] });
	});

	it('короткая форма без слова «неделя»', () => {
		expect(parseRepeat('каждую субботу')).toEqual({ interval: 1, unit: 'week', weekdays: [6] });
		expect(parseRepeat('каждый понедельник')).toEqual({ interval: 1, unit: 'week', weekdays: [1] });
		expect(parseRepeat('каждые 2 субботы')).toEqual({ interval: 2, unit: 'week', weekdays: [6] });
		expect(parseRepeat('каждую среду')).toEqual({ interval: 1, unit: 'week', weekdays: [3] });
	});

	it('несколько дней недели в одном повторе', () => {
		expect(parseRepeat('каждую неделю в субботу, понедельник'))
			.toEqual({ interval: 1, unit: 'week', weekdays: [1, 6] });
		expect(parseRepeat('каждые 2 недели в субботу, в понедельник'))
			.toEqual({ interval: 2, unit: 'week', weekdays: [1, 6] });
		expect(parseRepeat('каждую неделю в субботу и понедельник'))
			.toEqual({ interval: 1, unit: 'week', weekdays: [1, 6] });
		expect(parseRepeat('каждую неделю в понедельник, среду, пятницу'))
			.toEqual({ interval: 1, unit: 'week', weekdays: [1, 3, 5] });
		expect(parseRepeat('каждую субботу, понедельник'))
			.toEqual({ interval: 1, unit: 'week', weekdays: [1, 6] });
	});

	it('повторы в перечислении не задваиваются', () => {
		expect(parseRepeat('каждую неделю в субботу, субботу'))
			.toEqual({ interval: 1, unit: 'week', weekdays: [6] });
	});

	it('день недели уточняет только неделю', () => {
		expect(parseRepeat('каждый месяц в субботу')).toBeNull();
		expect(parseRepeat('каждый день в субботу')).toBeNull();
		expect(parseRepeat('каждый год в понедельник')).toBeNull();
		expect(parseRepeat('каждую неделю в бублик')).toBeNull();
		expect(parseRepeat('каждую неделю в субботу, бублик')).toBeNull();
		expect(parseRepeat('по будням')).toBeNull();
	});

	it('каждый год в месяцах', () => {
		expect(parseRepeat('каждый год в марте'))
			.toEqual({ interval: 1, unit: 'year', months: [2] });
		expect(parseRepeat('Каждый год в Марте, Сентябре'))
			.toEqual({ interval: 1, unit: 'year', months: [2, 8] });
		expect(parseRepeat('каждый год в марте и сентябре'))
			.toEqual({ interval: 1, unit: 'year', months: [2, 8] });
		expect(parseRepeat('каждые 2 года в марте, в сентябре'))
			.toEqual({ interval: 2, unit: 'year', months: [2, 8] });
		// Порядок в свойстве любой - месяцы отдаются по возрастанию.
		expect(parseRepeat('каждый год в сентябре, марте'))
			.toEqual({ interval: 1, unit: 'year', months: [2, 8] });
		expect(parseRepeat('каждый год в январе, феврале, декабре'))
			.toEqual({ interval: 1, unit: 'year', months: [0, 1, 11] });
	});

	it('месяцы принимаются в любом падеже', () => {
		expect(parseRepeat('каждый год в мае')).toEqual({ interval: 1, unit: 'year', months: [4] });
		expect(parseRepeat('каждый год в мая')).toEqual({ interval: 1, unit: 'year', months: [4] });
		expect(parseRepeat('каждый год в май')).toEqual({ interval: 1, unit: 'year', months: [4] });
	});

	it('короткая форма без слова «год»', () => {
		expect(parseRepeat('каждый март')).toEqual({ interval: 1, unit: 'year', months: [2] });
		expect(parseRepeat('каждый март, сентябрь'))
			.toEqual({ interval: 1, unit: 'year', months: [2, 8] });
		// Число - всегда шаг повтора: «каждые 2 марта» это не второе марта.
		expect(parseRepeat('каждые 2 марта')).toEqual({ interval: 2, unit: 'year', months: [2] });
	});

	it('повторы месяцев в перечислении не задваиваются', () => {
		expect(parseRepeat('каждый год в марте, марте'))
			.toEqual({ interval: 1, unit: 'year', months: [2] });
	});

	it('месяц уточняет только год', () => {
		expect(parseRepeat('каждый месяц в марте')).toBeNull();
		expect(parseRepeat('каждую неделю в марте')).toBeNull();
		expect(parseRepeat('каждый день в марте')).toBeNull();
		expect(parseRepeat('каждый год в бублике')).toBeNull();
		expect(parseRepeat('каждый год в марте, бублике')).toBeNull();
		// Месяцы и дни недели в одной оговорке не смешиваются.
		expect(parseRepeat('каждый год в марте, субботу')).toBeNull();
	});

	it('в свойстве только одна повторка - составная запись не принимается', () => {
		expect(parseRepeat('каждый день, каждый 2 день')).toBeNull();
		expect(parseRepeat('каждый день и каждую неделю')).toBeNull();
	});

	it('хвост после единицы не угадывается', () => {
		expect(parseRepeat('каждый день, кроме выходных')).toBeNull();
		expect(parseRepeat('каждый день в 10:00')).toBeNull();
	});
});

describe('normalizeDate', () => {
	it('принимает строку и объект Date', () => {
		expect(normalizeDate('2026-08-13')).toBe('2026-08-13');
		expect(normalizeDate('2026-08-13T10:00:00')).toBe('2026-08-13');
		expect(normalizeDate(new Date(2026, 7, 13))).toBe('2026-08-13');
	});

	it('пустое и негодное - null', () => {
		expect(normalizeDate(null)).toBeNull();
		expect(normalizeDate('')).toBeNull();
		expect(normalizeDate('   ')).toBeNull();
		expect(normalizeDate('когда-нибудь')).toBeNull();
		expect(normalizeDate('2026-13-45')).toBeNull();
	});
});

describe('readTaskNote', () => {
	it('собирает задачу из свойств, наименование - из имени файла', () => {
		expect(readTaskNote('Дела/2026-08-12 - Купить молоко.md', '2026-08-12 - Купить молоко', {
			'Дата': '2026-08-12',
			'Выполнено': ['2026-08-12', '2026-08-10'],
			'Повтор': 'Каждый день',
		})).toEqual({
			task: 'Купить молоко',
			link: 'Дела/2026-08-12 - Купить молоко.md',
			date: '2026-08-12',
			done: ['2026-08-12', '2026-08-10'],
			repeat: { interval: 1, unit: 'day' },
			repeatRaw: 'Каждый день',
			stopped: false,
		});
	});

	it('дата в имени файла в наименование не идёт', () => {
		const parsed = readTaskNote('Отбросить сомнения.md', 'Отбросить сомнения', {
			'Дата': '2026-08-14',
			'Выполнено': null,
			'Повтор': null,
		});

		expect(parsed?.task).toBe('Отбросить сомнения');
		expect(parsed?.done).toEqual([]);
		expect(parsed?.repeat).toBeNull();
	});

	it('одиночное «Выполнено» превращается в список', () => {
		const parsed = readTaskNote('Задача.md', 'Задача', {
			'Дата': '2026-08-14',
			'Выполнено': '2026-08-14',
			'Повтор': null,
		});

		expect(parsed?.done).toEqual(['2026-08-14']);
	});

	it('пустая «Дата» оставляет задачу без дня', () => {
		const parsed = readTaskNote('Задача.md', 'Задача', {
			'Дата': null,
			'Выполнено': null,
			'Повтор': null,
		});

		expect(parsed?.date).toBeNull();
	});

	it('задачей считается только заметка со всеми тремя свойствами', () => {
		const full = {
			'Дата': '2026-08-14',
			'Выполнено': null,
			'Повтор': null,
		};

		expect(readTaskNote('Заметка.md', 'Заметка', full)).not.toBeNull();

		// Убираем по одному - и заметка перестаёт быть задачей.
		for (const field of ['Дата', 'Выполнено', 'Повтор']) {
			const partial: Record<string, unknown> = { ...full };
			delete partial[field];

			expect(readTaskNote('Заметка.md', 'Заметка', partial), `без «${field}»`).toBeNull();
		}
	});

	it('наименование берётся из имени файла без даты', () => {
		const parsed = readTaskNote(
			'Дела/2026-08-14 - Купить молоко.md',
			'2026-08-14 - Купить молоко',
			{ 'Дата': '2026-08-14', 'Выполнено': null, 'Повтор': null }
		);

		expect(parsed?.task).toBe('Купить молоко');
	});

	it('«Стоп повтор» читается галочкой', () => {
		const read = (stop: unknown) => readTaskNote('Задача.md', 'Задача', {
			'Дата': '2026-08-14',
			'Выполнено': null,
			'Повтор': null,
			'Стоп повтор': stop,
		})?.stopped;

		expect(read(true)).toBe(true);
		expect(read('true')).toBe(true);
		expect(read(false)).toBe(false);
		expect(read(null)).toBe(false);
		// Свойства нет вовсе - паузы нет.
		expect(readTaskNote('Задача.md', 'Задача', {
			'Дата': '2026-08-14', 'Выполнено': null, 'Повтор': null,
		})?.stopped).toBe(false);
	});

	it('заметка без свойств и с чужими свойствами задачей не считается', () => {
		expect(readTaskNote('Заметка.md', 'Заметка', null)).toBeNull();
		expect(readTaskNote('Заметка.md', 'Заметка', {})).toBeNull();
		expect(readTaskNote('Заметка.md', 'Заметка', { 'Тег': 'заметка' })).toBeNull();
	});
});

describe('occursOn', () => {
	it('без повтора задача выпадает только на свою дату', () => {
		const single = note({ date: '2026-08-13' });

		expect(occursOn(single, '2026-08-13')).toBe(true);
		expect(occursOn(single, '2026-08-14')).toBe(false);
		expect(occursOn(single, '2026-08-12')).toBe(false);
	});

	it('повтор не работает раньше даты начала', () => {
		const daily = note({ date: '2026-08-13', repeat: { interval: 1, unit: 'day' } });

		expect(occursOn(daily, '2026-08-12')).toBe(false);
	});

	it('каждый день', () => {
		const daily = note({ date: '2026-08-13', repeat: { interval: 1, unit: 'day' } });

		expect(occursOn(daily, '2026-08-13')).toBe(true);
		expect(occursOn(daily, '2026-08-14')).toBe(true);
		expect(occursOn(daily, '2026-09-20')).toBe(true);
	});

	it('каждые 2 дня', () => {
		const every2 = note({ date: '2026-08-13', repeat: { interval: 2, unit: 'day' } });

		expect(occursOn(every2, '2026-08-13')).toBe(true);
		expect(occursOn(every2, '2026-08-14')).toBe(false);
		expect(occursOn(every2, '2026-08-15')).toBe(true);
		expect(occursOn(every2, '2026-08-21')).toBe(true);
	});

	it('каждую неделю - тот же день недели', () => {
		const weekly = note({ date: '2026-08-13', repeat: { interval: 1, unit: 'week' } });

		expect(occursOn(weekly, '2026-08-20')).toBe(true);
		expect(occursOn(weekly, '2026-08-19')).toBe(false);
	});

	it('каждый месяц - то же число', () => {
		const monthly = note({ date: '2026-08-13', repeat: { interval: 1, unit: 'month' } });

		expect(occursOn(monthly, '2026-09-13')).toBe(true);
		expect(occursOn(monthly, '2026-09-12')).toBe(false);
		expect(occursOn(monthly, '2027-02-13')).toBe(true);
	});

	it('31 число не расползается на короткие месяцы', () => {
		const monthly = note({ date: '2026-01-31', repeat: { interval: 1, unit: 'month' } });

		expect(occursOn(monthly, '2026-02-28')).toBe(false);
		expect(occursOn(monthly, '2026-03-31')).toBe(true);
	});

	it('каждые 2 недели в субботу - только субботы через неделю', () => {
		// Дата - четверг 13 августа, её неделя начинается 10-го.
		const biweekly = note({
			date: '2026-08-13',
			repeat: { interval: 2, unit: 'week', weekdays: [6] },
		});

		expect(occursOn(biweekly, '2026-08-13')).toBe(false); // сама «Дата» - не суббота
		expect(occursOn(biweekly, '2026-08-15')).toBe(true);  // суббота своей недели
		expect(occursOn(biweekly, '2026-08-22')).toBe(false); // следующая неделя пропускается
		expect(occursOn(biweekly, '2026-08-29')).toBe(true);
		expect(occursOn(biweekly, '2026-09-12')).toBe(true);
	});

	it('день недели раньше «Даты» в её же неделе не считается', () => {
		// Понедельник 10 августа лежит в неделе «Даты», но раньше неё самой.
		const weekly = note({
			date: '2026-08-13',
			repeat: { interval: 1, unit: 'week', weekdays: [1] },
		});

		expect(occursOn(weekly, '2026-08-10')).toBe(false);
		expect(occursOn(weekly, '2026-08-17')).toBe(true);
		expect(occursOn(weekly, '2026-08-24')).toBe(true);
	});

	it('каждый год в марте, сентябре - то же число этих месяцев', () => {
		// «Дата» - 13 августа: число повтора берётся из неё.
		const twice = note({
			date: '2026-08-13',
			repeat: { interval: 1, unit: 'year', months: [2, 8] },
		});

		expect(occursOn(twice, '2026-08-13')).toBe(false); // август в оговорке не назван
		expect(occursOn(twice, '2026-09-13')).toBe(true);
		expect(occursOn(twice, '2026-09-12')).toBe(false); // число не то
		expect(occursOn(twice, '2027-03-13')).toBe(true);
		expect(occursOn(twice, '2027-09-13')).toBe(true);
		expect(occursOn(twice, '2028-03-13')).toBe(true);
	});

	it('месяц раньше «Даты» в её же году не считается', () => {
		const march = note({
			date: '2026-08-13',
			repeat: { interval: 1, unit: 'year', months: [2] },
		});

		expect(occursOn(march, '2026-03-13')).toBe(false);
		expect(occursOn(march, '2027-03-13')).toBe(true);
	});

	it('каждые 2 года в марте - год через год', () => {
		const biennial = note({
			date: '2026-03-13',
			repeat: { interval: 2, unit: 'year', months: [2] },
		});

		expect(occursOn(biennial, '2026-03-13')).toBe(true);
		expect(occursOn(biennial, '2027-03-13')).toBe(false);
		expect(occursOn(biennial, '2028-03-13')).toBe(true);
	});

	it('31 число не расползается на короткие месяцы и в годовом повторе', () => {
		const yearly = note({
			date: '2026-01-31',
			repeat: { interval: 1, unit: 'year', months: [1, 2] },
		});

		expect(occursOn(yearly, '2027-02-28')).toBe(false);
		expect(occursOn(yearly, '2027-03-31')).toBe(true);
	});

	it('каждую субботу - все субботы начиная со своей недели', () => {
		const saturdays = note({
			date: '2026-08-13',
			repeat: { interval: 1, unit: 'week', weekdays: [6] },
		});

		expect(occursOn(saturdays, '2026-08-15')).toBe(true);
		expect(occursOn(saturdays, '2026-08-22')).toBe(true);
		expect(occursOn(saturdays, '2026-08-29')).toBe(true);
		expect(occursOn(saturdays, '2026-08-21')).toBe(false);
	});

	it('воскресенье относится к своей неделе, а не к следующей', () => {
		// Воскресенье 16 августа - конец недели, начавшейся 10-го.
		const biweekly = note({
			date: '2026-08-13',
			repeat: { interval: 2, unit: 'week', weekdays: [0] },
		});

		expect(occursOn(biweekly, '2026-08-16')).toBe(true);
		expect(occursOn(biweekly, '2026-08-23')).toBe(false);
		expect(occursOn(biweekly, '2026-08-30')).toBe(true);
	});

	it('несколько дней недели - все они дни задачи', () => {
		// Пн 17, ср 19, пт 21 августа; неделя «Даты» начинается 10-го.
		const weekly = note({
			date: '2026-08-13',
			repeat: { interval: 1, unit: 'week', weekdays: [1, 3, 5] },
		});

		expect(occursOn(weekly, '2026-08-14')).toBe(true);  // пятница своей недели
		expect(occursOn(weekly, '2026-08-17')).toBe(true);
		expect(occursOn(weekly, '2026-08-19')).toBe(true);
		expect(occursOn(weekly, '2026-08-18')).toBe(false);
		expect(occursOn(weekly, '2026-08-12')).toBe(false); // среда раньше «Даты»
	});

	it('несколько дней недели с интервалом - только в своих неделях', () => {
		const biweekly = note({
			date: '2026-08-13',
			repeat: { interval: 2, unit: 'week', weekdays: [1, 6] },
		});

		expect(occursOn(biweekly, '2026-08-15')).toBe(true);  // суббота своей недели
		expect(occursOn(biweekly, '2026-08-17')).toBe(false); // следующая неделя пропускается
		expect(occursOn(biweekly, '2026-08-24')).toBe(true);  // понедельник через неделю
		expect(occursOn(biweekly, '2026-08-29')).toBe(true);
	});

	it('задача без даты никуда не попадает', () => {
		expect(occursOn(note({ date: null }), '2026-08-13')).toBe(false);
	});
});

describe('isClosed', () => {
	it('разовую задачу закрывает любая запись в «Выполнено»', () => {
		expect(isClosed(note({ done: [] }))).toBe(false);
		expect(isClosed(note({ done: ['2026-08-13'] }))).toBe(true);
	});

	it('повторяющаяся задача не закрывается никогда', () => {
		const daily = note({ repeat: { interval: 1, unit: 'day' }, done: ['2026-08-13'] });

		expect(isClosed(daily)).toBe(false);
	});
});

describe('hasPendingTasks', () => {
	const notes = [
		note({ task: 'Просроченная', link: 'a.md', date: '2026-08-10' }),
		note({ task: 'Будущая', link: 'b.md', date: '2026-08-20' }),
	];

	it('день с невыполненной задачей - и в прошлом, и в будущем', () => {
		expect(hasPendingTasks(notes, '2026-08-10')).toBe(true);
		expect(hasPendingTasks(notes, '2026-08-20')).toBe(true);
	});

	it('день без задач', () => {
		expect(hasPendingTasks(notes, '2026-08-19')).toBe(false);
	});

	it('закрытая разовая задача свой день не отмечает', () => {
		const closed = [note({ date: '2026-08-11', done: ['2026-08-11'] })];

		expect(hasPendingTasks(closed, '2026-08-11')).toBe(false);
	});

	it('выполненные дни повтора в календаре не показываются', () => {
		const daily = [note({
			date: '2026-08-11',
			done: ['2026-08-11', '2026-08-12'],
			repeat: { interval: 1, unit: 'day' },
		})];

		expect(hasPendingTasks(daily, '2026-08-11')).toBe(false);
		expect(hasPendingTasks(daily, '2026-08-12')).toBe(false);
		expect(hasPendingTasks(daily, TODAY)).toBe(true);
		expect(hasPendingTasks(daily, '2026-08-14')).toBe(true);
	});

	it('«Стоп повтор» убирает задачу со всех дней', () => {
		const paused = note({
			date: '2026-08-10',
			repeat: { interval: 1, unit: 'day' },
			stopped: true,
		});

		expect(hasPendingTasks([paused], '2026-08-10')).toBe(false);
		expect(hasPendingTasks([paused], TODAY)).toBe(false);
		expect(hasPendingTasks([paused], '2026-08-20')).toBe(false);

		// Сняли галочку - всё вернулось, журнал ничего не потерял.
		expect(hasPendingTasks([{ ...paused, stopped: false }], TODAY)).toBe(true);
	});

	it('остановленная задача остаётся видна в журнале закрытий', () => {
		const paused = [note({
			task: 'Пауза',
			date: '2026-08-10',
			done: [TODAY],
			repeat: { interval: 1, unit: 'day' },
			stopped: true,
		})];

		expect(getDoneTasksForDate(paused, TODAY).map((n) => n.task)).toEqual(['Пауза']);
	});

	it('пропущенные дни повтора остаются просроченными', () => {
		// «Дата» неподвижна, поэтому невыполненный день так и висит в прошлом:
		// череда считается от неё, а не от последнего закрытия.
		const daily = [note({
			date: '2026-08-10',
			done: [TODAY],
			repeat: { interval: 1, unit: 'day' },
		})];

		expect(hasPendingTasks(daily, '2026-08-10')).toBe(true);
		expect(hasPendingTasks(daily, '2026-08-11')).toBe(true);
		expect(hasPendingTasks(daily, '2026-08-12')).toBe(true);
		expect(hasPendingTasks(daily, TODAY)).toBe(false);
		expect(hasPendingTasks(daily, '2026-08-14')).toBe(true);
	});

	it('до «Даты» задачи не существует', () => {
		const daily = [note({ date: TODAY, repeat: { interval: 1, unit: 'day' } })];

		expect(hasPendingTasks(daily, '2026-08-12')).toBe(false);
		expect(hasPendingTasks(daily, TODAY)).toBe(true);
	});

	it('чужая невыполненная задача отмечает день, даже если кто-то в нём закрылся', () => {
		const mixed = [
			note({ task: 'История', link: 'a.md', date: TODAY, done: ['2026-08-10'], repeat: { interval: 1, unit: 'day' } }),
			note({ task: 'Забытая', link: 'b.md', date: '2026-08-10' }),
		];

		expect(hasPendingTasks(mixed, '2026-08-10')).toBe(true);
	});

	it('выполненный наперёд день повтора освобождается', () => {
		const daily = [note({
			date: '2026-08-15',
			done: ['2026-08-15'],
			repeat: { interval: 1, unit: 'day' },
		})];

		expect(hasPendingTasks(daily, '2026-08-15')).toBe(false);
		expect(hasPendingTasks(daily, '2026-08-16')).toBe(true);
	});

	it('перенос даты в будущее освобождает прошедший день', () => {
		const moved = [note({ task: 'Перенесённая', link: 'a.md', date: '2026-08-20' })];

		expect(hasPendingTasks(moved, '2026-08-10')).toBe(false);
		expect(hasPendingTasks(moved, '2026-08-20')).toBe(true);
	});
});

describe('taskNameFromFile', () => {
	it('срезает дату и тире', () => {
		expect(taskNameFromFile('2026-08-14 - Купить молоко')).toBe('Купить молоко');
		expect(taskNameFromFile('2026-08-14 Купить молоко')).toBe('Купить молоко');
		expect(taskNameFromFile('2026-08-14 – Купить молоко')).toBe('Купить молоко');
	});

	it('без даты имя остаётся целым', () => {
		expect(taskNameFromFile('Купить молоко')).toBe('Купить молоко');
		expect(taskNameFromFile('2026 - Итоги года')).toBe('2026 - Итоги года');
	});

	it('от имени из одной даты остаётся сама дата', () => {
		// Иначе задача была бы безымянной.
		expect(taskNameFromFile('2026-08-14')).toBe('2026-08-14');
	});
});

describe('pendingDays', () => {
	const grid = ['2026-08-12', TODAY, '2026-08-14', '2026-08-15'];

	it('отмечает те же дни, что и hasPendingTasks', () => {
		const notes = [
			note({ task: 'Разовая', link: 'a.md', date: '2026-08-14' }),
			note({
				task: 'Каждый день',
				link: 'b.md',
				date: '2026-08-12',
				done: [TODAY],
				repeat: { interval: 1, unit: 'day' },
			}),
		];

		const map = pendingDays(notes, grid);

		expect(map).toEqual({ '2026-08-12': true, '2026-08-14': true, '2026-08-15': true });
		for (const date of grid) {
			expect(Boolean(map[date]), date).toBe(hasPendingTasks(notes, date));
		}
	});

	it('остановленная задача дней не отмечает', () => {
		const stopped = [note({ date: '2026-08-12', repeat: { interval: 1, unit: 'day' }, stopped: true })];

		expect(pendingDays(stopped, grid)).toEqual({});
	});

	it('пустой список задач - пустая карта', () => {
		expect(pendingDays([], grid)).toEqual({});
	});
});

describe('getTasksForDate', () => {
	const overdue = note({ task: 'Яблоки', link: 'a.md', date: '2026-08-10' });
	const today = note({ task: 'Бумага', link: 'b.md', date: TODAY });
	const future = note({ task: 'Виноград', link: 'c.md', date: '2026-08-20' });
	const notes = [overdue, today, future];

	it('отдаёт задачи своего дня', () => {
		expect(getTasksForDate(notes, '2026-08-20').map((n) => n.task)).toEqual(['Виноград']);
		expect(getTasksForDate(notes, TODAY).map((n) => n.task)).toEqual(['Бумага']);
	});

	it('просрочка остаётся в своём дне и в сегодня не приходит', () => {
		expect(getTasksForDate(notes, '2026-08-10').map((n) => n.task)).toEqual(['Яблоки']);
		expect(getTasksForDate(notes, TODAY).map((n) => n.task)).not.toContain('Яблоки');
	});

	it('сортирует по наименованию', () => {
		const sameDay = [
			note({ task: 'Яблоки', link: 'a.md', date: TODAY }),
			note({ task: 'Бумага', link: 'b.md', date: TODAY }),
		];

		expect(getTasksForDate(sameDay, TODAY).map((n) => n.task)).toEqual(['Бумага', 'Яблоки']);
	});

	it('день без задач - пустой список', () => {
		expect(getTasksForDate(notes, '2026-08-19')).toEqual([]);
	});

	it('закрытая разовая задача не приходит никуда', () => {
		const closed = [note({ task: 'Закрытая', date: '2026-08-11', done: ['2026-08-11'] })];

		expect(getTasksForDate(closed, '2026-08-11')).toEqual([]);
	});

	it('повторяющаяся задача приходит только в невыполненные дни', () => {
		const daily = [note({
			task: 'Молоко',
			date: TODAY,
			done: ['2026-08-11'],
			repeat: { interval: 1, unit: 'day' },
		})];

		expect(getTasksForDate(daily, TODAY).map((n) => n.task)).toEqual(['Молоко']);
		expect(getTasksForDate(daily, '2026-08-20').map((n) => n.task)).toEqual(['Молоко']);
		// День выполнения и дни до «Даты» - чистые.
		expect(getTasksForDate(daily, '2026-08-11')).toEqual([]);
		expect(getTasksForDate(daily, '2026-08-10')).toEqual([]);
	});
});

describe('getDoneTasksForDate', () => {
	it('отдаёт задачи, закрытые в этот день', () => {
		const notes = [
			note({ task: 'Яблоки', link: 'a.md', date: TODAY, done: [TODAY] }),
			note({ task: 'Бумага', link: 'b.md', date: TODAY }),
		];

		expect(getDoneTasksForDate(notes, TODAY).map((n) => n.task)).toEqual(['Яблоки']);
	});

	it('невыполненный день - пустой список', () => {
		const notes = [note({ date: TODAY, done: ['2026-08-11'] })];

		expect(getDoneTasksForDate(notes, TODAY)).toEqual([]);
	});

	it('сортирует по наименованию', () => {
		const notes = [
			note({ task: 'Яблоки', link: 'a.md', done: [TODAY] }),
			note({ task: 'Бумага', link: 'b.md', done: [TODAY] }),
		];

		expect(getDoneTasksForDate(notes, TODAY).map((n) => n.task)).toEqual(['Бумага', 'Яблоки']);
	});

	it('прошедшее закрытие повтора остаётся в своём дне', () => {
		const notes = [note({
			task: 'Молоко',
			date: '2026-08-14',
			done: ['2026-08-11', TODAY],
			repeat: { interval: 1, unit: 'day' },
		})];

		expect(getDoneTasksForDate(notes, TODAY).map((n) => n.task)).toEqual(['Молоко']);
		expect(getDoneTasksForDate(notes, '2026-08-11').map((n) => n.task)).toEqual(['Молоко']);
		expect(getDoneTasksForDate(notes, '2026-08-14')).toEqual([]);
	});

	it('день из журнала, не попадающий в повторку, всё равно отдаётся', () => {
		// Вписали руками мимо череды - иначе такую запись нечем было бы снять.
		const notes = [note({
			task: 'Молоко',
			date: TODAY,
			done: ['2026-08-14'],
			repeat: { interval: 2, unit: 'day' },
		})];

		expect(getDoneTasksForDate(notes, '2026-08-14').map((n) => n.task)).toEqual(['Молоко']);
	});

	it('не пересекается с невыполненными того же дня', () => {
		const notes = [note({ task: 'Молоко', date: TODAY, done: [TODAY] })];

		expect(getTasksForDate(notes, TODAY)).toEqual([]);
		expect(getDoneTasksForDate(notes, TODAY)).toHaveLength(1);
	});
});

describe('toggleBodyCheckbox', () => {
	const body = [
		'- [ ] Подзадача 1',
		'- [x] Подзадача 2',
		'\t- [ ] Подзадача 2.1',
	].join('\n');

	it('ставит галочку', () => {
		expect(toggleBodyCheckbox(body, 0)?.split('\n')[0]).toBe('- [x] Подзадача 1');
	});

	it('снимает галочку', () => {
		expect(toggleBodyCheckbox(body, 1)?.split('\n')[1]).toBe('- [ ] Подзадача 2');
	});

	it('трогает только свою строку', () => {
		const result = toggleBodyCheckbox(body, 2);

		expect(result?.split('\n')).toEqual([
			'- [ ] Подзадача 1',
			'- [x] Подзадача 2',
			'\t- [x] Подзадача 2.1',
		]);
	});

	it('чекбокса с таким номером нет - null', () => {
		expect(toggleBodyCheckbox(body, 3)).toBeNull();
		expect(toggleBodyCheckbox('обычный текст', 0)).toBeNull();
	});

	it('понимает разные маркеры списка', () => {
		const list = ['* [ ] звёздочка', '+ [ ] плюс', '1. [ ] номер', '2) [ ] скобка'].join('\n');

		expect(toggleBodyCheckbox(list, 0)?.split('\n')[0]).toBe('* [x] звёздочка');
		expect(toggleBodyCheckbox(list, 1)?.split('\n')[1]).toBe('+ [x] плюс');
		expect(toggleBodyCheckbox(list, 2)?.split('\n')[2]).toBe('1. [x] номер');
		expect(toggleBodyCheckbox(list, 3)?.split('\n')[3]).toBe('2) [x] скобка');
	});

	it('свой значок темы считается невыполненным', () => {
		// '[/]' и подобные - не 'x', поэтому отметка их закрывает.
		expect(toggleBodyCheckbox('- [/] в работе', 0)).toBe('- [x] в работе');
	});

	it('блок свойств не трогается и в счёт не идёт', () => {
		const content = [
			'---',
			'Задача: Купить молоко',
			'Выполнено:',
			'  - 2026-08-13',
			'---',
			'',
			'- [ ] Подзадача 1',
		].join('\n');

		const result = toggleBodyCheckbox(content, 0);

		expect(result).toContain('  - 2026-08-13');
		expect(result?.endsWith('- [x] Подзадача 1')).toBe(true);
	});

	it('строки внутри блока кода пропускаются', () => {
		// Рендер их чекбоксами не делает - иначе нумерация разъедется.
		const content = [
			'```',
			'- [ ] это код',
			'```',
			'- [ ] настоящая подзадача',
		].join('\n');

		const result = toggleBodyCheckbox(content, 0);

		expect(result).toContain('- [ ] это код');
		expect(result).toContain('- [x] настоящая подзадача');
	});

	it('текст подзадачи сохраняется дословно', () => {
		const line = '  - [ ] Подбрить усы - **4 уровень** [[ссылка]]';

		expect(toggleBodyCheckbox(line, 0))
			.toBe('  - [x] Подбрить усы - **4 уровень** [[ссылка]]');
	});
});

describe('extractLists', () => {
	it('оставляет только строки списков', () => {
		const body = [
			'## Заголовок',
			'Обычный абзац',
			'- [ ] Подзадача 1',
			'Ещё абзац',
			'- Просто пункт',
		].join('\n');

		expect(extractLists(body)).toBe('- [ ] Подзадача 1\n- Просто пункт');
	});

	it('сохраняет вложенность дословно', () => {
		const body = ['- [ ] Родитель', '\t- [ ] Ребёнок', '    - [x] Внук'].join('\n');

		expect(extractLists(body)).toBe(body);
	});

	it('понимает все маркеры списка', () => {
		const body = ['- дефис', '* звёздочка', '+ плюс', '1. номер', '2) скобка'].join('\n');

		expect(extractLists(body)).toBe(body);
	});

	it('пустые строки между пунктами уходят', () => {
		expect(extractLists('- один\n\n- два')).toBe('- один\n- два');
	});

	it('списков нет - пусто', () => {
		expect(extractLists('## Заголовок\n\nАбзац')).toBe('');
		expect(extractLists('')).toBe('');
	});

	it('блок кода со списком внутри не считается списком', () => {
		// То же правило, что в toggleBodyCheckbox: иначе нумерация чекбоксов разъедется.
		const body = ['```', '- [ ] это код', '```', '- [ ] настоящая'].join('\n');

		expect(extractLists(body)).toBe('- [ ] настоящая');
	});

	it('список внутри цитаты не берётся', () => {
		// '>' в начале строки - уже не пункт списка, а цитата.
		expect(extractLists('> - [ ] в цитате\n- [ ] снаружи')).toBe('- [ ] снаружи');
	});

	it('нумерация чекбоксов совпадает с toggleBodyCheckbox', () => {
		const body = [
			'Абзац',
			'- [ ] Первая',
			'## Заголовок',
			'\t- [ ] Вторая',
			'```',
			'- [ ] в коде',
			'```',
			'- [ ] Третья',
		].join('\n');

		// Второй чекбокс в показанном списке - он же второй в файле.
		expect(extractLists(body).split('\n')[1]).toBe('\t- [ ] Вторая');
		expect(toggleBodyCheckbox(body, 1)).toContain('\t- [x] Вторая');
	});
});

describe('extractBody', () => {
	it('отрезает блок свойств', () => {
		const content = [
			'---',
			'Задача: Купить молоко',
			'Дата: 2026-08-12',
			'---',
			'',
			'- [ ] Подзадача 1',
			'\t- [ ] Подзадача 1.1',
			'',
		].join('\n');

		expect(extractBody(content)).toBe('- [ ] Подзадача 1\n\t- [ ] Подзадача 1.1');
	});

	it('заметка без свойств возвращается как есть', () => {
		expect(extractBody('просто текст\n')).toBe('просто текст');
	});

	it('пустое тело - пустая строка', () => {
		expect(extractBody('---\nЗадача: Что-то\n---\n')).toBe('');
	});
});

describe('nextOccurrenceAfter', () => {
	it('дневной повтор шагает интервалом', () => {
		const every3 = note({ date: '2026-08-13', repeat: { interval: 3, unit: 'day' } });

		expect(nextOccurrenceAfter(every3, '2026-08-13')).toBe('2026-08-16');
	});

	it('месячный повтор пропускает короткие месяцы', () => {
		const monthly = note({ date: '2026-01-31', repeat: { interval: 1, unit: 'month' } });

		// Февраля 31-го не бывает - следующий повтор в марте.
		expect(nextOccurrenceAfter(monthly, '2026-01-31')).toBe('2026-03-31');
	});

	it('годовой повтор с месяцами идёт по названным месяцам', () => {
		const twice = note({
			date: '2026-08-13',
			repeat: { interval: 1, unit: 'year', months: [2, 8] },
		});

		// «Дата» повтором не является, но отсчёт от неё работает.
		expect(nextOccurrenceAfter(twice, '2026-08-13')).toBe('2026-09-13');
		expect(nextOccurrenceAfter(twice, '2026-09-13')).toBe('2027-03-13');
		expect(nextOccurrenceAfter(twice, '2027-03-13')).toBe('2027-09-13');
	});

	it('годовой повтор с месяцами ищет и в текущем месяце', () => {
		const march = note({
			date: '2026-03-13',
			repeat: { interval: 1, unit: 'year', months: [2] },
		});

		// 1 марта - тот же месяц, что и повтор: 13-е ещё впереди.
		expect(nextOccurrenceAfter(march, '2026-03-01')).toBe('2026-03-13');
	});

	it('у разовой задачи следующего повтора нет', () => {
		expect(nextOccurrenceAfter(note({ date: TODAY }), TODAY)).toBeNull();
	});
});

describe('isBodyComplete и hasCheckboxes', () => {
	it('отмечены все чекбоксы - выполнено', () => {
		expect(isBodyComplete('- [x] Раз\n- [x] Два')).toBe(true);
		expect(isBodyComplete('- [x] Раз\n\t- [x] Два')).toBe(true);
	});

	it('хоть один снят - не выполнено', () => {
		expect(isBodyComplete('- [x] Раз\n- [ ] Два')).toBe(false);
	});

	it('чекбоксов нет - не выполнено, отмечать нечем', () => {
		expect(isBodyComplete('')).toBe(false);
		expect(isBodyComplete('- обычный пункт')).toBe(false);
		expect(hasCheckboxes('- обычный пункт')).toBe(false);
		expect(hasCheckboxes('- [ ] Раз')).toBe(true);
	});

	it('дня в расчёте нет - блоки не размножают наборы', () => {
		// Заголовок с датой это просто текст: набор чекбоксов считается один.
		expect(isBodyComplete('## 2026-08-13\n- [x] Раз\n## 2026-08-14\n- [ ] Раз')).toBe(false);
	});
});

describe('firstCheckboxText', () => {
	it('отдаёт текст первого чекбокса', () => {
		expect(firstCheckboxText('- [ ] Побрить бороду\n- [ ] Подбрить усы'))
			.toBe('Побрить бороду');
		expect(firstCheckboxText('- [x] Готово')).toBe('Готово');
	});

	it('обычные пункты списка не считаются', () => {
		expect(firstCheckboxText('- просто пункт\n- [ ] Чекбокс')).toBe('Чекбокс');
	});

	it('строки блока кода пропускаются', () => {
		expect(firstCheckboxText('```\n- [ ] в коде\n```\n- [ ] настоящий'))
			.toBe('настоящий');
	});

	it('чекбоксов нет - null', () => {
		expect(firstCheckboxText('')).toBeNull();
		expect(firstCheckboxText('- пункт')).toBeNull();
		// Пустой текст чекбокса подписью быть не может.
		expect(firstCheckboxText('- [ ] ')).toBeNull();
	});
});

describe('clearBodyChecks', () => {
	const content = ['---', 'Дата: 2026-08-13', '---', '', '- [x] Раз', '- [x] Два'].join('\n');

	it('снимает все галочки, блок свойств не трогает', () => {
		expect(clearBodyChecks(content)).toBe(
			['---', 'Дата: 2026-08-13', '---', '', '- [ ] Раз', '- [ ] Два'].join('\n')
		);
	});

	it('снимает и частично отмеченные', () => {
		expect(clearBodyChecks('- [x] Раз\n- [ ] Два')).toBe('- [ ] Раз\n- [ ] Два');
	});

	it('снимать нечего - null, файл трогать не надо', () => {
		expect(clearBodyChecks('- [ ] Раз\n- [ ] Два')).toBeNull();
		expect(clearBodyChecks('обычный текст')).toBeNull();
	});

	it('строки блока кода не трогаются', () => {
		expect(clearBodyChecks('```\n- [x] в коде\n```')).toBeNull();
	});

	it('отступы, маркеры и текст остаются дословно', () => {
		expect(clearBodyChecks('\t* [x] Вложенный пункт')).toBe('\t* [ ] Вложенный пункт');
	});
});

describe('collapseBodyBlocks', () => {
	it('оставляет последний набор, заголовки убирает', () => {
		const content = [
			'---',
			'Дата: 2026-08-13',
			'---',
			'',
			'## 2026-08-13',
			'- [x] Раз',
			'- [x] Два',
			'',
			'## 2026-08-14',
			'- [x] Раз',
			'- [ ] Два',
			'',
		].join('\n');

		expect(collapseBodyBlocks(content)).toBe(
			['---', 'Дата: 2026-08-13', '---', '', '- [x] Раз', '- [ ] Два', ''].join('\n')
		);
	});

	it('галочки последнего набора сохраняются', () => {
		// Их могли поставить руками в редакторе - сворачивание отметку не теряет.
		expect(collapseBodyBlocks('## 2026-08-13\n- [x] Раз')).toBe('- [x] Раз\n');
	});

	it('текст до первого заголовка не трогается', () => {
		const content = ['Вступление.', '', '## 2026-08-13', '- [ ] Раз', ''].join('\n');

		expect(collapseBodyBlocks(content)).toBe('Вступление.\n\n- [ ] Раз\n');
	});

	it('блоков нет - null, сворачивать нечего', () => {
		expect(collapseBodyBlocks('- [ ] Раз')).toBeNull();
		// Заголовок без даты блоком итерации не считается.
		expect(collapseBodyBlocks('## Планы\n- [ ] Раз')).toBeNull();
	});
});

describe('firstPendingBefore и firstPendingUpTo', () => {
	it('разовая задача в прошлом просрочена своим днём', () => {
		const single = note({ date: '2026-08-10' });

		expect(firstPendingBefore(single, TODAY)).toBe('2026-08-10');
	});

	it('разовая задача на сегодня не просрочена', () => {
		expect(firstPendingBefore(note({ date: TODAY }), TODAY)).toBeNull();
		// Но закрыть её из заметки можно - день не позже сегодня.
		expect(firstPendingUpTo(note({ date: TODAY }), TODAY)).toBe(TODAY);
	});

	it('будущая задача не просрочена и из заметки не закрывается', () => {
		const future = note({ date: '2026-08-20' });

		expect(firstPendingBefore(future, TODAY)).toBeNull();
		expect(firstPendingUpTo(future, TODAY)).toBeNull();
	});

	it('у повтора берётся самый ранний незакрытый день', () => {
		const daily = note({
			date: '2026-08-10',
			done: ['2026-08-10', '2026-08-11'],
			repeat: { interval: 1, unit: 'day' },
		});

		expect(firstPendingBefore(daily, TODAY)).toBe('2026-08-12');
	});

	it('все прошлые дни закрыты - просрочки нет', () => {
		const daily = note({
			date: '2026-08-11',
			done: ['2026-08-11', '2026-08-12'],
			repeat: { interval: 1, unit: 'day' },
		});

		expect(firstPendingBefore(daily, TODAY)).toBeNull();
		// Сегодняшний день ещё открыт - его и закроет отметка в заметке.
		expect(firstPendingUpTo(daily, TODAY)).toBe(TODAY);
	});

	it('дни, вписанные в журнал вразнобой, не путают отсчёт', () => {
		const daily = note({
			date: '2026-08-10',
			done: ['2026-08-12', '2026-08-11'],
			repeat: { interval: 1, unit: 'day' },
		});

		expect(firstPendingBefore(daily, TODAY)).toBe('2026-08-10');
	});

	it('«Дата» повтором быть не обязана', () => {
		// Четверг 13 августа, повтор по субботам: череда начинается 15-го.
		const saturdays = note({
			date: '2026-08-01',
			repeat: { interval: 1, unit: 'week', weekdays: [6] },
		});

		expect(firstPendingBefore(saturdays, TODAY)).toBe('2026-08-01');
		expect(firstPendingBefore(
			note({ date: '2026-08-03', repeat: { interval: 1, unit: 'week', weekdays: [6] } }),
			TODAY
		)).toBe('2026-08-08');
	});

	it('закрытая разовая и остановленная задача не просрочены', () => {
		expect(firstPendingBefore(note({ date: '2026-08-10', done: ['2026-08-10'] }), TODAY))
			.toBeNull();
		expect(firstPendingBefore(
			note({ date: '2026-08-10', repeat: { interval: 1, unit: 'day' }, stopped: true }),
			TODAY
		)).toBeNull();
	});

	it('задача без «Даты» не просрочена', () => {
		expect(firstPendingBefore(note({ date: null }), TODAY)).toBeNull();
	});
});

describe('getOverdueTasks', () => {
	it('собирает по карточке на задачу, от старого долга к свежему', () => {
		const notes = [
			note({ task: 'Свежая', link: 'a.md', date: '2026-08-12' }),
			note({ task: 'Старая', link: 'b.md', date: '2026-08-01' }),
			note({ task: 'Сегодняшняя', link: 'c.md', date: TODAY }),
		];

		expect(getOverdueTasks(notes, TODAY)).toEqual([
			{ note: notes[1], date: '2026-08-01' },
			{ note: notes[0], date: '2026-08-12' },
		]);
	});

	it('повтор с кучей пропусков даёт одну карточку', () => {
		const notes = [note({
			task: 'Побрить бороду',
			link: 'a.md',
			date: '2026-07-20',
			repeat: { interval: 1, unit: 'day' },
		})];

		expect(getOverdueTasks(notes, TODAY)).toEqual([
			{ note: notes[0], date: '2026-07-20' },
		]);
	});

	it('при равных днях порядок по наименованию', () => {
		const notes = [
			note({ task: 'Яблоки', link: 'a.md', date: '2026-08-10' }),
			note({ task: 'Бумага', link: 'b.md', date: '2026-08-10' }),
		];

		expect(getOverdueTasks(notes, TODAY).map((item) => item.note.task))
			.toEqual(['Бумага', 'Яблоки']);
	});

	it('долгов нет - пустой список', () => {
		expect(getOverdueTasks([note({ date: TODAY })], TODAY)).toEqual([]);
	});
});
