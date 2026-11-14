import { describe, expect, it } from 'vitest';
import momentLib from 'moment';
import {
	allChecked,
	automate,
	buildTaskFile,
	compareByCreation,
	compareByDateTime,
	compareOverdueFirst,
	Frontmatter,
	frontmatterOf,
	hasNumberingGap,
	isOverdue,
	nextDate,
	nextRepeatDate,
	normalizeDate,
	normalizeDateTime,
	occurrencesInRange,
	parseRepeat,
	readTask,
	readTaskFile,
	renumberSubtasks,
	showDate,
	stateOf,
	Task,
	taskFileName,
	TaskState,
} from '../src/taskFormat';
import { parseFrontmatter } from './mocks/obsidian';
import { taskFileText, taskProps, TaskFixture, TODAY } from './helpers';

/** Задача из описания свойств. */
const taskOf = (fixture: TaskFixture = {}, path = 'Задачи/20260813_120000.md'): Task => {
	const task = readTask(path, taskProps(fixture));
	if (!task) throw new Error('не задача');

	return task;
};

describe('parseRepeat', () => {
	it('разбирает единицы без числа', () => {
		expect(parseRepeat('Каждый день')).toEqual({ interval: 1, unit: 'day' });
		expect(parseRepeat('Каждую неделю')).toEqual({ interval: 1, unit: 'week' });
		expect(parseRepeat('Каждый месяц')).toEqual({ interval: 1, unit: 'month' });
		expect(parseRepeat('Каждый год')).toEqual({ interval: 1, unit: 'year' });
	});

	it('разбирает число независимо от согласования окончаний', () => {
		expect(parseRepeat('Каждые 2 дня')).toEqual({ interval: 2, unit: 'day' });
		expect(parseRepeat('Каждый 2 день')).toEqual({ interval: 2, unit: 'day' });
		expect(parseRepeat('Каждую 2 неделю')).toEqual({ interval: 2, unit: 'week' });
		expect(parseRepeat('Каждый 2 месяц')).toEqual({ interval: 2, unit: 'month' });
		expect(parseRepeat('Каждый 2 год')).toEqual({ interval: 2, unit: 'year' });
		expect(parseRepeat('Каждые 2 года')).toEqual({ interval: 2, unit: 'year' });
	});

	it('регистр не важен, хвостовые пробелы обрезаются', () => {
		expect(parseRepeat('  КАЖДЫЙ ДЕНЬ  ')).toEqual({ interval: 1, unit: 'day' });
	});

	it('разбирает дни недели после недели', () => {
		expect(parseRepeat('Каждую неделю в Субботу')).toEqual({
			interval: 1,
			unit: 'week',
			weekdays: [6],
		});
		expect(parseRepeat('Каждые 2 недели в Субботу, Понедельник')).toEqual({
			interval: 2,
			unit: 'week',
			weekdays: [1, 6],
		});
	});

	it('принимает винительный и именительный падежи дней недели', () => {
		expect(parseRepeat('Каждую неделю в Среду')).toEqual({
			interval: 1, unit: 'week', weekdays: [3],
		});
		expect(parseRepeat('Каждую неделю в Среда')).toEqual({
			interval: 1, unit: 'week', weekdays: [3],
		});
	});

	it('разбирает месяцы после года', () => {
		expect(parseRepeat('Каждый год в Марте, Сентябре')).toEqual({
			interval: 1,
			unit: 'year',
			months: [2, 8],
		});
		expect(parseRepeat('Каждые 2 года в Марте')).toEqual({
			interval: 2,
			unit: 'year',
			months: [2],
		});
	});

	it('понимает упрощённую запись без «в» - все формы из текста обновления 1.0.1', () => {
		expect(parseRepeat('Каждую неделю Суббота, Воскресенье')).toEqual({
			interval: 1, unit: 'week', weekdays: [6, 7],
		});
		expect(parseRepeat('Каждую 2 неделю Суббота, Воскресенье')).toEqual({
			interval: 2, unit: 'week', weekdays: [6, 7],
		});
		expect(parseRepeat('Каждый год Июль, Август')).toEqual({
			interval: 1, unit: 'year', months: [6, 7],
		});
		expect(parseRepeat('Каждый 2 год Июль, Август')).toEqual({
			interval: 2, unit: 'year', months: [6, 7],
		});
	});

	it('и без «в» дни недели уточняют только неделю, а месяцы - только год', () => {
		expect(parseRepeat('Каждый день Суббота')).toBeNull();
		expect(parseRepeat('Каждый месяц Суббота')).toBeNull();
		expect(parseRepeat('Каждую неделю Июль')).toBeNull();
	});

	it('дни недели с месяцем и днём не сочетаются', () => {
		expect(parseRepeat('Каждый месяц в Субботу')).toBeNull();
		expect(parseRepeat('Каждый день в Субботу')).toBeNull();
		expect(parseRepeat('Каждую неделю в Марте')).toBeNull();
		expect(parseRepeat('Каждый год в Марте, Субботу')).toBeNull();
	});

	it('незнакомую форму не принимает', () => {
		expect(parseRepeat('Каждый день, кроме выходных')).toBeNull();
		expect(parseRepeat('Каждую ндлю')).toBeNull();
		expect(parseRepeat('По будням')).toBeNull();
		expect(parseRepeat('')).toBeNull();
		expect(parseRepeat(null)).toBeNull();
	});

	it('понимает наречия и короткие формы', () => {
		expect(parseRepeat('Ежедневно')).toEqual({ interval: 1, unit: 'day' });
		expect(parseRepeat('Каждую субботу')).toEqual({
			interval: 1, unit: 'week', weekdays: [6],
		});
		expect(parseRepeat('Каждый март')).toEqual({
			interval: 1, unit: 'year', months: [2],
		});
	});
});

