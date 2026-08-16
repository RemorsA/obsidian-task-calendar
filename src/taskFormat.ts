import { moment } from 'obsidian';

/**
 * Формат задачи: отдельная заметка со свойствами.
 *
 * ---
 * Дата: 2026-08-13
 * Выполнено:
 *   - 2026-08-13
 * Повтор: Каждый день
 * Стоп повтор: false
 * ---
 *
 * Текст после свойств - тело задачи. В календаре из него показываются только
 * списки (`extractLists`): всё остальное там не нужно, за ним - в саму заметку.
 *
 * Наименование задачи берётся из **имени файла**: `2026-08-13 - Купить молоко`
 * это задача «Купить молоко». Отдельного свойства под название нет - имя файла
 * и есть заголовок заметки в Obsidian, дублировать его негде.
 *
 * Любое свойство может быть пустым: Дата - строка, Выполнено - список строк,
 * Повтор - строка. Но присутствовать в заметке должны все три, иначе это не
 * задача.
 *
 * «Дата» - день, когда задачу завели, и точка отсчёта повторов. Она
 * **неподвижна**: плагин её не переписывает, вся череда повторов считается от
 * неё. «Выполнено» - журнал закрытий.
 *
 * В календарь попадает только невыполненное: день повтора, которого нет в
 * журнале. Разовую задачу первая же запись в «Выполнено» закрывает совсем.
 *
 * «Стоп повтор» - галочка-пауза, свойство необязательное. Отмечена - задача с
 * календаря уходит целиком, журнал закрытий остаётся нетронутым.
 *
 * Выполнение задачи считается **по чекбоксам тела**: отмечены все - день
 * дописывается в «Выполнено», сняли любой - день из журнала убирается. Кнопок
 * «выполнить» и «отменить» нет, отметка идёт только через чекбоксы.
 *
 * Здесь собрано всё знание о формате. Остальной код ходит только через
 * функции этого модуля и о YAML-свойствах не знает.
 */

export const DATE_FORMAT = 'YYYY-MM-DD';

/** Имена свойств в заметке. */
export const FIELD = {
	date: 'Дата',
	done: 'Выполнено',
	repeat: 'Повтор',
	stop: 'Стоп повтор',
} as const;

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export interface Repeat {
	/** Шаг повтора в единицах unit: «каждые 2 дня» -> 2. */
	interval: number;
	unit: RepeatUnit;
	/**
	 * Дни недели для недельных повторов, по возрастанию:
	 * «каждую неделю в субботу, понедельник» -> [1, 6].
	 * Нумерация как у moment: 0 - воскресенье, 6 - суббота.
	 */
	weekdays?: number[];
}

export interface TaskNote {
	/** Наименование задачи - имя файла без даты в начале. */
	task: string;
	/** Путь до файла в хранилище. */
	link: string;
	/**
	 * Свойство «Дата» - день, когда задачу завели, и точка отсчёта повторов.
	 * Плагин её не меняет: вся череда считается от неё.
	 */
	date: string | null;
	/** Свойство «Выполнено» - дни, в которые задачу закрывали. */
	done: string[];
	/** Разобранное свойство «Повтор», null если пусто или форма незнакома. */
	repeat: Repeat | null;
	/** Свойство «Повтор» как записано в заметке - для отладки и подсказок. */
	repeatRaw: string | null;
	/**
	 * Свойство «Стоп повтор» - пауза. Задача с ней в календаре не показывается
	 * вовсе, но ничего не теряет: сняли галочку - вернулась.
	 */
	stopped: boolean;
}

/** Задача на конкретный день - то, что показывается при клике по дате. */
export interface SelectedTask {
	task: string;
	link: string;
	/** Списки из тела заметки - только они, см. `extractLists`. */
	body: string;
}

/**
 * Единицы повтора со всеми падежами, в которых их пишут: «каждый 2 день»,
 * «каждую 2 неделю», «каждые 3 недели». Согласование числа и слова не
 * проверяется намеренно - лишь бы было понятно, что имел в виду человек.
 */
const REPEAT_UNIT_WORDS: Record<RepeatUnit, string[]> = {
	day: ['день', 'дня', 'дней', 'дни'],
	week: ['неделя', 'неделю', 'недели', 'недель', 'неделе'],
	month: ['месяц', 'месяца', 'месяцев', 'месяцы'],
	year: ['год', 'года', 'году', 'годов', 'годы', 'лет'],
};

