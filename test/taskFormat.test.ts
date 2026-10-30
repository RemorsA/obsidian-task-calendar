import { describe, expect, it } from 'vitest';
import {
	allChecked,
	applyEdits,
	blockDate,
	blockShape,
	blockShow,
	appendTaskBlock,
	buildTaskFile,
	chainKeyOf,
	compareByName,
	compareByNewness,
	isOverdue,
	isValidBlock,
	blockAppendAt,
	yearFileName,
	nextDate,
	nextFreeDate,
	occurrenceBlockLines,
	occurrencesInRange,
	parseBlocks,
	parseRepeat,
	readTasks,
	removeParamEdit,
	repeatBlockLines,
	setParamEdit,
	showDate,
	sortKeyOf,
	splitPath,
	Task,
	taskVaultPath,
	toggleCheckbox,
} from '../src/taskFormat';
import { taskFileText } from './helpers';

/** Разобрать текст и вернуть блок по номеру - в тестах правок так короче. */
const blockOf = (content: string, index = 0) => {
	const lines = content.split('\n');
	const block = parseBlocks(lines).find((item) => item.index === index);
	if (!block) throw new Error(`нет блока ${index}`);

	return { lines, block };
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

	it('дни недели с месяцем и днём не сочетаются', () => {
		expect(parseRepeat('Каждый месяц в Субботу')).toBeNull();
		expect(parseRepeat('Каждый день в Субботу')).toBeNull();
		expect(parseRepeat('Каждую неделю в Марте')).toBeNull();
		expect(parseRepeat('Каждый год в Марте, Субботу')).toBeNull();
	});

	it('незнакомую форму не принимает', () => {
		expect(parseRepeat('Каждый день, кроме выходных')).toBeNull();
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

describe('nextDate - тест-кейсы раздела 11', () => {
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

	it('база - 📅 блока', () => {
		expect(blockDate(blockOf(taskFileText({ date: '2026-08-22' })).block)).toBe('2026-08-22');
	});

	it('мусорная 📅 базой не становится', () => {
		const content = ['', '- [ ] Дело 📅 2026-02-30', ''].join('\n');

		expect(blockDate(blockOf(content).block)).toBeNull();
	});
});

describe('череда повтора в окне', () => {
	const days = (
		repeat: string,
		base: string,
		from: string,
		to: string,
		taken?: ReadonlySet<string>,
		limit?: number
	) => {
		const parsed = parseRepeat(repeat);
		if (!parsed) throw new Error(`не разобрался повтор: ${repeat}`);

		return occurrencesInRange(base, parsed, from, to, taken, limit);
	};

	it('дни недельного повтора по субботам и воскресеньям', () => {
		expect(days('Каждую неделю в Субботу, Воскресенье', '2026-08-22', '2026-07-27', '2026-09-06'))
			.toEqual(['2026-08-23', '2026-08-29', '2026-08-30', '2026-09-05', '2026-09-06']);
	});

	it('база в череду не входит - её день календарь и так знает', () => {
		expect(days('Каждый день', '2026-08-22', '2026-08-22', '2026-08-24'))
			.toEqual(['2026-08-23', '2026-08-24']);
	});

	it('дни до базы не показываются: задачи тогда ещё не было', () => {
		expect(days('Каждую неделю в Субботу', '2026-08-22', '2026-08-01', '2026-08-31'))
			.toEqual(['2026-08-29']);
	});

	it('череда докручивается до окна, а за окном обрывается', () => {
		expect(days('Каждый день', '2026-08-01', '2026-08-20', '2026-08-22'))
			.toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
	});

	it('месячный повтор считается шагами, а не арифметикой: зажатое число не отыгрывается', () => {
		// 31 января -> 28 февраля -> 28 марта, а не 31 марта.
		expect(days('Каждый месяц', '2026-01-31', '2026-02-01', '2026-04-30'))
			.toEqual(['2026-02-28', '2026-03-28', '2026-04-28']);
	});

	it('годовой повтор с месяцами', () => {
		expect(days('Каждый год в Марте, Сентябре', '2026-03-15', '2026-01-01', '2027-12-31'))
			.toEqual(['2026-09-15', '2027-03-15', '2027-09-15']);
	});

	it('окно кончилось до базы - череды нет', () => {
		expect(days('Каждый день', '2026-08-22', '2026-08-01', '2026-08-10')).toEqual([]);
	});

	it('перебор ограничен: до далёкого окна череда не докручивается', () => {
		expect(days('Каждый день', '2026-08-01', '2030-01-01', '2030-01-31', new Set(), 10))
			.toEqual([]);
	});

	it('день со своим блоком череда перескакивает', () => {
		const taken = new Set(['2026-08-29']);

		expect(days('Каждую неделю в Субботу, Воскресенье', '2026-08-22', '2026-07-27', '2026-09-06', taken))
			.toEqual(['2026-08-23', '2026-08-30', '2026-09-05', '2026-09-06']);
	});
});

describe('следующий свободный день череды', () => {
	const repeat = parseRepeat('Каждую неделю в Субботу, Воскресенье');

	it('без занятых дней это просто следующий день череды', () => {
		expect(nextFreeDate('2026-08-22', repeat!)).toBe('2026-08-23');
	});

	it('занятый день перескакивается', () => {
		expect(nextFreeDate('2026-08-23', repeat!, new Set(['2026-08-29'])))
			.toBe('2026-08-30');
	});

	it('перескакивается сколько угодно занятых подряд', () => {
		expect(nextFreeDate('2026-08-22', repeat!, new Set(['2026-08-23', '2026-08-29', '2026-08-30'])))
			.toBe('2026-09-05');
	});

	it('свободного дня не нашлось - генерации не будет', () => {
		const taken = new Set(['2026-08-23', '2026-08-29']);

		expect(nextFreeDate('2026-08-22', repeat!, taken, 2)).toBeNull();
	});
});

describe('разбор блоков', () => {
	it('читает параметры и тело', () => {
		const content = taskFileText({
			date: '2026-08-21',
			repeat: 'Каждый день',
			done: '2026-08-21',
			body: ['- [ ] Купить молоко'],
		});

		const [task] = readTasks('Задачи/note.md', content);

		expect(task).toMatchObject({
			key: '/Задачи/note.md#0',
			blockIndex: 0,
			date: '2026-08-21',
			repeat: 'Каждый день',
			done: '2026-08-21',
			fileName: 'note',
			filePath: '/Задачи/',
			body: '- [ ] Купить молоко',
			checked: false,
		});
	});

	it('порядок параметров при чтении произвольный', () => {
		const content = ['', '- [x] Купить молоко ✅ 2026-08-21 🔁 Каждый день 📅 2026-08-21', '']
			.join('\n');

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-21',
			repeat: 'Каждый день',
			done: '2026-08-21',
			body: '- [x] Купить молоко',
			checked: true,
		});
	});

	it('текст за параметром-датой остаётся текстом задачи', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21 #работа ✅ 2026-08-21 до обеда', '']
			.join('\n');

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-21',
			done: '2026-08-21',
			body: '- [ ] Дело #работа до обеда',
		});
	});

	it('🔁 - весь текст до следующего параметра', () => {
		const content = [
			'',
			'- [ ] Полить фикус 🔁 Каждую неделю в Субботу, Воскресенье 📅 2026-08-22',
			'',
		].join('\n');

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-22',
			repeat: 'Каждую неделю в Субботу, Воскресенье',
			body: '- [ ] Полить фикус',
		});
	});

	it('🔁 кончается перед тегом: тег остаётся текстом задачи', () => {
		const content = ['', '- [ ] Полить фикус 📅 2026-08-22 🔁 Каждый день #дом', ''].join('\n');
		const { lines, block } = blockOf(content);

		expect(readTasks('note.md', content)[0]).toMatchObject({
			repeat: 'Каждый день',
			body: '- [ ] Полить фикус #дом',
		});
		expect(applyEdits(lines, [setParamEdit(lines, block, 'done', '2026-08-22')])[1])
			.toBe('- [ ] Полить фикус 📅 2026-08-22 🔁 Каждый день ✅ 2026-08-22 #дом');
	});

	it('эмодзи, приклеенный к слову, параметром не считается', () => {
		const content = ['', '- [ ] Дело📅 2026-08-21', ''].join('\n');

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('повторный параметр - в счёт идёт первый, второй остаётся текстом', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21 📅 2026-08-22', ''].join('\n');

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-21',
			body: '- [ ] Дело 📅 2026-08-22',
		});
	});

	it('↔️ читается и без селектора U+FE0F', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21 ↔ 2026-08-25', ''].join('\n');

		expect(readTasks('note.md', content)[0].move).toBe('2026-08-25');
	});

	it('↔️ читается и без 🔁 - перенесённый экземпляр повтора не ведёт', () => {
		const content = taskFileText({ date: '2026-08-21', move: '2026-08-25' });

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-21',
			move: '2026-08-25',
			repeat: null,
		});
	});

	it('день показа блока: ↔️, если она есть и разобралась, иначе 📅', () => {
		const moved = blockOf(taskFileText({ date: '2026-08-21', move: '2026-08-25' }));
		const plain = blockOf(taskFileText({ date: '2026-08-21' }));
		const garbage = blockOf(taskFileText({ date: '2026-08-21', move: 'завтра' }));

		expect(blockShow(moved.block)).toBe('2026-08-25');
		expect(blockShow(plain.block)).toBe('2026-08-21');
		// Мусор в ↔️ блок не ломает: показываем по 📅.
		expect(blockShow(garbage.block)).toBe('2026-08-21');
		expect(isValidBlock(garbage.lines, garbage.block)).toBe(true);
	});

	it('эмодзи без значения параметром не считается', () => {
		const content = ['', '- [ ] Дело 📅', ''].join('\n');

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('блоки без пустых строк между ними - разные экземпляры', () => {
		const content = taskFileText(
			{ date: '2026-08-21', repeat: 'Каждый день', body: ['- [ ] Молоко'] },
			{ date: '2026-08-20', done: '2026-08-21', body: ['- [x] Молоко'] },
		);

		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(2);
		expect(tasks[0]).toMatchObject({ blockIndex: 0, date: '2026-08-21', done: null });
		expect(tasks[1]).toMatchObject({ blockIndex: 1, date: '2026-08-20', done: '2026-08-21' });
		expect(tasks[1].checked).toBe(true);
	});

	it('пустые строки границей блока не являются', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21', '', '\t- [ ] Подпункт', ''].join('\n');
		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].body).toBe('- [ ] Дело\n\t- [ ] Подпункт');
	});

	it('строки задач подряд - каждая свой блок', () => {
		const content = ['', '- [ ] Черновик 🔁 Каждый день', '- [ ] Дело 📅 2026-08-22', ''].join('\n');

		// У первого блока нет 📅 - он невалиден и в карту не попадает.
		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({ blockIndex: 1, date: '2026-08-22' });
	});

	it('пункт без галочки задачей не бывает - старый формат не подхватывается', () => {
		const content = [
			'',
			'- 📅 2026-08-21',
			'- 🔁 Каждый день',
			'\t- [ ] Купить молоко',
			'- 📅 2026-08-22',
			'\t- [ ] Полить фикус',
			'- Просто пункт 📅 2026-08-23',
			'',
		].join('\n');

		expect(parseBlocks(content.split('\n'))).toHaveLength(0);
	});

	it('эмодзи даты со словом, а не датой, - текст задачи, а не параметр', () => {
		const content = ['', '- [ ] ✅ Проверить отчёт 📅 2026-08-21', ''].join('\n');
		const { lines, block } = blockOf(content);

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-21',
			done: null,
			body: '- [ ] ✅ Проверить отчёт',
		});
		// Выполнение дописывает свою ✅, текст задачи не трогает.
		expect(applyEdits(lines, [setParamEdit(lines, block, 'done', '2026-08-22')])[1])
			.toBe('- [ ] ✅ Проверить отчёт 📅 2026-08-21 ✅ 2026-08-22');
	});

	it('пункт с отступом - подзадача, даже с эмодзи', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21', '\t- [ ] Подпункт 📅 2026-08-25', '']
			.join('\n');
		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({
			date: '2026-08-21',
			body: '- [ ] Дело\n\t- [ ] Подпункт 📅 2026-08-25',
		});
	});

	it('строка задачи с отступом задачей не считается', () => {
		const content = ['', '- Проект', '\t- [ ] Дело 📅 2026-08-21', ''].join('\n');

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('не пункт списка задачей не бывает: в абзаце эмодзи ничего не значат', () => {
		const content = ['', 'Встреча 📅 2026-08-21', ''].join('\n');

		expect(parseBlocks(content.split('\n'))).toHaveLength(0);
	});

	it('блок без чекбоксов не показывается', () => {
		const content = taskFileText({ body: ['- Просто пункт'] });

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('блок без 📅 не показывается', () => {
		const content = ['', '- [ ] Дело 🔁 Каждый день', ''].join('\n');

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('нераспознанный повтор делает блок невалидным', () => {
		const content = taskFileText({ repeat: 'Каждый месяц в Субботу' });

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('имя файла на разбор не влияет', () => {
		const content = taskFileText({ date: '2026-08-21' });

		expect(readTasks('Заметки/Просто заметка.md', content)).toHaveLength(1);
	});

	it('в тело идут только списки, всё остальное выбрасывается', () => {
		const content = [
			'',
			'- [ ] Дело 📅 2026-08-21',
			'\t# Заголовок',
			'\tАбзац',
			'\t> Цитата',
			'\t- [ ] Подпункт',
			'\t\t- [ ] Подподпункт',
			'\t1. Нумерованный',
			'',
		].join('\n');

		expect(readTasks('note.md', content)[0].body).toBe(
			'- [ ] Дело\n\t- [ ] Подпункт\n\t\t- [ ] Подподпункт\n\t1. Нумерованный'
		);
	});

	it('строки внутри блока кода списками не считаются', () => {
		const content = [
			'',
			'- [x] Дело 📅 2026-08-21',
			'\t```',
			'\t- [ ] Не чекбокс',
			'\t```',
			'\t- [x] Второе',
			'',
		].join('\n');

		const [task] = readTasks('note.md', content);

		expect(task.body).toBe('- [x] Дело\n\t- [x] Второе');
		expect(task.checked).toBe(true);
	});

	it('строки задачи внутри блока кода задачами не считаются', () => {
		const content = [
			'',
			'- [x] Настоящая 📅 2026-10-29 ✅ 2026-10-30',
			'\t- [x] Подзадача',
			'',
			'```',
			'- [ ] Task 📅 2026-10-28',
			'- [ ] Task 2 📅 2026-10-29 🔁 Каждый день',
			'- [x] Task 3 📅 2026-10-28 ↔️ 2026-10-29 ✅ 2026-10-29',
			'\t- [x] dwadwadaw',
			'```',
			'',
			'^6a0de6',
			'',
			'- [x] После кода 📅 2026-10-28 ✅ 2026-10-28',
			'',
		].join('\n');

		const tasks = readTasks('note.md', content);

		expect(tasks.map((task) => task.sortKey)).toEqual(['Настоящая', 'После кода']);
		// Блок кода нулевого уровня закрывает задачу над ним: его строки не её тело.
		expect(tasks[0].body).toBe('- [x] Настоящая\n\t- [x] Подзадача');
	});

	it('блок кода с тильдами - то же самое', () => {
		const content = ['', '~~~', '- [ ] Пример 📅 2026-10-28', '~~~', ''].join('\n');

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('незакрытый блок кода - до конца файла код, задач в нём нет', () => {
		const content = [
			'',
			'- [ ] До кода 📅 2026-10-28',
			'```',
			'- [ ] В коде 📅 2026-10-29',
			'',
		].join('\n');

		expect(readTasks('note.md', content).map((task) => task.sortKey)).toEqual(['До кода']);
	});

	it('новая задача не дописывается внутрь блока кода в конце файла', () => {
		const content = [
			'',
			'- [ ] Настоящая 📅 2026-10-28',
			'```',
			'- [ ] Пример 📅 2026-10-28',
			'```',
			'',
		].join('\n');

		const next = appendTaskBlock(content, '2026-10-30', 'Новая');

		expect(next).toBe([
			'',
			'- [ ] Настоящая 📅 2026-10-28',
			'- [ ] Новая 📅 2026-10-30',
			'```',
			'- [ ] Пример 📅 2026-10-28',
			'```',
			'',
		].join('\n'));
	});

	it('отступы читаются табами, двумя и четырьмя пробелами', () => {
		const content = [
			'',
			'- [ ] Дело 📅 2026-08-21',
			'    - [ ] Подпункт',
			'        - [ ] Подподпункт',
			'',
		].join('\n');

		expect(readTasks('note.md', content)[0].body)
			.toBe('- [ ] Дело\n\t- [ ] Подпункт\n\t\t- [ ] Подподпункт');
	});

	it('строка нулевого уровня без эмодзи в тело не идёт и блок закрывает', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21', 'Просто текст', '\t- [ ] Чужое', '']
			.join('\n');

		expect(readTasks('note.md', content)[0].body).toBe('- [ ] Дело');
	});

	it('пустая строка блок не закрывает', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21', '\t- [ ] Раз', '', '\t- [ ] Два', '']
			.join('\n');

		expect(readTasks('note.md', content)[0].body).toBe('- [ ] Дело\n\t- [ ] Раз\n\t- [ ] Два');
	});

	it('заголовок и чужой пункт списка закрывают блок: их подпункты в тело не идут', () => {
		const content = [
			'# Тромбофилия',
			'',
			'- [ ] Записаться на сдачу 📅 2026-10-19',
			'',
			'# Кожа',
			'',
			'- [ ] Сходить к дерматологу',
			'\t- [ ] Псориаз',
			'\t- [ ] Акне',
			'',
		].join('\n');

		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].body).toBe('- [ ] Записаться на сдачу');
	});

	it('checked - все чекбоксы блока, любой знак кроме x считается снятым', () => {
		const checked = taskFileText({ body: ['- [x] Раз', '\t- [X] Два'] });
		const partial = taskFileText({ body: ['- [x] Раз', '\t- [/] Два'] });

		expect(readTasks('note.md', checked)[0].checked).toBe(true);
		expect(readTasks('note.md', partial)[0].checked).toBe(false);
	});

	it('мусор вместо даты датой не считается', () => {
		const content = ['', '- [ ] Дело 📅 21.08.2026', ''].join('\n');

		expect(readTasks('note.md', content)).toHaveLength(0);
	});
});

describe('пути', () => {
	it('файл в корне хранилища', () => {
		expect(splitPath('note.md')).toEqual({ filePath: '/', fileName: 'note' });
	});

	it('файл во вложенной папке', () => {
		expect(splitPath('a/b/note.md')).toEqual({ filePath: '/a/b/', fileName: 'note' });
	});

	it('путь задачи собирается обратно', () => {
		const [task] = readTasks('a/b/note.md', taskFileText());

		expect(taskVaultPath(task)).toBe('a/b/note.md');
	});
});

describe('sortKeyOf', () => {
	it('снимает маркер списка и чекбокс', () => {
		expect(sortKeyOf('- [ ] Купить молоко')).toBe('Купить молоко');
		expect(sortKeyOf('1. Купить молоко')).toBe('Купить молоко');
	});

	it('разворачивает ссылки в текст', () => {
		expect(sortKeyOf('- [ ] [[Заметка|Текст]]')).toBe('Текст');
		expect(sortKeyOf('- [ ] [[Заметка]]')).toBe('Заметка');
		expect(sortKeyOf('- [ ] [текст](https://example.com)')).toBe('текст');
		expect(sortKeyOf('- [ ] https://example.com')).toBe('https://example.com');
	});

	it('снимает инлайн-разметку и решётку тега', () => {
		expect(sortKeyOf('- [ ] **Жирный** текст')).toBe('Жирный текст');
		expect(sortKeyOf('- [ ] ==Выделенный==')).toBe('Выделенный');
		expect(sortKeyOf('- [ ] #дом уборка')).toBe('дом уборка');
	});

	it('снимает ведущие эмодзи', () => {
		expect(sortKeyOf('- [ ] 📞 Позвонить Тане')).toBe('Позвонить Тане');
		expect(sortKeyOf('- [ ] 🧺Постирать вещи')).toBe('Постирать вещи');
	});

	it('снимает ведущие небуквенные символы', () => {
		expect(sortKeyOf('- [ ] -- Дело')).toBe('Дело');
	});

	it('пусто после нормализации - берёт текст после снятия маркера', () => {
		expect(sortKeyOf('- [ ] ???')).toBe('???');
	});

	it('пустое тело - пустой ключ', () => {
		expect(sortKeyOf(null)).toBe('');
		expect(sortKeyOf('')).toBe('');
	});
});

describe('ключ цепочки', () => {
	it('первый пункт тела без маркера и галочки', () => {
		expect(chainKeyOf('- [ ] Полить фикус\n\t- [ ] Подзадача')).toBe('Полить фикус');
		expect(chainKeyOf('- [x] Полить фикус')).toBe('Полить фикус');
		expect(chainKeyOf('- [-] Полить фикус')).toBe('Полить фикус');
		expect(chainKeyOf('1. [ ] Полить фикус')).toBe('Полить фикус');
		expect(chainKeyOf('* Полить   фикус ')).toBe('Полить фикус');
	});

	it('разметка и эмодзи остаются - это не ключ сортировки', () => {
		expect(chainKeyOf('- [ ] 📞 [[Таня]]')).toBe('📞 [[Таня]]');
	});

	it('пустое тело - пустой ключ', () => {
		expect(chainKeyOf(null)).toBe('');
		expect(chainKeyOf('')).toBe('');
	});

	it('у задачи ключ считается при разборе, копии тела дают тот же ключ', () => {
		const content = taskFileText(
			{ date: '2026-08-14', repeat: 'Каждый день', body: ['- [ ] Дело', '\t- [ ] Шаг'] },
			{ date: '2026-08-13', done: '2026-08-13', body: ['- [x] Дело', '\t- [x] Шаг'] },
			{ date: '2026-08-13', body: ['- [ ] Другое'] },
		);

		expect(readTasks('note.md', content).map((task) => task.chain))
			.toEqual(['Дело', 'Дело', 'Другое']);
	});
});

describe('файл задач', () => {
	it('имя - год даты задачи', () => {
		expect(yearFileName('2026-08-20')).toBe('2026');
		expect(yearFileName('2027-01-01')).toBe('2027');
	});

	it('задача дописывается под всеми задачами, лежащие блоки не двигаются', () => {
		const content = taskFileText(
			{ date: '2026-08-14', repeat: 'Каждый день', body: ['- [ ] Раз'] },
			{ date: '2026-08-13', done: '2026-08-13', body: ['- [x] Раз'] },
		);

		expect(appendTaskBlock(content, '2026-08-20', 'Два')).toBe([
			'',
			'- [ ] Раз 📅 2026-08-14 🔁 Каждый день',
			'- [x] Раз 📅 2026-08-13 ✅ 2026-08-13',
			'- [ ] Два 📅 2026-08-20',
			'',
		].join('\n'));
	});

	it('новая задача - последний блок файла', () => {
		const content = appendTaskBlock(taskFileText({ body: ['- [ ] Раз'] }), '2026-08-20', 'Два');
		const tasks = readTasks('2026-08.md', content);

		expect(tasks.map((task) => [task.blockIndex, task.body])).toEqual([
			[0, '- [ ] Раз'],
			[1, '- [ ] Два'],
		]);
	});

	it('текст после последней задачи остаётся ниже новой', () => {
		const content = ['', '- [ ] Раз 📅 2026-08-13', '\t- [ ] Шаг', 'Заметка внизу', ''].join('\n');

		expect(appendTaskBlock(content, '2026-08-20', 'Два')).toBe(
			['', '- [ ] Раз 📅 2026-08-13', '\t- [ ] Шаг', '- [ ] Два 📅 2026-08-20', 'Заметка внизу', '']
				.join('\n')
		);
	});

	it('пустой файл получает тот же текст, что новый', () => {
		expect(appendTaskBlock('', '2026-08-20', 'Дело')).toBe(buildTaskFile('2026-08-20', 'Дело'));
		expect(appendTaskBlock('\n\n', '2026-08-20', 'Дело')).toBe(buildTaskFile('2026-08-20', 'Дело'));
	});

	it('в файл без задач блок дописывается в конец, через пустую строку', () => {
		expect(appendTaskBlock('# Август\nПросто текст\n\n', '2026-08-20', 'Дело')).toBe(
			'# Август\nПросто текст\n\n- [ ] Дело 📅 2026-08-20\n\n'
		);
	});
});

describe('новый файл задачи', () => {
	it('пустая строка в начале и в конце, одна строка: снятый чекбокс и 📅', () => {
		expect(buildTaskFile('2026-08-20', 'Купить молоко')).toBe(
			'\n- [ ] Купить молоко 📅 2026-08-20\n'
		);
	});
});

describe('правки блока', () => {
	it('переключает чекбокс по номеру и не трогает остальное', () => {
		const content = taskFileText({ body: ['- [ ] Раз', '\t- [ ] Два'] });
		const next = toggleCheckbox(content, 0, 1);

		expect(next).toContain('- [ ] Раз');
		expect(next).toContain('- [x] Два');
	});

	it('чекбокс строки задачи - первый, параметры при отметке не меняются', () => {
		const content = taskFileText({ date: '2026-08-21', repeat: 'Каждый день' });

		expect(toggleCheckbox(content, 0, 0))
			.toBe(['', '- [x] Задача 📅 2026-08-21 🔁 Каждый день', ''].join('\n'));
	});

	it('снимает уже отмеченный чекбокс', () => {
		const content = taskFileText({ body: ['- [x] Раз'] });

		expect(toggleCheckbox(content, 0, 0)).toContain('- [ ] Раз');
	});

	it('нумерация чекбоксов считается внутри своего блока', () => {
		const content = taskFileText(
			{ date: '2026-08-21', body: ['- [ ] Первый'] },
			{ date: '2026-08-20', body: ['- [ ] Второй'] },
		);

		const next = toggleCheckbox(content, 1, 0) ?? '';

		expect(next).toContain('- [ ] Первый');
		expect(next).toContain('- [x] Второй');
	});

	it('чекбокса с таким номером нет - править нечего', () => {
		expect(toggleCheckbox(taskFileText(), 0, 5)).toBeNull();
		expect(toggleCheckbox(taskFileText(), 7, 0)).toBeNull();
	});

	it('allChecked считает только чекбоксы блока', () => {
		const { lines, block } = blockOf(taskFileText({
			body: ['- [x] Раз', '\t- [ ] Два'],
		}, {
			body: ['- [x] Чужая'],
		}));

		expect(allChecked(lines, block)).toBe(false);
	});

	it('ставит параметр в канонический порядок', () => {
		const content = taskFileText({ date: '2026-08-21', repeat: 'Каждый день' });
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(lines, block, 'done', '2026-08-22')]).join('\n');

		expect(next).toBe(['', '- [ ] Задача 📅 2026-08-21 🔁 Каждый день ✅ 2026-08-22', '']
			.join('\n'));
	});

	it('новый параметр встаёт за последним, текст за ним остаётся на месте', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21 #работа', ''].join('\n');
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(lines, block, 'done', '2026-08-22')]).join('\n');

		expect(next).toBe(['', '- [ ] Дело 📅 2026-08-21 ✅ 2026-08-22 #работа', ''].join('\n'));
	});

	it('существующий параметр заменяется на месте, а не дублируется', () => {
		const content = ['', '- [ ] Дело ✅ 2026-08-25 📅 2026-08-21 #работа', ''].join('\n');
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(lines, block, 'date', '2026-08-30')]).join('\n');

		expect(next).toBe(['', '- [ ] Дело ✅ 2026-08-25 📅 2026-08-30 #работа', ''].join('\n'));
	});

	it('↔️ без селектора при записи получает селектор', () => {
		const content = ['', '- [ ] Дело 📅 2026-08-21 ↔ 2026-08-25', ''].join('\n');
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(lines, block, 'move', '2026-08-27')]).join('\n');

		expect(next).toBe(['', '- [ ] Дело 📅 2026-08-21 ↔️ 2026-08-27', ''].join('\n'));
	});

	it('убирает параметр вместе с пробелом, а если его нет - ничего не делает', () => {
		const content = taskFileText({ date: '2026-08-21', repeat: 'Каждый день', done: '2026-08-21' });
		const { lines, block } = blockOf(content);
		const remove = removeParamEdit(lines, block, 'repeat');

		expect(remove).not.toBeNull();
		expect(applyEdits(lines, [remove!]).join('\n'))
			.toBe(['', '- [ ] Задача 📅 2026-08-21 ✅ 2026-08-21', ''].join('\n'));
		expect(removeParamEdit(lines, block, 'move')).toBeNull();
	});

	it('новый блок повтора: та же 🔁, то же тело со снятыми чекбоксами', () => {
		const content = taskFileText({
			date: '2026-08-20',
			repeat: 'Каждый день',
			done: '2026-08-21',
			body: ['- [x] Дело', '\t- [x] Подпункт'],
		});
		const { lines, block } = blockOf(content);

		expect(repeatBlockLines(lines, block, '2026-08-21')).toEqual([
			'- [ ] Дело 📅 2026-08-21 🔁 Каждый день',
			'\t- [ ] Подпункт',
		]);
	});

	it('копия блока: свои параметры уходят, текст между ними остаётся, отступы - табами', () => {
		const content = [
			'',
			'- [x] Дело 📅 2026-08-20 #работа 🔁 Каждый день ✅ 2026-08-20',
			'    - [x] Подпункт',
			'',
		].join('\n');
		const { lines, block } = blockOf(content);

		expect(repeatBlockLines(lines, block, '2026-08-21')).toEqual([
			'- [ ] Дело #работа 📅 2026-08-21 🔁 Каждый день',
			'\t- [ ] Подпункт',
		]);
	});

	it('блок отдельного дня череды: чистое тело и без 🔁', () => {
		const { lines, block } = blockOf(taskFileText({
			date: '2026-08-22',
			repeat: 'Каждый день',
			body: ['- [x] Дело', '\t- [x] Подпункт'],
		}));

		expect(occurrenceBlockLines(lines, block, '2026-08-29')).toEqual([
			'- [ ] Дело 📅 2026-08-29',
			'\t- [ ] Подпункт',
		]);
	});

	it('блок перенесённого экземпляра: 📅 новой даты, без ↔️ и 🔁', () => {
		const { lines, block } = blockOf(taskFileText({
			date: '2026-08-22',
			repeat: 'Каждый день',
			body: ['- [x] Дело', '\t- [ ] Подпункт'],
		}));

		// Уехал сам блок - отметки едут с ним: это тот же экземпляр.
		expect(occurrenceBlockLines(lines, block, '2026-08-25', true)).toEqual([
			'- [x] Дело 📅 2026-08-25',
			'\t- [ ] Подпункт',
		]);

		// Уехал расчётный день череды - тело чистое, отмечать там было нечего.
		expect(occurrenceBlockLines(lines, block, '2026-08-25')).toEqual([
			'- [ ] Дело 📅 2026-08-25',
			'\t- [ ] Подпункт',
		]);
	});

	it('↔️ встаёт сразу после 📅', () => {
		const { lines, block } = blockOf(taskFileText({
			date: '2026-08-21',
			repeat: 'Каждый день',
		}));
		const next = applyEdits(lines, [setParamEdit(lines, block, 'move', '2026-08-30')]).join('\n');

		expect(next.split('\n')[1]).toBe('- [ ] Задача 📅 2026-08-21 ↔️ 2026-08-30 🔁 Каждый день');
	});

	it('выполненный блок дописывается за последним, а не в конец файла', () => {
		const content = taskFileText(
			{ date: '2026-08-22', repeat: 'Каждый день' },
			{ date: '2026-08-20', done: '2026-08-20', body: ['- [x] Дело'] },
		);
		const lines = content.split('\n');
		const blocks = parseBlocks(lines);

		// Сразу за последней строкой последнего блока: дальше пустая строка, которой
		// файл заканчивается, и лезть за неё нельзя.
		expect(blockAppendAt(blocks)).toBe(blocks[1].end + 1);
		expect(blockAppendAt(blocks)).toBeLessThan(lines.length);
	});

	it('отпечаток блока не зависит от тела: ни от галочек, ни от текста', () => {
		const open = blockOf(taskFileText({ body: ['- [ ] Дело'] }));
		const done = blockOf(taskFileText({ body: ['- [x] Дело'] }));
		const extra = blockOf(taskFileText({ body: ['- [x] Дело', '\t- [ ] Ещё'] }));

		expect(blockShape(open.block)).toBe(blockShape(done.block));
		expect(blockShape(open.block)).toBe(blockShape(extra.block));
	});

	it('отпечаток блока не зависит от ↔️: перенос это тот же блок', () => {
		const here = blockOf(taskFileText({ date: '2026-08-13' }));
		const moved = blockOf(taskFileText({ date: '2026-08-13', move: '2026-08-20' }));
		const again = blockOf(taskFileText({ date: '2026-08-13', move: '2026-08-25' }));

		expect(blockShape(here.block)).toBe(blockShape(moved.block));
		expect(blockShape(moved.block)).toBe(blockShape(again.block));
	});

	it('отпечаток блока меняется вместе с параметрами', () => {
		const one = blockOf(taskFileText({ date: '2026-08-13' }));
		const other = blockOf(taskFileText({ date: '2026-08-14' }));
		const marked = blockOf(taskFileText({ date: '2026-08-13', done: '2026-08-13' }));

		expect(blockShape(one.block)).not.toBe(blockShape(other.block));
		expect(blockShape(one.block)).not.toBe(blockShape(marked.block));
	});

	it('валидность блока: 📅, разобранный повтор', () => {
		const good = blockOf(taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }));
		const badDate = blockOf(taskFileText({ date: '2026-02-30' }));
		const badRepeat = blockOf(taskFileText({ repeat: 'Каждый месяц в Субботу' }));
		const noDate = blockOf(['', '- [ ] Дело 🔁 Каждый день', ''].join('\n'));

		expect(isValidBlock(good.lines, good.block)).toBe(true);
		expect(isValidBlock(badDate.lines, badDate.block)).toBe(false);
		expect(isValidBlock(badRepeat.lines, badRepeat.block)).toBe(false);
		expect(isValidBlock(noDate.lines, noDate.block)).toBe(false);
	});
});