describe('nextDate', () => {
	const next = (repeat: string, date: string): string | null => {
		const parsed = parseRepeat(repeat);
		if (!parsed) throw new Error(`не разобрался повтор: ${repeat}`);

		return nextDate(date, parsed);
	};

	it('каждый день - база плюс день', () => {
		expect(next('Каждый день', '2026-08-20')).toBe('2026-08-21');
	});

	it('дата выполнения на расчёт не влияет: закрытая с опозданием остаётся в прошлом', () => {
		expect(next('Каждый день', '2026-08-01')).toBe('2026-08-02');
	});

	it('каждые N дней', () => {
		expect(next('Каждые 3 дня', '2026-08-20')).toBe('2026-08-23');
	});

	it('неделя без дней - база плюс 7×N', () => {
		expect(next('Каждую неделю', '2026-08-20')).toBe('2026-08-27');
		expect(next('Каждые 2 недели', '2026-08-20')).toBe('2026-09-03');
	});

	it('неделя с днём: следующего дня в неделе базы нет - неделя базы плюс N', () => {
		expect(next('Каждую неделю в Субботу', '2026-08-22')).toBe('2026-08-29');
	});

	it('неделя с двумя днями: ближайший день строго после базы внутри её недели', () => {
		expect(next('Каждую неделю в Субботу, Понедельник', '2026-08-22')).toBe('2026-08-24');
		expect(next('Каждую неделю в Субботу, Понедельник', '2026-08-24')).toBe('2026-08-29');
	});

	it('упрощённая запись считается так же, как с «в»', () => {
		expect(next('Каждую 2 неделю Суббота, Воскресенье', '2026-08-22')).toBe('2026-08-23');
		expect(next('Каждую 2 неделю Суббота, Воскресенье', '2026-08-23')).toBe('2026-09-05');
		expect(next('Каждый 2 год Июль, Август', '2026-07-10')).toBe('2026-08-10');
		expect(next('Каждый 2 год Июль, Август', '2026-08-10')).toBe('2028-07-10');
	});

	it('месяц: число сохраняется, при переполнении зажимается', () => {
		expect(next('Каждый месяц', '2026-01-31')).toBe('2026-02-28');
		expect(next('Каждый месяц', '2026-08-20')).toBe('2026-09-20');
	});

	it('год без месяцев: 29 февраля становится 28 февраля', () => {
		expect(next('Каждый год', '2026-08-20')).toBe('2027-08-20');
		expect(next('Каждый год', '2028-02-29')).toBe('2029-02-28');
	});

	it('год с месяцами: ближайший месяц в том же году, иначе год базы плюс N', () => {
		expect(next('Каждый год в Марте, Сентябре', '2026-03-15')).toBe('2026-09-15');
		expect(next('Каждый год в Марте, Сентябре', '2026-09-15')).toBe('2027-03-15');
	});

	it('год с месяцами: число зажимается по длине месяца', () => {
		expect(next('Каждый год в Феврале', '2026-01-31')).toBe('2026-02-28');
	});

	it('мусорную базу не считает', () => {
		expect(nextDate('вчера', { interval: 1, unit: 'day' })).toBeNull();
	});

	it('следующая дата повтора пропускает день, на который перенесли саму задачу', () => {
		const daily = parseRepeat('Каждый день')!;

		expect(nextRepeatDate('2026-08-13', daily, null)).toBe('2026-08-14');
		expect(nextRepeatDate('2026-08-13', daily, '2026-08-20')).toBe('2026-08-14');
		expect(nextRepeatDate('2026-08-13', daily, '2026-08-14')).toBe('2026-08-15');
	});
});

