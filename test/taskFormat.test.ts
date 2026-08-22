import { describe, expect, it } from 'vitest';
import {
	allChecked,
	applyEdits,
	blockBase,
	blockShape,
	buildTaskFile,
	compareByDate,
	compareByName,
	isOverdue,
	isValidBlock,
	blockAppendAt,
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
	taskFileName,
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

	it('база - дата показа блока: ↔️, если она есть, иначе 📅', () => {
		const moved = blockOf(taskFileText({ date: '2026-08-22', move: '2026-08-30' }));
		const plain = blockOf(taskFileText({ date: '2026-08-22' }));

		expect(blockBase(moved.block)).toBe('2026-08-30');
		expect(blockBase(plain.block)).toBe('2026-08-22');
	});

	it('мусорная ↔️ базой не становится', () => {
		const content = ['', '- 📅 2026-08-22', '- ↔️ завтра', '\t- [ ] Дело', ''].join('\n');

		expect(blockBase(blockOf(content).block)).toBe('2026-08-22');
	});
});

describe('череда повтора в окне', () => {
	const days = (repeat: string, base: string, from: string, to: string, limit?: number) => {
		const parsed = parseRepeat(repeat);
		if (!parsed) throw new Error(`не разобрался повтор: ${repeat}`);

		return occurrencesInRange(base, parsed, from, to, limit);
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
			move: '2026-08-25',
			repeat: 'Каждый день',
			done: '2026-08-21',
			body: ['- [ ] Купить молоко'],
		});

		const [task] = readTasks('Задачи/note.md', content);

		expect(task).toMatchObject({
			key: '/Задачи/note.md#0',
			blockIndex: 0,
			date: '2026-08-21',
			move: '2026-08-25',
			repeat: 'Каждый день',
			done: '2026-08-21',
			fileName: 'note',
			filePath: '/Задачи/',
			body: '- [ ] Купить молоко',
			checked: false,
		});
	});

	it('порядок строк параметров при чтении произвольный', () => {
		const content = [
			'',
			'- ✅ 2026-08-21',
			'- 🔁 Каждый день',
			'- 📅 2026-08-21',
			'\t- [x] Купить молоко',
			'',
		].join('\n');

		expect(readTasks('note.md', content)[0]).toMatchObject({
			date: '2026-08-21',
			repeat: 'Каждый день',
			done: '2026-08-21',
			checked: true,
		});
	});

	it('↔️ читается и без селектора U+FE0F', () => {
		const content = ['', '- 📅 2026-08-21', '- ↔ 2026-08-25', '\t- [ ] Дело', ''].join('\n');

		expect(readTasks('note.md', content)[0].move).toBe('2026-08-25');
	});

	it('↔️ учитывается и без 🔁', () => {
		const content = taskFileText({ date: '2026-08-21', move: '2026-08-25' });

		expect(readTasks('note.md', content)[0]).toMatchObject({
			move: '2026-08-25',
			repeat: null,
		});
	});

	it('эмодзи без значения параметром не считается', () => {
		const content = ['', '- 📅', '\t- [ ] Дело', ''].join('\n');

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
		const content = ['', '- 📅 2026-08-21', '', '- 🔁 Каждый день', '', '\t- [ ] Дело', ''].join('\n');
		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].repeat).toBe('Каждый день');
	});

	it('повторный параметр открывает новый блок', () => {
		const content = ['', '- 📅 2026-08-21', '- 📅 2026-08-22', '\t- [ ] Дело', ''].join('\n');

		// У первого блока тела нет - он невалиден и в карту не попадает.
		const tasks = readTasks('note.md', content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({ blockIndex: 1, date: '2026-08-22' });
	});

	it('блок без чекбоксов не показывается', () => {
		const content = taskFileText({ body: ['- Просто пункт'] });

		expect(readTasks('note.md', content)).toHaveLength(0);
	});

	it('блок без 📅 не показывается', () => {
		const content = ['', '- 🔁 Каждый день', '\t- [ ] Дело', ''].join('\n');

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
			'- 📅 2026-08-21',
			'\t# Заголовок',
			'\tАбзац',
			'\t> Цитата',
			'\t- [ ] Дело',
			'\t\t- [ ] Подпункт',
			'\t1. Нумерованный',
			'',
		].join('\n');

		expect(readTasks('note.md', content)[0].body).toBe(
			'- [ ] Дело\n\t- [ ] Подпункт\n1. Нумерованный'
		);
	});

	it('строки внутри блока кода списками не считаются', () => {
		const content = [
			'',
			'- 📅 2026-08-21',
			'\t- [ ] Дело',
			'\t```',
			'\t- [ ] Не чекбокс',
			'\t```',
			'\t- [ ] Второе',
			'',
		].join('\n');

		const [task] = readTasks('note.md', content);

		expect(task.body).toBe('- [ ] Дело\n- [ ] Второе');
		expect(task.checked).toBe(false);
	});

	it('отступы читаются табами, двумя и четырьмя пробелами', () => {
		const content = [
			'',
			'- 📅 2026-08-21',
			'    - [ ] Дело',
			'        - [ ] Подпункт',
			'',
		].join('\n');

		expect(readTasks('note.md', content)[0].body).toBe('- [ ] Дело\n\t- [ ] Подпункт');
	});

	it('строка нулевого уровня без эмодзи в тело не идёт', () => {
		const content = ['', '- 📅 2026-08-21', 'Просто текст', '\t- [ ] Дело', ''].join('\n');

		expect(readTasks('note.md', content)[0].body).toBe('- [ ] Дело');
	});

	it('checked - все чекбоксы блока, любой знак кроме x считается снятым', () => {
		const checked = taskFileText({ body: ['- [x] Раз', '- [X] Два'] });
		const partial = taskFileText({ body: ['- [x] Раз', '- [/] Два'] });

		expect(readTasks('note.md', checked)[0].checked).toBe(true);
		expect(readTasks('note.md', partial)[0].checked).toBe(false);
	});

	it('мусор вместо даты датой не считается', () => {
		const content = ['', '- 📅 21.08.2026', '\t- [ ] Дело', ''].join('\n');

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

describe('имя файла задачи', () => {
	it('дата и текст первого элемента тела', () => {
		expect(taskFileName('2026-08-20', '- [ ] Купить молоко')).toBe('2026-08-20 - Купить молоко');
	});

	it('запрещённые символы заменяются пробелом, пробелы схлопываются', () => {
		expect(taskFileName('2026-08-20', 'Купить молоко / творог'))
			.toBe('2026-08-20 - Купить молоко творог');
		expect(taskFileName('2026-08-20', 'A#B^C[D]E')).toBe('2026-08-20 - A B C D E');
	});

	it('эмодзи в имени сохраняются - имя файла не ключ сортировки', () => {
		expect(taskFileName('2026-08-20', '📞 Позвонить Тане'))
			.toBe('2026-08-20 - 📞 Позвонить Тане');
	});

	it('ломающие ссылки скобки уходят вместе с запрещёнными символами', () => {
		expect(taskFileName('2026-08-20', '- [ ] [[Заметка|Текст]]'))
			.toBe('2026-08-20 - Заметка Текст');
	});

	it('текст обрезается до 100 символов по границе слова', () => {
		const text = `${'слово '.repeat(30)}хвост`;
		const name = taskFileName('2026-08-20', text);

		expect(name.length).toBeLessThanOrEqual('2026-08-20 - '.length + 100);
		expect(name.endsWith('слово')).toBe(true);
	});

	it('пустой текст - имя из одной даты', () => {
		expect(taskFileName('2026-08-20', '   ')).toBe('2026-08-20');
		expect(taskFileName('2026-08-20', '///')).toBe('2026-08-20');
	});
});

describe('новый файл задачи', () => {
	it('пустая строка в начале и в конце, 📅 и один снятый чекбокс', () => {
		expect(buildTaskFile('2026-08-20', 'Купить молоко')).toBe(
			'\n- 📅 2026-08-20\n\t- [ ] Купить молоко\n'
		);
	});
});

describe('правки блока', () => {
	it('переключает чекбокс по номеру и не трогает остальное', () => {
		const content = taskFileText({ body: ['- [ ] Раз', '- [ ] Два'] });
		const next = toggleCheckbox(content, 0, 1);

		expect(next).toContain('- [ ] Раз');
		expect(next).toContain('- [x] Два');
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
		const { lines, block } = blockOf(taskFileText({ body: ['- [x] Раз', '- [ ] Два'] }));

		expect(allChecked(lines, block)).toBe(false);
	});

	it('ставит параметр в канонический порядок', () => {
		const content = taskFileText({ date: '2026-08-21', repeat: 'Каждый день' });
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(block, 'done', '2026-08-22')]).join('\n');

		expect(next).toBe([
			'',
			'- 📅 2026-08-21',
			'- 🔁 Каждый день',
			'- ✅ 2026-08-22',
			'\t- [ ] Задача',
			'',
		].join('\n'));
	});

	it('↔️ встаёт сразу после 📅', () => {
		const content = taskFileText({ date: '2026-08-21', repeat: 'Каждый день' });
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(block, 'move', '2026-08-30')]).join('\n');

		expect(next.split('\n').slice(1, 4)).toEqual([
			'- 📅 2026-08-21',
			'- ↔️ 2026-08-30',
			'- 🔁 Каждый день',
		]);
	});

	it('существующий параметр заменяется, а не дублируется', () => {
		const content = taskFileText({ date: '2026-08-21', move: '2026-08-25' });
		const { lines, block } = blockOf(content);
		const next = applyEdits(lines, [setParamEdit(block, 'move', '2026-08-30')]).join('\n');

		expect(next).toContain('- ↔️ 2026-08-30');
		expect(next).not.toContain('2026-08-25');
	});

	it('убирает параметр, а если его нет - ничего не делает', () => {
		const content = taskFileText({ date: '2026-08-21', done: '2026-08-21' });
		const { lines, block } = blockOf(content);
		const remove = removeParamEdit(block, 'done');

		expect(remove).not.toBeNull();
		expect(applyEdits(lines, [remove!]).join('\n')).not.toContain('✅');
		expect(removeParamEdit(block, 'repeat')).toBeNull();
	});

	it('новый блок повтора: та же 🔁, то же тело со снятыми чекбоксами', () => {
		const content = taskFileText({
			date: '2026-08-20',
			move: '2026-08-25',
			repeat: 'Каждый день',
			done: '2026-08-21',
			body: ['- [x] Дело', '\t- [x] Подпункт'],
		});
		const { lines, block } = blockOf(content);

		expect(repeatBlockLines(lines, block, '2026-08-21')).toEqual([
			'- 📅 2026-08-21',
			'- 🔁 Каждый день',
			'\t- [ ] Дело',
			'\t\t- [ ] Подпункт',
		]);
	});

	it('блок отдельного дня череды: чистое тело и без 🔁', () => {
		const { lines, block } = blockOf(taskFileText({
			date: '2026-08-22',
			repeat: 'Каждый день',
			body: ['- [x] Дело', '\t- [x] Подпункт'],
		}));

		expect(occurrenceBlockLines(lines, block, '2026-08-29')).toEqual([
			'- 📅 2026-08-29',
			'\t- [ ] Дело',
			'\t\t- [ ] Подпункт',
		]);
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
		const extra = blockOf(taskFileText({ body: ['- [x] Дело', '- [ ] Ещё'] }));

		expect(blockShape(open.block)).toBe(blockShape(done.block));
		expect(blockShape(open.block)).toBe(blockShape(extra.block));
	});

	it('отпечаток блока меняется вместе с параметрами', () => {
		const one = blockOf(taskFileText({ date: '2026-08-13' }));
		const other = blockOf(taskFileText({ date: '2026-08-14' }));
		const marked = blockOf(taskFileText({ date: '2026-08-13', done: '2026-08-13' }));

		expect(blockShape(one.block)).not.toBe(blockShape(other.block));
		expect(blockShape(one.block)).not.toBe(blockShape(marked.block));
	});

	it('валидность блока: 📅, чекбокс в теле, разобранный повтор', () => {
		const good = blockOf(taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }));
		const noBoxes = blockOf(taskFileText({ date: '2026-08-13', body: ['- Пункт'] }));
		const badRepeat = blockOf(taskFileText({ repeat: 'Каждый месяц в Субботу' }));
		const noDate = blockOf(['', '- 🔁 Каждый день', '\t- [ ] Дело', ''].join('\n'));

		expect(isValidBlock(good.lines, good.block)).toBe(true);
		expect(isValidBlock(noBoxes.lines, noBoxes.block)).toBe(false);
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
		...over,
	});

	it('дата показа - ↔️, если она есть', () => {
		expect(showDate(task({ date: '2026-08-13', move: '2026-08-20' }))).toBe('2026-08-20');
		expect(showDate(task({ date: '2026-08-13' }))).toBe('2026-08-13');
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

	it('при равных наименованиях сравниваются дата показа, имя файла и номер блока', () => {
		const early = task({ date: '2026-08-10' });
		const late = task({ date: '2026-08-20' });
		const other = task({ date: '2026-08-10', fileName: 'a' });
		const second = task({ date: '2026-08-10', fileName: 'a', blockIndex: 3 });

		expect([late, early].sort(compareByName)[0]).toBe(early);
		expect([early, other].sort(compareByName)[0]).toBe(other);
		expect([second, other].sort(compareByName)[0]).toBe(other);
	});

	it('просроченные - сначала по дате показа, старое сверху', () => {
		const old = task({ date: '2026-08-01', sortKey: 'Яблоко' });
		const fresh = task({ date: '2026-08-10', sortKey: 'Абрикос' });

		expect([fresh, old].sort(compareByDate)[0]).toBe(old);
	});

	it('просрочена: дата показа в прошлом и ✅ нет', () => {
		expect(isOverdue(task({ date: '2026-08-12' }), '2026-08-13')).toBe(true);
		expect(isOverdue(task({ date: '2026-08-13' }), '2026-08-13')).toBe(false);
		expect(isOverdue(task({ date: '2026-08-12', done: '2026-08-12' }), '2026-08-13')).toBe(false);
		expect(isOverdue(task({ date: '2026-08-01', move: '2026-08-20' }), '2026-08-13')).toBe(false);
	});
});