describe('сортировка и группы', () => {
	const task = (over: Partial<Task>): Task => ({
		key: over.key ?? 'k',
		blockIndex: 0,
		date: '2026-08-13',
		move: null,
		repeat: null,
		done: null,
		fileName: 'note',
		filePath: '/',
		body: '- [ ] Дело',
		checked: false,
		sortKey: 'Дело',
		chain: 'Дело',
		...over,
	});

	it('по наименованию, числа по значению', () => {
		const list = [task({ sortKey: 'Дело 10' }), task({ sortKey: 'Дело 2' })];

		expect(list.sort(compareByName).map((item) => item.sortKey)).toEqual(['Дело 2', 'Дело 10']);
	});

	it('регистр и знаки препинания не влияют', () => {
		const list = [task({ sortKey: 'бета' }), task({ sortKey: '«Альфа»' })];

		expect(list.sort(compareByName).map((item) => item.sortKey)).toEqual(['«Альфа»', 'бета']);
	});

	it('пустой ключ уходит в конец группы', () => {
		const list = [task({ sortKey: '' }), task({ sortKey: 'Яблоко' })];

		expect(list.sort(compareByName).map((item) => item.sortKey)).toEqual(['Яблоко', '']);
	});

	it('при равных наименованиях сравниваются дата, имя файла и номер блока', () => {
		const early = task({ date: '2026-08-10' });
		const late = task({ date: '2026-08-20' });
		const other = task({ date: '2026-08-10', fileName: 'a' });
		const second = task({ date: '2026-08-10', fileName: 'a', blockIndex: 3 });

		expect([late, early].sort(compareByName)[0]).toBe(early);
		expect([early, other].sort(compareByName)[0]).toBe(other);
		expect([second, other].sort(compareByName)[0]).toBe(other);
	});

	it('по новизне: в одном файле ниже - новее, дата и наименование не влияют', () => {
		const first = task({ key: 'first', blockIndex: 0, date: '2026-08-20', sortKey: 'Абрикос' });
		const second = task({ key: 'second', blockIndex: 1, date: '2026-08-01', sortKey: 'Яблоко' });

		expect([first, second].sort(compareByNewness).map((item) => item.key))
			.toEqual(['second', 'first']);
	});

	it('по новизне между файлами - по имени файла: поздний месяц выше', () => {
		const august = task({ key: 'august', fileName: '2026-08', blockIndex: 5 });
		const september = task({ key: 'september', fileName: '2026-09', blockIndex: 0 });
		const january = task({ key: 'january', fileName: '2027-01', blockIndex: 0 });

		expect([august, january, september].sort(compareByNewness).map((item) => item.key))
			.toEqual(['january', 'september', 'august']);
	});

	it('по новизне годовой файл новее месячных своего года, но старше следующего года', () => {
		const list = [
			task({ key: '2026-08', fileName: '2026-08' }),
			task({ key: '2027', fileName: '2027' }),
			task({ key: '2026-12', fileName: '2026-12' }),
			task({ key: '2026', fileName: '2026' }),
			task({ key: '2027-01', fileName: '2027-01' }),
		];

		expect(list.sort(compareByNewness).map((item) => item.key))
			.toEqual(['2027', '2027-01', '2026', '2026-12', '2026-08']);
	});

	it('по новизне: одноимённые файлы разных папок не смешиваются', () => {
		const a = task({ key: 'a0', filePath: '/А/', fileName: '2026-08', blockIndex: 0 });
		const a1 = task({ key: 'a1', filePath: '/А/', fileName: '2026-08', blockIndex: 1 });
		const b = task({ key: 'b0', filePath: '/Б/', fileName: '2026-08', blockIndex: 0 });

		expect([a, b, a1].sort(compareByNewness).map((item) => item.key))
			.toEqual(['b0', 'a1', 'a0']);
	});

	it('просрочена: 📅 в прошлом и ✅ нет', () => {
		expect(isOverdue(task({ date: '2026-08-12' }), '2026-08-13')).toBe(true);
		expect(isOverdue(task({ date: '2026-08-13' }), '2026-08-13')).toBe(false);
		expect(isOverdue(task({ date: '2026-08-14' }), '2026-08-13')).toBe(false);
		expect(isOverdue(task({ date: '2026-08-12', done: '2026-08-12' }), '2026-08-13')).toBe(false);
	});

	it('просрочка считается по дню показа, а не по 📅', () => {
		// Уехал вперёд - долгом быть перестал, уехал назад - стал.
		expect(isOverdue(task({ date: '2026-08-12', move: '2026-08-20' }), '2026-08-13')).toBe(false);
		expect(isOverdue(task({ date: '2026-08-20', move: '2026-08-12' }), '2026-08-13')).toBe(true);
	});
});