describe('дни повтора в окне', () => {
	const days = (repeat: string, base: string, from: string, to: string, limit?: number) => {
		const parsed = parseRepeat(repeat);
		if (!parsed) throw new Error(`не разобрался повтор: ${repeat}`);

		return occurrencesInRange(base, parsed, from, to, limit);
	};

	it('дни недельного повтора по субботам и воскресеньям', () => {
		expect(days('Каждую неделю Суббота, Воскресенье', '2026-08-22', '2026-07-27', '2026-09-06'))
			.toEqual(['2026-08-23', '2026-08-29', '2026-08-30', '2026-09-05', '2026-09-06']);
	});

	it('база в повтор не входит - её день календарь и так знает', () => {
		expect(days('Каждый день', '2026-08-22', '2026-08-22', '2026-08-24'))
			.toEqual(['2026-08-23', '2026-08-24']);
	});

	it('дни до базы не показываются: задачи тогда ещё не было', () => {
		expect(days('Каждую неделю в Субботу', '2026-08-22', '2026-08-01', '2026-08-31'))
			.toEqual(['2026-08-29']);
	});

	it('повтор докручивается до окна, а за окном обрывается', () => {
		expect(days('Каждый день', '2026-08-01', '2026-08-20', '2026-08-22'))
			.toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
	});

	it('месячный повтор считается шагами, а не арифметикой: зажатое число не отыгрывается', () => {
		// 31 января -> 28 февраля -> 28 марта, а не 31 марта.
		expect(days('Каждый месяц', '2026-01-31', '2026-02-01', '2026-04-30'))
			.toEqual(['2026-02-28', '2026-03-28', '2026-04-28']);
	});

	it('окно кончилось до базы - дней нет', () => {
		expect(days('Каждый день', '2026-08-22', '2026-08-01', '2026-08-10')).toEqual([]);
	});

	it('перебор ограничен: до далёкого окна повтор не докручивается', () => {
		expect(days('Каждый день', '2026-08-01', '2030-01-01', '2030-01-31', 10)).toEqual([]);
	});
});