/** Односложные формы без числа. */
const REPEAT_ADVERBS: Record<string, RepeatUnit> = {
	ежедневно: 'day',
	еженедельно: 'week',
	ежемесячно: 'month',
	ежегодно: 'year',
};

/** Дни недели в нумерации moment: 0 - воскресенье, 6 - суббота. */
const WEEKDAY_WORDS: Record<string, number> = {
	воскресенье: 0, воскресенья: 0, воскресение: 0, воскресения: 0,
	понедельник: 1, понедельника: 1, понедельники: 1,
	вторник: 2, вторника: 2, вторники: 2,
	среда: 3, среду: 3, среды: 3,
	четверг: 4, четверга: 4, четверги: 4,
	пятница: 5, пятницу: 5, пятницы: 5,
	суббота: 6, субботу: 6, субботы: 6,
};

/** «каждый», «каждую», «каждые» - любое окончание. */
const REPEAT_PREFIX = /^кажд[а-яё]+\s+/;
/** Число, можно с наращением: «2», «2-й». */
const REPEAT_INTERVAL = /^(\d+)(?:-?[а-яё]{1,2})?\s+/;
/** Оговорка с днями недели: «... в субботу», «... во вторник». */
const WEEKDAY_CLAUSE = /\s+(?:в|во)\s+/;
const WEEKDAY_PREFIX = /^(?:в|во)\s+/;
/** Перечисление внутри оговорки: «в субботу, понедельник». */
const LIST_SEPARATOR = /\s*,\s*/;

/**
 * Разобрать перечисление дней недели. Возвращает номера по возрастанию без
 * повторов; null - если хоть одно слово не день недели.
 */
const parseWeekdays = (text: string): number[] | null => {
	const parts = text.split(LIST_SEPARATOR)
		.map((part) => part.replace(WEEKDAY_PREFIX, '').trim())
		.filter((part) => part !== '');

	const weekdays: number[] = [];

	for (const part of parts) {
		const weekday = WEEKDAY_WORDS[part];
		if (weekday === undefined) return null;
		if (!weekdays.includes(weekday)) weekdays.push(weekday);
	}

	return weekdays.length > 0 ? weekdays.sort((a, b) => a - b) : null;
};

/**
 * Разобрать свойство «Повтор». Незнакомая форма - null, задача считается
 * разовой. Повтор всегда отсчитывается от свойства «Дата».
 *
 * Понимает:
 * - «каждый день», «каждый 2 день», «каждые 3 дня»;
 * - «каждую неделю», «каждую 2 неделю», «каждые 3 недели»;
 * - «каждый месяц», «каждый 3 месяц»; «каждый год», «каждый 2 год»;
 * - «каждые 2 недели в субботу», «каждую неделю во вторник»;
 * - «каждую неделю в субботу, понедельник» - несколько дней в одном повторе;
 * - «каждую субботу», «каждые 2 субботы» - то же, что неделя с днём недели;
 * - «ежедневно», «еженедельно», «ежемесячно», «ежегодно».
 *
 * Дни недели имеют смысл только для недельного повтора: «каждый месяц в
 * субботу» не про какую-то определённую субботу, поэтому не принимается.
 *
 * Не понимает оговорок вроде «каждый день, кроме выходных» и «по будням» -
 * такие задачи останутся разовыми.
 */