describe('свойства задачи', () => {
	it('читает все свойства шаблона', () => {
		const task = taskOf({
			text: 'Купить молоко',
			checked: true,
			date: '2026-08-13T09:30:00',
			doneDate: '2026-08-13',
			repeat: 'Каждый день',
			move: '2026-08-15',
			subtasks: [['Проверить срок', true]],
		});

		expect(task).toEqual({
			path: 'Задачи/20260813_120000.md',
			fileName: '20260813_120000',
			folder: 'Задачи',
			text: 'Купить молоко',
			checked: true,
			date: '2026-08-13',
			dateTime: '2026-08-13T09:30:00',
			doneDate: '2026-08-13',
			repeat: 'Каждый день',
			move: '2026-08-15',
			subtasks: [{ path: [1], text: 'Проверить срок', checked: true }],
		});
	});

	it('«Дата и время»: с секундами, без секунд и одним днём - полночь', () => {
		expect(taskOf({ date: '2026-08-13T08:05:09' })).toMatchObject({ date: '2026-08-13', dateTime: '2026-08-13T08:05:09' });
		expect(taskOf({ date: '2026-08-13T08:05' })).toMatchObject({ date: '2026-08-13', dateTime: '2026-08-13T08:05:00' });
		expect(taskOf({ date: '2026-08-13' })).toMatchObject({ date: '2026-08-13', dateTime: '2026-08-13T00:00:00' });
	});

	it('кривое «Дата и время» - пусто', () => {
		for (const value of ['2026-08-13 08:00', '2026-08-13T25:00:00', '2026-02-30T08:00:00', '13.08.2026 08:00', '2026-08-13T08:00:00Z', 20260813]) {
			expect(normalizeDateTime(value), String(value)).toBeNull();
		}
	});

	it('прежнее свойство «Дата» больше не читается', () => {
		expect(readTask('a.md', { Задача: 'Дело', Дата: TODAY })).toMatchObject({ date: null, dateTime: null });
	});

	it('файл в корне хранилища - папка пустая', () => {
		expect(taskOf({}, '20260813_120000.md')).toMatchObject({ folder: '', fileName: '20260813_120000' });
	});

	it('без непустого «Задача» файл задачей не считается', () => {
		expect(readTask('a.md', { Задача: '  ', 'Дата и время': TODAY })).toBeNull();
		expect(readTask('a.md', { 'Дата и время': TODAY })).toBeNull();
		expect(readTask('a.md', null)).toBeNull();
		expect(readTask('a.md', ['Задача'])).toBeNull();
	});

	it('число в тексте читается строкой', () => {
		expect(readTask('a.md', { Задача: 42 })?.text).toBe('42');
	});

	it('пустые и кривые даты - пусто, задача при этом видна', () => {
		const task = readTask('a.md', {
			Задача: 'Дело',
			'Дата и время': '2026-02-30T08:00:00',
			'Дата выполнения': '13.08.2026',
			'Дата переноса': null,
		});

		expect(task).toMatchObject({ date: null, dateTime: null, doneDate: null, move: null });
	});

	it('дата объектом Date из YAML читается по UTC', () => {
		expect(normalizeDate(new Date(Date.UTC(2026, 7, 13)))).toBe('2026-08-13');
		expect(normalizeDate(new Date('мусор'))).toBeNull();
		expect(normalizeDateTime(new Date(Date.UTC(2026, 7, 13, 8, 5, 9)))).toBe('2026-08-13T08:05:09');
		expect(normalizeDateTime(new Date('мусор'))).toBeNull();
	});

	it('галочка - булево true или строка true', () => {
		expect(readTask('a.md', { Задача: 'Дело', Выполнено: 'true' })?.checked).toBe(true);
		expect(readTask('a.md', { Задача: 'Дело', Выполнено: 'нет' })?.checked).toBe(false);
		expect(readTask('a.md', { Задача: 'Дело' })?.checked).toBe(false);
	});

	it('нераспознанный повтор читается как есть: задача видна, просто без повтора', () => {
		expect(taskOf({ repeat: 'Каждую ндлю' }).repeat).toBe('Каждую ндлю');
	});

	it('подзадачи идут по номеру, а не по порядку ключей в файле', () => {
		const task = readTask('a.md', {
			Задача: 'Дело',
			'Подзадача-2': 'Два',
			'Подзадача-1': 'Раз',
			'Подзадача-1-выполнено': true,
		});

		expect(task?.subtasks).toEqual([
			{ path: [1], text: 'Раз', checked: true },
			{ path: [2], text: 'Два', checked: false },
		]);
	});

	it('вложенные подзадачи: номер по уровням, порядок обхода дерева, своя галочка у каждой', () => {
		const task = readTask('a.md', {
			Задача: 'Главная задача',
			'Подзадача-2': 'Два',
			'Подзадача-1-2': 'Раз-два',
			'Подзадача-1-2-выполнено': true,
			'Подзадача-1': 'Раз',
			'Подзадача-1-1': 'Раз-раз',
			'Подзадача-1-1-1': 'Раз-раз-раз',
			'Подзадача-10': 'Десять',
		});

		expect(task?.subtasks).toEqual([
			{ path: [1], text: 'Раз', checked: false },
			{ path: [1, 1], text: 'Раз-раз', checked: false },
			{ path: [1, 1, 1], text: 'Раз-раз-раз', checked: false },
			{ path: [1, 2], text: 'Раз-два', checked: true },
			{ path: [2], text: 'Два', checked: false },
			{ path: [10], text: 'Десять', checked: false },
		]);
	});

	it('отмечено всё - и на всех уровнях вложенности', () => {
		const props = (nested: boolean) => ({
			Задача: 'Дело', Выполнено: true,
			'Подзадача-1': 'Раз', 'Подзадача-1-выполнено': true,
			'Подзадача-1-1': 'Раз-раз', 'Подзадача-1-1-выполнено': nested,
		});

		expect(allChecked(readTask('a.md', props(false))!)).toBe(false);
		expect(allChecked(readTask('a.md', props(true))!)).toBe(true);
	});

	it('галочка без текста подзадачей не считается', () => {
		const task = readTask('a.md', {
			Задача: 'Дело',
			'Подзадача-1': null,
			'Подзадача-1-выполнено': true,
		});

		expect(task?.subtasks).toEqual([]);
	});

	it('свойства из файла: блок свойств и YAML', () => {
		expect(readTaskFile('a.md', taskFileText({ text: 'Дело', body: 'Заметка к задаче\n' }))?.text)
			.toBe('Дело');
		expect(frontmatterOf('Просто заметка')).toBeNull();
		expect(frontmatterOf('---\n---\n')).toBeNull();
		expect(frontmatterOf('---\nне: ключ: и не: значение\n---\n')).not.toBeNull();
		expect(frontmatterOf('---\nсломанный yaml\n---\n')).toBeNull();
	});
});