export const parseRepeat = (value: unknown): Repeat | null => {
	if (typeof value !== 'string') return null;

	// «и» между днями недели - тот же разделитель, что запятая.
	const normalized = value.trim().toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/ и /g, ', ');
	if (!normalized) return null;

	const adverb = REPEAT_ADVERBS[normalized];
	if (adverb) return { interval: 1, unit: adverb };

	if (!REPEAT_PREFIX.test(normalized)) return null;

	let rest = normalized.replace(REPEAT_PREFIX, '');

	const intervalMatch = rest.match(REPEAT_INTERVAL);
	const interval = intervalMatch ? Number(intervalMatch[1]) : 1;
	if (!Number.isInteger(interval) || interval < 1) return null;
	if (intervalMatch) rest = rest.replace(REPEAT_INTERVAL, '');

	const clauseAt = rest.search(WEEKDAY_CLAUSE);
	const head = clauseAt === -1 ? rest : rest.slice(0, clauseAt);
	const tail = clauseAt === -1 ? null : rest.slice(clauseAt).replace(WEEKDAY_CLAUSE, '');

	const units = Object.keys(REPEAT_UNIT_WORDS) as RepeatUnit[];
	const unit = units.find((key) => REPEAT_UNIT_WORDS[key].includes(head));

	if (tail !== null) {
		const weekdays = parseWeekdays(tail);

		// «в субботу» уточняет только неделю: у месяца и года таких суббот много.
		if (unit !== 'week' || !weekdays) return null;

		return { interval, unit, weekdays };
	}

	if (unit) return { interval, unit };

	// «каждую субботу» - та же неделя с днями недели, только короче.
	const weekdays = parseWeekdays(head);

	return weekdays ? { interval, unit: 'week', weekdays } : null;
};

/** Привести значение свойства к YYYY-MM-DD. Мусор и пустота - null. */
export const normalizeDate = (value: unknown): string | null => {
	if (value === null || value === undefined || value === '') return null;

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;

		const date = moment(trimmed.slice(0, DATE_FORMAT.length), DATE_FORMAT, true);

		return date.isValid() ? date.format(DATE_FORMAT) : null;
	}

	// YAML-парсер может отдать дату объектом Date.
	if (value instanceof Date) {
		const date = moment(value);

		return date.isValid() ? date.format(DATE_FORMAT) : null;
	}

	return null;
};

/**
 * Свойство-галочка. Obsidian хранит его булевым, но руками в YAML пишут и
 * строкой - принимаем оба вида, всё остальное считаем снятой галочкой.
 */
const normalizeFlag = (value: unknown): boolean =>
	value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

/** Свойство «Выполнено»: список дат, одиночное значение или пусто. */
const normalizeDoneList = (value: unknown): string[] => {
	const items = Array.isArray(value) ? value : [value];

	return items
		.map(normalizeDate)
		.filter((date): date is string => date !== null);
};

/**
 * Свойства, без которых заметка задачей не считается. Нужны все три, пусть даже
 * пустые: это защита от того, чтобы календарь не подхватывал случайные заметки,
 * у которых просто оказалось свойство с похожим именем.
 */
const REQUIRED_FIELDS = [FIELD.date, FIELD.done, FIELD.repeat];

/** Заметка объявляет себя задачей: в свойствах есть все три поля. */
export const isTaskNote = (frontmatter: Record<string, unknown> | null | undefined): boolean =>
	Boolean(frontmatter) && REQUIRED_FIELDS.every((field) => field in frontmatter!);

/**
 * Дата в начале имени файла: `2026-08-13 - Купить молоко`. Тире и пробелы
 * вокруг него срезаются вместе с датой.
 */
const FILE_NAME_DATE = /^\d{4}-\d{2}-\d{2}\s*[-–—]?\s*/;

/**
 * Наименование задачи из имени файла - без даты в начале.
 *
 * Дата в имени нужна человеку, чтобы искать заметки в проводнике, а в календаре
 * она уже есть в свойстве. Осталось от имени пусто - берём имя целиком, иначе
 * задача была бы безымянной.
 */
export const taskNameFromFile = (basename: string): string =>
	basename.replace(FILE_NAME_DATE, '').trim() || basename;

/**
 * Собрать задачу из свойств заметки.
 * Возвращает null, если это не заметка-задача.
 */
export const readTaskNote = (
	path: string,
	basename: string,
	frontmatter: Record<string, unknown> | null | undefined
): TaskNote | null => {
	if (!isTaskNote(frontmatter) || !frontmatter) return null;

	const rawRepeat = frontmatter[FIELD.repeat];

	return {
		task: taskNameFromFile(basename),
		link: path,
		date: normalizeDate(frontmatter[FIELD.date]),
		done: normalizeDoneList(frontmatter[FIELD.done]),
		repeat: parseRepeat(rawRepeat),
		repeatRaw: typeof rawRepeat === 'string' ? rawRepeat : null,
		stopped: normalizeFlag(frontmatter[FIELD.stop]),
	};
};