describe('отмечено всё, день показа, просрочка', () => {
	it('отмечено всё - и задача, и все подзадачи', () => {
		expect(allChecked(taskOf({ checked: true }))).toBe(true);
		expect(allChecked(taskOf({ checked: true, subtasks: [['Раз', true], ['Два', false]] }))).toBe(false);
		expect(allChecked(taskOf({ checked: false, subtasks: [['Раз', true]] }))).toBe(false);
	});

	it('день показа - день из «Дата и время», «Дата переноса» на него не влияет', () => {
		expect(showDate(taskOf({ date: '2026-08-13T09:00:00' }))).toBe('2026-08-13');
		expect(showDate(taskOf({ date: '2026-08-13', move: '2026-08-20' }))).toBe('2026-08-13');
		expect(showDate(taskOf({ date: null }))).toBeNull();
	});

	it('просрочена: не выполнена и день показа прошёл', () => {
		expect(isOverdue(taskOf({ date: '2026-08-12' }), TODAY)).toBe(true);
		expect(isOverdue(taskOf({ date: '2026-08-12', doneDate: TODAY }), TODAY)).toBe(false);
		// Перенос вперёд просрочку не снимает: «Дата переноса» не учитывается.
		expect(isOverdue(taskOf({ date: '2026-08-12', move: '2026-08-14' }), TODAY)).toBe(true);
		expect(isOverdue(taskOf({ date: null }), TODAY)).toBe(false);
	});
});

describe('нумерация подзадач', () => {
	it('дыру видно, подряд идущие - нет', () => {
		expect(hasNumberingGap({ 'Подзадача-1': 'a', 'Подзадача-2': 'b' })).toBe(false);
		expect(hasNumberingGap({ 'Подзадача-1': 'a', 'Подзадача-3': 'c' })).toBe(true);
		expect(hasNumberingGap({ 'Подзадача-2-выполнено': true })).toBe(true);
		expect(hasNumberingGap({ Задача: 'x' })).toBe(false);
	});

	it('удалили вторую - третья и четвёртая становятся второй и третьей', () => {
		const frontmatter: Frontmatter = {
			Задача: 'Дело',
			'Подзадача-1': 'Раз',
			'Подзадача-1-выполнено': true,
			'Подзадача-3': 'Три',
			'Подзадача-3-выполнено': false,
			'Подзадача-4': 'Четыре',
			'Подзадача-4-выполнено': true,
		};

		renumberSubtasks(frontmatter);

		expect(frontmatter).toEqual({
			Задача: 'Дело',
			'Подзадача-1': 'Раз',
			'Подзадача-1-выполнено': true,
			'Подзадача-2': 'Три',
			'Подзадача-2-выполнено': false,
			'Подзадача-3': 'Четыре',
			'Подзадача-3-выполнено': true,
		});
	});

	it('недописанная пара переезжает целиком, с пустым значением', () => {
		const frontmatter: Frontmatter = { Задача: 'Дело', 'Подзадача-2': null };

		renumberSubtasks(frontmatter);

		expect(frontmatter).toEqual({ Задача: 'Дело', 'Подзадача-1': null });
	});

	it('вложенные: дыру видно на любом уровне, подряд идущие - не дыра', () => {
		expect(hasNumberingGap({ 'Подзадача-1': 'a', 'Подзадача-1-1': 'b', 'Подзадача-1-2': 'c', 'Подзадача-2': 'd' })).toBe(false);
		expect(hasNumberingGap({ 'Подзадача-1': 'a', 'Подзадача-1-2': 'c' })).toBe(true);
		// Родитель без своих свойств - всё равно узел дерева: дыры нет.
		expect(hasNumberingGap({ 'Подзадача-1-1': 'b' })).toBe(false);
	});

	it('удалили родителя из середины - соседи сдвигаются, вложенные едут за родителем', () => {
		const frontmatter: Frontmatter = {
			Задача: 'Дело',
			'Подзадача-1': 'Раз',
			'Подзадача-3': 'Три',
			'Подзадача-3-выполнено': true,
			'Подзадача-3-1': 'Три-раз',
			'Подзадача-3-3': 'Три-три',
			'Подзадача-3-3-выполнено': false,
		};

		renumberSubtasks(frontmatter);

		expect(frontmatter).toEqual({
			Задача: 'Дело',
			'Подзадача-1': 'Раз',
			'Подзадача-2': 'Три',
			'Подзадача-2-выполнено': true,
			'Подзадача-2-1': 'Три-раз',
			'Подзадача-2-2': 'Три-три',
			'Подзадача-2-2-выполнено': false,
		});
	});
});

describe('автоматика', () => {
	const notAll: TaskState = { all: false, move: null };
	const all: TaskState = { all: true, move: null };

	it('отмечено всё - ставится дата выполнения', () => {
		const frontmatter = taskProps({ checked: true });

		expect(automate(frontmatter, notAll, TODAY)).toEqual({ changed: true, next: null });
		expect(frontmatter['Дата выполнения']).toBe(TODAY);
	});

	it('галочка задачи при открытой подзадаче выполнения не даёт', () => {
		const frontmatter = taskProps({ checked: true, subtasks: [['Раз', false]] });

		expect(automate(frontmatter, notAll, TODAY).changed).toBe(false);
		expect(frontmatter['Дата выполнения']).toBeNull();
	});

	it('выполнение повтора очищает повтор и даёт следующий файл со снятыми подзадачами', () => {
		const frontmatter = taskProps({
			text: 'Полить фикус',
			checked: true,
			date: '2026-08-15T21:30:00',
			repeat: 'Каждую неделю Суббота, Воскресенье',
			subtasks: [['Налить воды', true]],
		});

		// Только день по расчёту: время выполненной (21:30) не переносится - его
		// ставит запись файла, момент создания.
		expect(automate(frontmatter, notAll, TODAY)).toEqual({
			changed: true,
			next: {
				text: 'Полить фикус',
				date: '2026-08-16',
				repeat: 'Каждую неделю Суббота, Воскресенье',
				subtasks: [{ path: [1], text: 'Налить воды' }],
			},
		});
		expect(frontmatter['Повтор']).toBeNull();
		expect(frontmatter['Дата выполнения']).toBe(TODAY);
	});

	it('следующий повтор сохраняет вложенность подзадач, галочки сняты', () => {
		const frontmatter = taskProps({
			checked: true,
			repeat: 'Каждый день',
			subtasks: [['Раз', true], ['Раз-раз', true, '1-1'], ['Два', true, '2']],
		});

		expect(automate(frontmatter, notAll, TODAY).next?.subtasks).toEqual([
			{ path: [1], text: 'Раз' },
			{ path: [1, 1], text: 'Раз-раз' },
			{ path: [2], text: 'Два' },
		]);
	});

	it('база следующего повтора - «Дата и время», а не сегодняшний день', () => {
		const frontmatter = taskProps({ checked: true, date: '2026-08-01', repeat: 'Каждый день' });

		expect(automate(frontmatter, notAll, TODAY).next?.date).toBe('2026-08-02');
	});

	it('нераспознанный повтор следующего файла не даёт и остаётся как написан', () => {
		const frontmatter = taskProps({ checked: true, repeat: 'Каждую ндлю' });

		expect(automate(frontmatter, notAll, TODAY)).toEqual({ changed: true, next: null });
		expect(frontmatter['Повтор']).toBe('Каждую ндлю');
	});

	it('снятая галочка очищает дату выполнения, повтор не возвращается', () => {
		const frontmatter = taskProps({ checked: false, doneDate: TODAY });

		expect(automate(frontmatter, all, TODAY)).toEqual({ changed: true, next: null });
		expect(frontmatter['Дата выполнения']).toBeNull();
		expect(frontmatter['Повтор']).toBeNull();
	});

	it('без перехода ничего не меняется: и уже выполненная, и уже открытая', () => {
		expect(automate(taskProps({ checked: true, doneDate: TODAY }), all, TODAY).changed).toBe(false);
		expect(automate(taskProps({ checked: false }), notAll, TODAY).changed).toBe(false);
		// Отметили всё, а дата выполнения уже стоит (пришла с другого устройства).
		expect(automate(taskProps({ checked: true, doneDate: TODAY }), notAll, TODAY).changed).toBe(false);
	});

	it('дата переноса у повторной: повтор очищается, задача переезжает на день переноса, следующий файл - от исходного дня', () => {
		const frontmatter = taskProps({
			date: '2026-08-15T08:00:00',
			move: '2026-08-17',
			repeat: 'Каждую неделю Суббота',
		});

		expect(automate(frontmatter, notAll, TODAY).next).toMatchObject({ date: '2026-08-22' });
		expect(frontmatter['Повтор']).toBeNull();
		expect(frontmatter['Дата переноса']).toBe('2026-08-17');
		// Время задачи то же, день - день переноса.
		expect(frontmatter['Дата и время']).toBe('2026-08-17T08:00:00');
	});

	it('перенос на следующий день повтора - следующий файл встаёт на шаг дальше', () => {
		const frontmatter = taskProps({ date: TODAY, move: '2026-08-14', repeat: 'Каждый день' });

		expect(automate(frontmatter, notAll, TODAY).next?.date).toBe('2026-08-15');
	});

	it('дата переноса у обычной задачи - ничего', () => {
		const frontmatter = taskProps({ move: '2026-08-17' });

		expect(automate(frontmatter, notAll, TODAY).changed).toBe(false);
	});

	it('дата переноса, которая уже была, повторно не срабатывает', () => {
		const frontmatter = taskProps({ move: '2026-08-18', repeat: 'Каждый день' });

		expect(automate(frontmatter, { all: false, move: '2026-08-17' }, TODAY).changed).toBe(false);
	});

	it('дыра в подзадачах заделывается той же записью', () => {
		const frontmatter: Frontmatter = { ...taskProps(), 'Подзадача-2': 'Два' };

		expect(automate(frontmatter, notAll, TODAY).changed).toBe(true);
		expect(frontmatter['Подзадача-1']).toBe('Два');
		expect('Подзадача-2' in frontmatter).toBe(false);
	});

	it('состояние задачи - отмечено ли всё и дата переноса', () => {
		expect(stateOf(taskOf({ checked: true, move: '2026-08-20' }))).toEqual({ all: true, move: '2026-08-20' });
	});
});