/** Символы, запрещённые в имени файла хранилища. */
const FORBIDDEN_IN_NAME = /[\\/:*?"<>|#^[\]]/g;

/**
 * Имя файла новой задачи: `YYYY-MM-DD - Название`. Запрещённые символы
 * выкидываются, лишние пробелы схлопываются. Пусто - null, создавать нечего.
 */
export const taskNoteFileName = (date: string, task: string): string | null => {
	const name = task.replace(FORBIDDEN_IN_NAME, ' ').replace(/\s+/g, ' ').trim();

	return name ? `${date} - ${name}` : null;
};

/**
 * Текст новой заметки-задачи: свойства и один снятый чекбокс с названием.
 *
 * Чекбокс нужен не для красоты: выполнение считается по чекбоксам тела, и без
 * единого чекбокса задачу нечем было бы закрыть.
 */
export const buildTaskNote = (date: string, task: string): string => [
	'---',
	`${FIELD.date}: ${date}`,
	`${FIELD.done}:`,
	`${FIELD.repeat}:`,
	`${FIELD.stop}: false`,
	'---',
	'',
	`- [ ] ${task}`,
	'',
].join('\n');

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(\r?\n|$)/;

/** Тело задачи - всё, что идёт после блока свойств. */
export const extractBody = (content: string): string =>
	content.replace(FRONTMATTER_PATTERN, '').replace(/^\s*\n/, '').trimEnd();

/**
 * Строка-подзадача в теле заметки, разобранная на части: отступ с маркером
 * списка, сам знак в скобках и остаток строки. Принимаются `-`, `*`, `+` и
 * нумерованные списки, знак внутри скобок - любой (темы рисуют своими значками
 * `[/]`, `[>]` и прочие).
 */
const BODY_TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\].*)$/;

/** Открытие или закрытие блока кода: в нём чекбоксов не рисуется. */
const FENCE_LINE = /^\s*(```|~~~)/;

/** Строка списка любого уровня: `- пункт`, `* пункт`, `1. пункт`, `2) пункт`. */
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * Оставить в теле только списки - чекбоксы и вложенные пункты. Всё остальное
 * (абзацы, заголовки, цитаты, выноски, таблицы) отбрасывается: под календарём
 * от задачи нужен перечень того, что делать, а не вся заметка целиком.
 *
 * Отступы сохраняются дословно, поэтому вложенность остаётся. Пустые строки
 * между пунктами уходят - разорванные ими списки склеиваются в один.
 *
 * Строки внутри блоков кода пропускаются, как и в `toggleBodyCheckbox`: там
 * список списком не является. Важно, что оба места пропускают одно и то же -
 * иначе нумерация чекбоксов разъедется и галочка правила бы чужую строку.
 */
export const extractLists = (body: string): string => {
	const lines: string[] = [];
	let inFence = false;

	for (const line of body.split('\n')) {
		if (FENCE_LINE.test(line)) {
			inFence = !inFence;
			continue;
		}

		if (!inFence && LIST_LINE.test(line)) lines.push(line);
	}

	return lines.join('\n');
};

/**
 * Переключить подзадачу в теле заметки. `index` - порядковый номер чекбокса
 * сверху вниз, ровно как их отрисовал markdown-рендер.
 *
 * `blockDate` сужает счёт до блока этой итерации - иначе галочка из блока
 * второго дня попала бы в строку первого: рендеру отдан только один блок, и
 * нумерация в нём своя. Блока с такой датой нет - считаем по всему телу, как
 * для заметок без блоков.
 *
 * Возвращает новый текст файла или null, если такого чекбокса нет - тогда
 * писать нечего. Меняется ровно один символ в одной строке: остальной текст,
 * отступы и блок свойств остаются как были.
 *
 * Строки внутри блоков кода пропускаются: рендер их чекбоксами не делает, и без
 * пропуска нумерация разъехалась бы - галочка правила бы чужую строку.
 */
export const toggleBodyCheckbox = (
	content: string,
	index: number,
	blockDate: string | null = null
): string | null => {
	const frontmatter = content.match(FRONTMATTER_PATTERN)?.[0] ?? '';
	const lines = content.slice(frontmatter.length).split('\n');
	const block = blockDate
		? parseBodyBlocks(lines).find((item) => item.date === blockDate)
		: undefined;
	const from = block ? block.start + 1 : 0;
	const to = block ? block.end : lines.length - 1;
	let found = -1;
	let inFence = false;

	for (let i = from; i <= to; i++) {
		if (FENCE_LINE.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const parts = lines[i].match(BODY_TASK_LINE);
		if (!parts) continue;

		found++;
		if (found !== index) continue;

		const checked = parts[2].toLowerCase() === 'x';
		lines[i] = `${parts[1]}${checked ? ' ' : 'x'}${parts[3]}`;

		return frontmatter + lines.join('\n');
	}

	return null;
};

/**
 * Заголовок блока итерации в теле задачи: `## 2026-08-13`.
 *
 * У повторяющейся задачи каждый повтор получает свой набор чекбоксов, чтобы
 * отмечаться заново, не стирая прошлые. Набор помечается заголовком с датой.
 */