describe('файл новой задачи', () => {
	it('все свойства шаблона, пустые - пустыми, галочки сняты', () => {
		expect(buildTaskFile({
			text: 'Купить',
			date: '2026-08-13',
			repeat: 'Каждый день',
			subtasks: [{ path: [1], text: 'молоко' }, { path: [2], text: 'хлеб' }],
		}, '08:00:00')).toBe([
			'---',
			'Задача: Купить',
			'Выполнено: false',
			'Дата и время: 2026-08-13T08:00:00',
			'Дата выполнения:',
			'Повтор: Каждый день',
			'Дата переноса:',
			'Подзадача-1: молоко',
			'Подзадача-1-выполнено: false',
			'Подзадача-2: хлеб',
			'Подзадача-2-выполнено: false',
			'---',
			'',
		].join('\n'));
	});

	it('без повтора и подзадач', () => {
		expect(buildTaskFile({ text: 'Дело', date: TODAY, repeat: null, subtasks: [] }, '12:00:00'))
			.toBe('---\nЗадача: Дело\nВыполнено: false\nДата и время: 2026-08-13T12:00:00\nДата выполнения:\nПовтор:\nДата переноса:\n---\n');
	});

	it('вложенные подзадачи пишутся своими номерами и читаются обратно', () => {
		const content = buildTaskFile({
			text: 'Дело',
			date: TODAY,
			repeat: null,
			subtasks: [{ path: [1], text: 'Раз' }, { path: [1, 1], text: 'Раз-раз' }, { path: [2], text: 'Два' }],
		}, '12:00:00');

		expect(content).toContain('Подзадача-1-1: Раз-раз\nПодзадача-1-1-выполнено: false\n');
		expect(readTaskFile('a.md', content)?.subtasks.map((subtask) => subtask.path)).toEqual([[1], [1, 1], [2]]);
	});

	it('пустой текст - пустое «Задача»: шаблон для ручного заполнения задачей не считается', () => {
		const content = buildTaskFile({ text: '', date: null, repeat: null, subtasks: [] }, '12:00:00');

		expect(content).toBe('---\nЗадача:\nВыполнено: false\nДата и время:\nДата выполнения:\nПовтор:\nДата переноса:\n---\n');
		expect(readTaskFile('a.md', content)).toBeNull();
	});

	it('«Дата и время» = день задачи и время создания файла, читается обратно тем же', () => {
		const content = buildTaskFile({ text: 'Дело', date: '2026-08-13', repeat: null, subtasks: [] }, '08:05:09');

		expect(readTaskFile('a.md', content)).toMatchObject({ date: '2026-08-13', dateTime: '2026-08-13T08:05:09' });
	});

	it('текст, который YAML прочитал бы иначе, - в кавычках и читается обратно как был', () => {
		const texts = [
			'[[Заметка]] прочитать',
			'Время: 10:30',
			'true',
			'42',
			'- пункт',
			'#тег',
			'Цитата "в кавычках"',
			' пробел в начале',
		];

		for (const text of texts) {
			const content = buildTaskFile({ text, date: TODAY, repeat: null, subtasks: [{ path: [1], text }] }, '12:00:00');

			expect(parseFrontmatter(content)?.['Задача'], text).toBe(text);
			expect(parseFrontmatter(content)?.['Подзадача-1'], text).toBe(text);
		}
	});

	it('имя файла - время создания', () => {
		expect(taskFileName(momentLib('2026-11-13T13:02:15'))).toBe('20261113_130215');
	});
});

describe('порядок по имени файла (разводит одинаковое «Дата и время»)', () => {
	const sorted = (...paths: string[]) => paths
		.map((path) => taskOf({}, path))
		.sort(compareByCreation)
		.map((task) => task.path);

	it('по дате и времени из имени файла, раньше выше', () => {
		expect(sorted('20260812_230000.md', '20260813_080000.md', '20260812_090000.md'))
			.toEqual(['20260812_090000.md', '20260812_230000.md', '20260813_080000.md']);
	});

	it('файл с суффиксом ниже своего тёзки: создан позже в ту же секунду', () => {
		expect(sorted('20260813_080000_2.md', '20260813_080000.md'))
			.toEqual(['20260813_080000.md', '20260813_080000_2.md']);
	});

	it('файлы с другим именем - ниже всех, между собой по имени', () => {
		expect(sorted('Б дело.md', '20260801_000000.md', 'А дело.md'))
			.toEqual(['20260801_000000.md', 'А дело.md', 'Б дело.md']);
	});

	it('одинаковые имена в разных папках - по пути', () => {
		expect(sorted('Б/20260813_080000.md', 'А/20260813_080000.md'))
			.toEqual(['А/20260813_080000.md', 'Б/20260813_080000.md']);
	});
});

describe('порядок списка', () => {
	const sorted = (...tasks: Task[]) => tasks.sort(compareByDateTime).map((task) => task.path);

	it('по «Дата и время», раньше выше; ни имя файла, ни перенос не влияют', () => {
		expect(sorted(
			taskOf({ date: '2026-08-13T08:00:00' }, '20260801_090000.md'),
			taskOf({ date: '2026-08-13T21:15:00', move: '2026-08-01' }, '20260701_090000.md'),
			taskOf({ date: '2026-08-20T07:00:00' }, '20260601_090000.md'),
			taskOf({ date: '2026-08-12T23:59:59' }, '20260901_090000.md'),
		)).toEqual(['20260901_090000.md', '20260801_090000.md', '20260701_090000.md', '20260601_090000.md']);
	});

	it('без даты - ниже всех', () => {
		expect(sorted(
			taskOf({ date: null }, 'а.md'),
			taskOf({ date: '2020-01-01T00:00:00' }, 'б.md'),
		)).toEqual(['б.md', 'а.md']);
	});

	it('полный список: просроченные первыми, дальше по «Дата и время»; «Дата переноса» не влияет', () => {
		const ordered = [
			taskOf({ date: '2026-08-20T08:00:00', move: '2026-08-10' }, 'будущая.md'),
			taskOf({ date: '2026-08-11T08:00:00' }, 'просрочена.md'),
			taskOf({ date: '2026-08-01T08:00:00', move: '2026-08-15' }, 'просрочена-раньше.md'),
			taskOf({ date: `${TODAY}T09:00:00` }, 'сегодня.md'),
		].sort(compareOverdueFirst(TODAY)).map((task) => task.path);

		expect(ordered).toEqual(['просрочена-раньше.md', 'просрочена.md', 'сегодня.md', 'будущая.md']);
	});

	it('одинаковое «Дата и время» - раньше созданный файл выше', () => {
		expect(sorted(
			taskOf({ date: '2026-08-13T08:00:00' }, '20260805_090000.md'),
			taskOf({ date: '2026-08-13T08:00:00' }, '20260801_090000_2.md'),
			taskOf({ date: '2026-08-13T08:00:00' }, '20260801_090000.md'),
		)).toEqual(['20260801_090000.md', '20260801_090000_2.md', '20260805_090000.md']);
	});
});