const BLOCK_HEADING = /^#{1,6}\s+(\d{4}-\d{2}-\d{2})\s*$/;

/** Блок итерации: строка заголовка и границы его строк в теле. */
interface BodyBlock {
	date: string;
	/** Строка самого заголовка. */
	start: number;
	/** Последняя строка блока - перед следующим заголовком или конец тела. */
	end: number;
}

/** Разобрать тело на блоки итераций. Пустой список - блоков нет. */
const parseBodyBlocks = (lines: string[]): BodyBlock[] => {
	const blocks: BodyBlock[] = [];

	for (let i = 0; i < lines.length; i++) {
		const heading = lines[i].match(BLOCK_HEADING);
		if (!heading) continue;

		const previous = blocks[blocks.length - 1];
		if (previous) previous.end = i - 1;

		blocks.push({ date: heading[1], start: i, end: lines.length - 1 });
	}

	return blocks;
};

/** Снять галочки со строк-подзадач, остальное оставить как есть. */
const clearChecks = (lines: string[]): string[] =>
	lines.map((line) => line.replace(BODY_TASK_LINE, '$1 $3'));

/** Строка списка вне блока кода - то, что показывается под календарём. */
const collectLists = (lines: string[]): string[] => {
	const collected: string[] = [];
	let inFence = false;

	for (const line of lines) {
		if (FENCE_LINE.test(line)) {
			inFence = !inFence;
			continue;
		}

		if (!inFence && LIST_LINE.test(line)) collected.push(line);
	}

	return collected;
};

/**
 * Все чекбоксы отмечены - задача этого дня сделана.
 *
 * Считается по строкам, а не по тому, что нарисовал рендер: вложенные чекбоксы
 * такие же строки списка и идут в тот же счёт. Ни одного чекбокса - false:
 * закрывать нечего, и пустое тело не должно считаться выполненным.
 */
const allChecked = (lines: string[]): boolean => {
	let found = false;
	let inFence = false;

	for (const line of lines) {
		if (FENCE_LINE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const task = line.match(BODY_TASK_LINE);
		if (!task) continue;

		found = true;
		if (task[2].toLowerCase() !== 'x') return false;
	}

	return found;
};

/**
 * Строки тела, относящиеся к этому дню.
 *
 * У задачи с блоками итераций это блок дня - у каждого повтора свой набор
 * галочек. Блока нет (или блоков нет вовсе) - всё тело.
 */
const dayLines = (body: string, date: string): string[] => {
	const lines = body.split('\n');
	const block = parseBodyBlocks(lines).find((item) => item.date === date);

	return block ? lines.slice(block.start + 1, block.end + 1) : lines;
};

/** Задача выбранного дня закрыта: все её чекбоксы отмечены. */
export const isDayComplete = (body: string, date: string): boolean =>
	allChecked(dayLines(body, date));

/**
 * Есть ли у дня чекбоксы вообще.
 *
 * Нужно, чтобы не спутать «ничего не отмечено» с «отмечать нечем»: выполнение
 * считается по чекбоксам, и у задачи без них журнал закрытий трогать нельзя -
 * дату туда мог вписать человек руками.
 */
export const hasDayCheckboxes = (body: string, date: string): boolean =>
	dayLines(body, date).some((line) => BODY_TASK_LINE.test(line));

/** В теле есть блоки итераций - значит задача уже живёт по дням. */
export const hasBodyBlocks = (body: string): boolean =>
	parseBodyBlocks(body.split('\n')).length > 0;

/** Даты блоков итераций в порядке появления. Блоков нет - пустой список. */
export const bodyBlockDates = (body: string): string[] =>
	parseBodyBlocks(body.split('\n')).map((block) => block.date);

/**
 * Списки блока выбранного дня.
 *
 * Блоков в теле нет или под этот день блока нет - показывается всё тело, как
 * раньше. Это же оставляет рабочими заметки, заведённые до блоков.
 */
export const extractDayLists = (body: string, date: string): string => {
	const lines = body.split('\n');
	const blocks = parseBodyBlocks(lines);
	const block = blocks.find((item) => item.date === date);

	if (block) return collectLists(lines.slice(block.start + 1, block.end + 1)).join('\n');

	// Блоков нет вовсе - заметка живёт по-старому, показываем всё тело.
	if (blocks.length === 0) return extractLists(body);

	// Блоки есть, а этого дня среди них нет: показываем чистую копию последней
	// итерации - как будет выглядеть этот день. Слить все блоки в один список
	// нельзя: получится каша из чужих галочек, и номера чекбоксов разъедутся.
	const last = blocks[blocks.length - 1];

	return clearChecks(collectLists(lines.slice(last.start + 1, last.end + 1))).join('\n');
};

/**
 * Пометить датой чекбоксы, которые ещё не лежат ни в одном блоке.
 *
 * Так первая же отметка «сделал» превращает обычное тело в первый блок
 * итерации. Заголовок ставится перед первой строкой списка, всё остальное
 * остаётся на месте. Свободных чекбоксов нет - null, писать нечего.
 */
export const labelBodyBlock = (content: string, date: string): string | null => {
	const frontmatter = content.match(FRONTMATTER_PATTERN)?.[0] ?? '';
	const lines = content.slice(frontmatter.length).split('\n');
	const blocks = parseBodyBlocks(lines);
	const limit = blocks.length > 0 ? blocks[0].start : lines.length;

	let inFence = false;
	let firstList = -1;

	for (let i = 0; i < limit; i++) {
		if (FENCE_LINE.test(lines[i])) {
			inFence = !inFence;
			continue;
		}

		if (!inFence && BODY_TASK_LINE.test(lines[i])) {
			firstList = i;
			break;
		}
	}

	if (firstList === -1) return null;

	// Заголовок должен стоять отдельным абзацем, иначе он прилипнет к тексту выше.
	const heading = firstList > 0 && lines[firstList - 1].trim() !== ''
		? ['', `## ${date}`]
		: [`## ${date}`];

	lines.splice(firstList, 0, ...heading);

	return frontmatter + lines.join('\n');
};

/**
 * Завести в теле чистый блок под указанный день - копию последнего набора со
 * снятыми галочками.
 *
 * Блок встаёт **на своё место по дате**, а не в хвост: иначе заметка, в которой
 * дни закрывали вразнобой, превращается в мешанину заголовков.
 *
 * null - копировать нечего (чекбоксов в теле нет) или блок под этот день уже
 * есть. Второе важно: без этой проверки каждый скан дописывал бы новый блок.
 */
export const appendBodyBlock = (content: string, date: string): string | null => {
	const frontmatter = content.match(FRONTMATTER_PATTERN)?.[0] ?? '';
	const body = content.slice(frontmatter.length);
	const lines = body.split('\n');
	const blocks = parseBodyBlocks(lines);

	if (blocks.some((block) => block.date === date)) return null;

	const last = blocks[blocks.length - 1];
	const source = last ? lines.slice(last.start + 1, last.end + 1) : lines;
	const template = clearChecks(collectLists(source));

	if (!template.some((line) => BODY_TASK_LINE.test(line))) return null;

	const block = [`## ${date}`, ...template, ''];
	const next = blocks.find((item) => item.date > date);

	if (!next) return `${frontmatter}${body.trimEnd()}\n\n${block.join('\n')}`;

	lines.splice(next.start, 0, ...block);

	return frontmatter + lines.join('\n');
};

/** Задачу закрывали в этот день. */
export const isDoneOn = (note: TaskNote, date: string): boolean => note.done.includes(date);

/**
 * Задача закрыта совсем и в календаре не показывается.
 *
 * Разовую задачу закрывает любая запись в «Выполнено» - делать её больше не
 * нужно. Повторяющаяся не закрывается никогда: выполнение лишь добавляет день
 * в «Выполнено» и сдвигает «Дату» на следующий повтор.
 */
export const isClosed = (note: TaskNote): boolean => !note.repeat && note.done.length > 0;

/** Разобранный день - moment, каким его отдаёт сам obsidian. */
type Day = ReturnType<typeof moment>;

/**
 * Разбор дня с памятью.
 *
 * Строка даты в хранилище повторяется постоянно: одни и те же дни сетки, одни и
 * те же «Даты» у сотен задач. А `moment(строка, формат, true)` - самая дорогая
 * операция во всём расчёте, на тысяче задач она и съедала всё время.
 *
 * Отданный moment **менять нельзя**: он общий. Весь код ниже перед изменением
 * делает clone(), так и надо продолжать.
 */
const parsedDays = new Map<string, Day>();

const parseDay = (date: string): Day => {
	const cached = parsedDays.get(date);
	if (cached) return cached;

	// Грубая защита от бесконечного роста: дат столько не бывает, но если
	// когда-нибудь наберётся - проще начать с чистого листа, чем городить LRU.
	if (parsedDays.size > 4096) parsedDays.clear();

	const parsed = moment(date, DATE_FORMAT, true);
	parsedDays.set(date, parsed);

	return parsed;
};

/**
 * То же, что occursOn, но обе даты уже разобраны.
 *
 * Вынесено ради `pendingDays`: там один и тот же день проверяется по всем
 * задачам, и разбирать строки заново на каждую пару - самая дорогая часть
 * работы календаря.
 */
const occursOnDay = (note: TaskNote, start: Day, target: Day): boolean => {
	// Разовая задача стоит ровно в своём дне - сравнения дат хватает.
	if (!note.repeat) return target.isSame(start, 'day');

	if (target.isBefore(start, 'day')) return false;

	// Повтор с днями недели считается по неделям от недели «Даты», а сама «Дата»
	// днём задачи не становится: «каждые 2 недели в субботу» - это только субботы.
	if (note.repeat.weekdays !== undefined) {
		if (!note.repeat.weekdays.includes(target.day())) return false;

		// Число недель между понедельниками, но без clone().startOf('isoWeek') на
		// каждый вызов: смещение дня от понедельника считается арифметикой, и на
		// тысяче задач это заметно дешевле.
		const fromMonday = (day: Day): number => (day.day() + 6) % 7;
		const weeks = (target.diff(start, 'day') - fromMonday(target) + fromMonday(start)) / 7;

		return weeks >= 0 && weeks % note.repeat.interval === 0;
	}

	if (target.isSame(start, 'day')) return true;

	const { interval, unit } = note.repeat;
	const steps = target.diff(start, unit);
	if (steps % interval !== 0) return false;

	// У дней арифметика точная, сверять обратным ходом нечего - а вот у месяцев
	// и лет `diff` округляет вниз, и без проверки 30 апреля сошло бы за 31 марта.
	if (unit === 'day') return true;
	if (!start.clone().add(steps, unit).isSame(target, 'day')) return false;

	// И diff, и add подтягивают 31-е к длине месяца, поэтому сверки обратным
	// ходом мало: «31 числа каждый месяц» не должно попадать на 28 февраля.
	if ((unit === 'month' || unit === 'year') && target.date() !== start.date()) return false;

	return true;
};

/** Задача выпадает на этот день: сама дата или один из повторов. */
export const occursOn = (note: TaskNote, date: string): boolean => {
	if (!note.date) return false;

	// Самый частый случай - задача без повтора: строки сравнить дешевле, чем
	// разбирать даты. Формат нормализован, так что сравнение точное.
	if (!note.repeat) return note.date === date;

	const start = parseDay(note.date);
	const target = parseDay(date);
	if (!start.isValid() || !target.isValid()) return false;

	return occursOnDay(note, start, target);
};

/**
 * Следующий повтор задачи строго после указанного дня.
 * null - у задачи нет повтора или следующий день не нашёлся.
 *
 * Шаг ищется перебором с запасом: у месячных повторов дни вроде 31-го
 * встречаются не в каждом месяце, и такие месяцы надо пропустить.
 */
export const nextOccurrenceAfter = (note: TaskNote, date: string): string | null => {
	if (!note.repeat) return null;

	const from = parseDay(date);
	if (!from.isValid()) return null;

	const { interval, unit, weekdays } = note.repeat;

	// Дни недели идут внутри недели вразнобой, поэтому перебираем по дням.
	const step = weekdays ? 1 : interval;
	const stepUnit: RepeatUnit = weekdays ? 'day' : unit;
	const limit = weekdays ? 7 * interval + 7 : 48;

	for (let i = 1; i <= limit; i++) {
		const candidate = from.clone().add(step * i, stepUnit).format(DATE_FORMAT);

		if (occursOn(note, candidate)) return candidate;
	}

	return null;
};

/**
 * Задача этого дня, которую ещё предстоит сделать.
 *
 * Выполненное в календаре не показывается: ни закрытые разовые задачи, ни
 * прошедшие закрытия повторов. История живёт отдельно от календаря.
 *
 * «Стоп повтор» убирает задачу целиком - и из будущего, и из прошлого. Это
 * пауза, а не закрытие: журнал не трогается, снятая галочка всё возвращает.
 */
const isPendingOn = (note: TaskNote, date: string): boolean =>
	// Порядок проверок - от дешёвых к дорогим: разбор дат внутри occursOn стоит
	// на порядок больше, чем взгляд на флаг или на список закрытий.
	!note.stopped && !isClosed(note) && !isDoneOn(note, date) && occursOn(note, date);

/**
 * Есть ли на этом дне невыполненные задачи - день помечается точкой.
 *
 * Прошлое и будущее не различаются: точка одна на все случаи. Задача всегда
 * стоит в своём дне из свойства «Дата» и никуда не переносится - поправили дату
 * на будущую, и прошедший день освободился вместе с ней.
 */
export const hasPendingTasks = (notes: TaskNote[], date: string): boolean =>
	notes.some((note) => isPendingOn(note, date));

/**
 * Карта «день -> есть невыполненные» сразу по всем дням сетки.
 *
 * Дороже всего в календаре именно эта проверка: дней 42, задач может быть
 * тысяча, а разбор даты - самая тяжёлая операция moment. Поэтому даты разбираются
 * по разу (дни сетки и «Дата» задачи), задача, которую и так не показывают,
 * отсеивается до цикла, а уже помеченный день пропускается.
 */
export const pendingDays = (notes: TaskNote[], dates: string[]): Record<string, boolean> => {
	const days = dates.map((date) => ({ date, parsed: parseDay(date) }));
	const result: Record<string, boolean> = {};
	let left = days.length;

	for (const note of notes) {
		if (left === 0) break;
		if (note.stopped || isClosed(note) || !note.date) continue;

		const start = parseDay(note.date);
		if (!start.isValid()) continue;

		for (const day of days) {
			if (result[day.date] || !day.parsed.isValid()) continue;
			if (!occursOnDay(note, start, day.parsed) || isDoneOn(note, day.date)) continue;

			result[day.date] = true;
			left--;
		}
	}

	return result;
};

/**
 * Сравнение наименований. Через готовый Intl.Collator, а не localeCompare:
 * localeCompare со строкой локали каждый раз собирает сравнитель заново, и на
 * сортировке сотен задач это самая дорогая строчка.
 */
const byName = new Intl.Collator('ru');

/** Невыполненные задачи этого дня. Порядок - по наименованию. */
export const getTasksForDate = (notes: TaskNote[], date: string): TaskNote[] =>
	notes
		.filter((note) => isPendingOn(note, date))
		.sort((a, b) => byName.compare(a.task, b.task));

/**
 * Задачи, закрытые в этот день - прямо из журнала «Выполнено».
 *
 * Показываются в конце списка дня, чтобы отметку можно было отменить. Календарь
 * их не помечает: точка ставится только по невыполненному (hasPendingTasks).
 *
 * Считается по журналу, а не по повторке: день могли вписать в «Выполнено»
 * руками, мимо череды повторов, и такая запись всё равно должна быть видна -
 * иначе её нечем снять.
 */
export const getDoneTasksForDate = (notes: TaskNote[], date: string): TaskNote[] =>
	notes
		.filter((note) => isDoneOn(note, date))
		.sort((a, b) => byName.compare(a.task, b.task));
