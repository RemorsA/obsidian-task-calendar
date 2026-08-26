import { moment } from 'obsidian';

/**
 * Формат задачи 3.0: блок строк списка с эмодзи, тело с отступом.
 *
 * ```
 * - 📅 2026-08-21
 * - 🔁 Каждый день
 * - ✅ 2026-08-21
 * 	- [ ] Купить молоко
 * ```
 *
 * **Файл - авторитет.** Любую строку параметров можно выставить, изменить или
 * удалить руками: плагин ничего не нормализует и не переписывает по своей
 * инициативе. Единственная автоматика в файле - переключение чекбокса
 * (см. `taskMap.ts`).
 *
 * Задача - это файл, конкретный экземпляр (текущий блок или архивный блок
 * цепочки повтора) адресуется парой «файл + порядковый номер блока».
 * Отдельного айди нет, номер пересчитывается при переиндексации.
 */

export const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Эмодзи параметров. При чтении `↔` принимается и без селектора U+FE0F, при
 * записи он ставится всегда - иначе в одних темах стрелка нарисуется текстом.
 */
export const EMOJI = {
	date: '\u{1F4C5}',
	move: '↔️',
	repeat: '\u{1F501}',
	done: '✅',
} as const;

export type ParamName = keyof typeof EMOJI;

/** Порядок параметров при записи. При чтении порядок произвольный. */
const PARAM_ORDER: ParamName[] = ['date', 'move', 'repeat', 'done'];

/** Параметры, по которым узнаётся блок. Почему без ↔️ - см. `blockShape`. */
const SHAPE_PARAMS: ParamName[] = ['date', 'repeat', 'done'];

const PARAM_BY_EMOJI: Record<string, ParamName> = {
	'\u{1F4C5}': 'date',
	'↔️': 'move',
	'↔': 'move',
	'\u{1F501}': 'repeat',
	'✅': 'done',
};

/**
 * Строка параметра: пункт списка, эмодзи и **непустое** значение. Одно без
 * другого параметром не считается - `- 📅` без даты это обычный пункт.
 */
const PARAM_LINE = /^(?:[-*+]|\d+[.)])[ \t]+(\u{1F4C5}|↔️?|\u{1F501}|✅)[ \t]*(\S.*)$/u;

/** Строка списка любого уровня: `- пункт`, `* пункт`, `1. пункт`, `2) пункт`. */
const LIST_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/** Чекбокс: отступ с маркером, знак в скобках, остаток строки. */
const CHECKBOX_LINE = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([^\]])(\].*)$/;

/** Открытие или закрытие блока кода: внутри него списков не бывает. */
const FENCE_LINE = /^[ \t]*(?:```|~~~)/;

/** Строго YYYY-MM-DD: времени и таймзон формат не хранит. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export interface Repeat {
	/** Шаг: «каждые 2 недели» - это 2. */
	interval: number;
	unit: RepeatUnit;
	/** Дни недели по ISO: 1 - понедельник, 7 - воскресенье. Только у недели. */
	weekdays?: number[];
	/** Месяцы: 0 - январь, 11 - декабрь. Только у года. */
	months?: number[];
}

/** Задача в карте - один валидный блок одного файла. */
export interface Task {
	/** `${filePath}${fileName}.md#${blockIndex}`. */
	key: string;
	/** Порядковый номер блока в файле, считая и невалидные. */
	blockIndex: number;
	/** 📅 - обязательный параметр: день задачи в череде и точка отсчёта повтора. */
	date: string;
	/** ↔️ - день показа, если экземпляр перенесли. */
	move: string | null;
	/** 🔁 - текст повтора как он написан в файле. */
	repeat: string | null;
	/** ✅ - маркер факта выполнения. */
	done: string | null;
	/** Имя файла без `.md`. */
	fileName: string;
	/** Путь до папки со слэшами по краям: корень хранилища - `/`. */
	filePath: string;
	/** Списки тела без общего отступа: `- [ ] Task\n\t- [ ] Sub Task`. */
	body: string | null;
	/** Все чекбоксы отмечены. Справочное поле, к группировке отношения не имеет. */
	checked: boolean;
	/** Ключ сортировки по наименованию. В файл не пишется. */
	sortKey: string;
}

/** Значение параметра и строка файла, в которой оно стоит. */
export interface BlockParam {
	line: number;
	value: string;
}

/** Разобранный блок: строки параметров и строки тела - номерами строк файла. */
export interface ParsedBlock {
	index: number;
	/** Первая строка блока. Новый блок повтора вставляется прямо перед ней. */
	start: number;
	/** Последняя строка блока. */
	end: number;
	params: Partial<Record<ParamName, BlockParam>>;
	/** Строки параметров по возрастанию. */
	paramLines: number[];
	/** Строки тела по возрастанию - всё, что с отступом. */
	body: number[];
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

/** Дни недели по ISO: 1 - понедельник, 7 - воскресенье. */
const WEEKDAY_WORDS: Record<string, number> = {
	понедельник: 1, понедельника: 1, понедельники: 1,
	вторник: 2, вторника: 2, вторники: 2,
	среда: 3, среду: 3, среды: 3,
	четверг: 4, четверга: 4, четверги: 4,
	пятница: 5, пятницу: 5, пятницы: 5,
	суббота: 6, субботу: 6, субботы: 6,
	воскресенье: 7, воскресенья: 7, воскресение: 7, воскресения: 7,
};

/** Месяцы в нумерации moment: 0 - январь, 11 - декабрь. */
const MONTH_WORDS: Record<string, number> = {
	январь: 0, января: 0, январе: 0,
	февраль: 1, февраля: 1, феврале: 1,
	март: 2, марта: 2, марте: 2,
	апрель: 3, апреля: 3, апреле: 3,
	май: 4, мая: 4, мае: 4,
	июнь: 5, июня: 5, июне: 5,
	июль: 6, июля: 6, июле: 6,
	август: 7, августа: 7, августе: 7,
	сентябрь: 8, сентября: 8, сентябре: 8,
	октябрь: 9, октября: 9, октябре: 9,
	ноябрь: 10, ноября: 10, ноябре: 10,
	декабрь: 11, декабря: 11, декабре: 11,
};

/** «каждый», «каждую», «каждые» - любое окончание. */
const REPEAT_PREFIX = /^кажд[а-яё]+\s+/;
/** Число, можно с наращением: «2», «2-й». */
const REPEAT_INTERVAL = /^(\d+)(?:-?[а-яё]{1,2})?\s+/;
/** Оговорка «... в субботу», «... во вторник». */
const CLAUSE = /\s+(?:в|во)\s+/;
const CLAUSE_PREFIX = /^(?:в|во)\s+/;
/** Перечисление внутри оговорки: «в субботу, понедельник». */
const LIST_SEPARATOR = /\s*,\s*/;

/**
 * Разобрать перечисление по словарю: дни недели или месяцы. Номера по
 * возрастанию без повторов; null - если хоть одно слово незнакомо.
 */
const parseNumberList = (text: string, words: Record<string, number>): number[] | null => {
	const parts = text.split(LIST_SEPARATOR)
		.map((part) => part.replace(CLAUSE_PREFIX, '').trim())
		.filter((part) => part !== '');

	const numbers: number[] = [];

	for (const part of parts) {
		const number = words[part];
		if (number === undefined) return null;
		if (!numbers.includes(number)) numbers.push(number);
	}

	return numbers.length > 0 ? numbers.sort((a, b) => a - b) : null;
};

const parseWeekdays = (text: string): number[] | null => parseNumberList(text, WEEKDAY_WORDS);

const parseMonths = (text: string): number[] | null => parseNumberList(text, MONTH_WORDS);

/**
 * Разобрать текст 🔁. Незнакомая форма - null, и блок целиком невалиден:
 * показать задачу с нераспознанным повтором значило бы соврать о её дате.
 *
 * Понимает:
 * - «каждый день», «каждый 2 день», «каждые 3 дня»;
 * - «каждую неделю», «каждые 2 недели»; «каждый месяц»; «каждый год»;
 * - «каждые 2 недели в субботу», «каждую неделю в понедельник, среду»;
 * - «каждый год в марте, сентябре»;
 * - короткие формы «каждую субботу» и «каждый март»;
 * - наречия «ежедневно», «еженедельно», «ежемесячно», «ежегодно».
 *
 * Оговорка уточняет **только свою единицу**: дни недели - неделю, месяцы - год.
 * «Каждый месяц в субботу» и «каждую неделю в марте» не принимаются.
 *
 * «Каждые 2 марта» - это «каждые 2 года в марте», а не второе марта: число в
 * повторке всегда означает шаг, число месяца берётся из 📅.
 */
export const parseRepeat = (value: unknown): Repeat | null => {
	if (typeof value !== 'string') return null;

	// «и» между перечисленными - тот же разделитель, что запятая.
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

	const clauseAt = rest.search(CLAUSE);
	const head = clauseAt === -1 ? rest : rest.slice(0, clauseAt);
	const tail = clauseAt === -1 ? null : rest.slice(clauseAt).replace(CLAUSE, '');

	const units = Object.keys(REPEAT_UNIT_WORDS) as RepeatUnit[];
	const unit = units.find((key) => REPEAT_UNIT_WORDS[key].includes(head));

	if (tail !== null) {
		// «в субботу» уточняет только неделю: у месяца и года таких суббот много.
		if (unit === 'week') {
			const weekdays = parseWeekdays(tail);

			return weekdays ? { interval, unit, weekdays } : null;
		}

		// «в марте» уточняет только год: внутри месяца или недели марта не бывает.
		if (unit === 'year') {
			const months = parseMonths(tail);

			return months ? { interval, unit, months } : null;
		}

		return null;
	}

	if (unit) return { interval, unit };

	// «каждую субботу» - та же неделя с днями недели, только короче.
	const weekdays = parseWeekdays(head);
	if (weekdays) return { interval, unit: 'week', weekdays };

	// «каждый март» - тот же год с месяцами, только короче.
	const months = parseMonths(head);

	return months ? { interval, unit: 'year', months } : null;
};

/** Значение параметра-даты. Всё, что не строгое YYYY-MM-DD, - null. */
export const normalizeDate = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();
	if (!DATE_ONLY.test(trimmed)) return null;

	return moment(trimmed, DATE_FORMAT, true).isValid() ? trimmed : null;
};

/**
 * Следующая дата повтора. База - 📅 выполненного блока, шаг применяется **ровно
 * один раз**: ни ✅, ни сегодняшний день в расчёте не участвуют.
 *
 * Следствие: задача, закрытая с опозданием, получит следующую дату тоже в
 * прошлом и сразу попадёт в просроченные. Это ожидаемо - догонять до
 * сегодняшнего дня не нужно.
 */
export const nextDate = (base: string, repeat: Repeat): string | null => {
	const start = moment(base, DATE_FORMAT, true);
	if (!start.isValid()) return null;

	if (repeat.unit === 'day') {
		return start.clone().add(repeat.interval, 'day').format(DATE_FORMAT);
	}

	if (repeat.unit === 'month') {
		// moment сам зажимает число по длине месяца: 31 января + 1 месяц - 28 февраля.
		return start.clone().add(repeat.interval, 'month').format(DATE_FORMAT);
	}

	if (repeat.unit === 'week') {
		const days = repeat.weekdays;
		if (!days || days.length === 0) {
			return start.clone().add(7 * repeat.interval, 'day').format(DATE_FORMAT);
		}

		// Ближайший день недели строго после базы внутри её же ISO-недели.
		const after = days.find((day) => day > start.isoWeekday());
		if (after !== undefined) return start.clone().isoWeekday(after).format(DATE_FORMAT);

		return start.clone()
			.startOf('isoWeek')
			.add(repeat.interval, 'week')
			.isoWeekday(days[0])
			.format(DATE_FORMAT);
	}

	const months = repeat.months;
	if (!months || months.length === 0) {
		// 29 февраля + год - 28 февраля, moment зажимает сам.
		return start.clone().add(repeat.interval, 'year').format(DATE_FORMAT);
	}

	// Число берётся от базы, месяц - из оговорки; moment зажимает число по
	// длине месяца, поэтому 31 января + «в феврале» это 28 февраля.
	const after = months.find((month) => month > start.month());

	return after !== undefined
		? start.clone().month(after).format(DATE_FORMAT)
		: start.clone().add(repeat.interval, 'year').month(months[0]).format(DATE_FORMAT);
};

/**
 * Сколько шагов череды перебираем, докручивая её до видимого окна. Ежедневная
 * задача покрывает этим полтора года; дальше проекция молча обрывается - точнее
 * посчитать нельзя, а вешать интерфейс на бесконечном переборе нельзя тем более.
 */
export const OCCURRENCE_LIMIT = 500;

/**
 * Дни череды повтора **строго после базы**, попавшие в окно `[from, to]`.
 *
 * Нужна календарю: в файле живёт только текущий блок, а следующий появляется
 * лишь после закрытия предыдущего. Без проекции у повторяющейся задачи была бы
 * одна точка - на её собственном дне, и выбрать в календаре следующую субботу,
 * чтобы отметить именно её, было бы негде.
 *
 * Считается перебором `nextDate`, а не арифметикой по шагу: у месячного повтора
 * число зажимается по длине месяца (31 -> 28), и следующий шаг идёт уже от
 * зажатого дня. Арифметика разошлась бы с тем, что реально окажется в файле.
 */
export const occurrencesInRange = (
	base: string,
	repeat: Repeat,
	from: string,
	to: string,
	taken: ReadonlySet<string> = new Set(),
	limit: number = OCCURRENCE_LIMIT
): string[] => {
	const days: string[] = [];
	let current = base;

	for (let step = 0; step < limit; step++) {
		const next = nextDate(current, repeat);
		// Повтор, не двигающий дату, - невозможен, но зациклиться на нём нельзя.
		if (!next || next <= current) break;

		current = next;
		if (current > to) break;
		// День, у которого уже есть свой блок, череда перескакивает: его судьбу
		// решает этот блок, а не расчёт.
		if (current >= from && !taken.has(current)) days.push(current);
	}

	return days;
};

/**
 * Следующий день череды после базы, **пропуская дни, у которых уже есть свой
 * блок**. Отметили повтор наперёд - дошедшая до него череда его перескочит.
 *
 * Свободного дня не нашлось за `limit` шагов - null, генерации не будет: лучше
 * оборвать цепочку, чем поставить второй блок на занятый день.
 */
export const nextFreeDate = (
	base: string,
	repeat: Repeat,
	taken: ReadonlySet<string> = new Set(),
	limit: number = OCCURRENCE_LIMIT
): string | null => {
	let current = base;

	for (let step = 0; step < limit; step++) {
		const next = nextDate(current, repeat);
		if (!next || next <= current) return null;
		if (!taken.has(next)) return next;

		current = next;
	}

	return null;
};

/** Разобрать строку параметра нулевого уровня. */
const matchParam = (line: string): { name: ParamName; value: string } | null => {
	const parts = line.match(PARAM_LINE);
	if (!parts) return null;

	const name = PARAM_BY_EMOJI[parts[1]];

	return name ? { name, value: parts[2].trim() } : null;
};

/**
 * Разобрать файл на блоки.
 *
 * **Граница блока.** Новый блок открывается, когда встречена строка параметра
 * нулевого уровня и при этом либо такой параметр в текущем блоке уже есть, либо
 * у текущего блока уже началось тело. Пустые строки границей не являются.
 *
 * Тело - строки с отступом. Строка нулевого уровня, которая параметром не
 * является (абзац, заголовок), в блок не попадает и блок не закрывает.
 */
export const parseBlocks = (lines: string[]): ParsedBlock[] => {
	const blocks: ParsedBlock[] = [];
	let current: ParsedBlock | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '') continue;

		const indented = /^[ \t]/.test(line);
		const param = indented ? null : matchParam(line);

		if (param) {
			if (current && (current.params[param.name] || current.body.length > 0)) current = null;

			if (!current) {
				current = {
					index: blocks.length,
					start: i,
					end: i,
					params: {},
					paramLines: [],
					body: [],
				};
				blocks.push(current);
			}

			current.params[param.name] = { line: i, value: param.value };
			current.paramLines.push(i);
			current.end = i;
			continue;
		}

		if (!current || !indented) continue;

		current.body.push(i);
		current.end = i;
	}

	return blocks;
};

/** 📅 блока - его единственная дата и база расчёта повтора. */
export const blockDate = (block: ParsedBlock): string | null =>
	normalizeDate(block.params.date?.value);

/**
 * День показа блока: ↔️, если она есть и разобралась, иначе 📅.
 *
 * Мусор в ↔️ блок не ломает - показываем по 📅: 📅 у валидного блока есть всегда,
 * а молча спрятать задачу из-за кривой строки хуже, чем показать её на своём дне.
 */
export const blockShow = (block: ParsedBlock): string | null =>
	normalizeDate(block.params.move?.value) ?? normalizeDate(block.params.date?.value);

/** Отступ строки: табы и пробелы по отдельности. */
const indentOf = (line: string): { tabs: number; spaces: number } => {
	const indent = line.match(/^[ \t]*/)?.[0] ?? '';
	let tabs = 0;
	let spaces = 0;

	for (const char of indent) {
		if (char === '\t') tabs++;
		else spaces++;
	}

	return { tabs, spaces };
};

/**
 * Уровень вложенности каждой строки тела, считая от самой левой строки блока.
 *
 * Один уровень - это таб, 2 или 4 пробела, причём в одной заметке они бывают
 * вперемешку. Шаг в пробелах вычисляется по блоку: берётся самый маленький
 * ненулевой пробельный отступ, остальные меряются им.
 */
const bodyLevels = (lines: string[], block: ParsedBlock): Map<number, number> => {
	let unit = 0;

	for (const i of block.body) {
		const { spaces } = indentOf(lines[i]);
		if (spaces > 0 && (unit === 0 || spaces < unit)) unit = spaces;
	}

	const levels = new Map<number, number>();
	let min = Number.MAX_SAFE_INTEGER;

	for (const i of block.body) {
		const { tabs, spaces } = indentOf(lines[i]);
		const level = tabs + (unit > 0 ? Math.round(spaces / unit) : 0);
		levels.set(i, level);
		if (level < min) min = level;
	}

	// Общий отступ снимается: тело блока начинается с нулевого уровня.
	for (const [i, level] of levels) levels.set(i, level - min);

	return levels;
};

/**
 * Строки тела, которые видны в карточке: только списки, только вне блоков кода.
 *
 * Этот же набор задаёт нумерацию чекбоксов. Важно, что он один: разойдись отбор
 * для показа и отбор для отметки - галочка правила бы чужую строку.
 */
export const renderLines = (lines: string[], block: ParsedBlock): number[] => {
	const out: number[] = [];
	let fence = false;

	for (const i of block.body) {
		if (FENCE_LINE.test(lines[i])) {
			fence = !fence;
			continue;
		}

		if (!fence && LIST_LINE.test(lines[i])) out.push(i);
	}

	return out;
};

/** Строки чекбоксов блока сверху вниз - в том же порядке их рисует рендер. */
export const checkboxLines = (lines: string[], block: ParsedBlock): number[] =>
	renderLines(lines, block).filter((i) => CHECKBOX_LINE.test(lines[i]));

const isChecked = (line: string): boolean =>
	(line.match(CHECKBOX_LINE)?.[2] ?? ' ').toLowerCase() === 'x';

/** Тело для карточки: списки блока, отступы в табах, общий отступ снят. */
const bodyText = (lines: string[], block: ParsedBlock): string => {
	const levels = bodyLevels(lines, block);

	return renderLines(lines, block)
		.map((i) => '\t'.repeat(levels.get(i) ?? 0) + lines[i].trimStart())
		.join('\n');
};

/** `[[Заметка|Текст]]` и `[текст](url)` - в разметке ключа сортировки не нужны. */
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const MD_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;
/** Инлайн-разметка и HTML-теги. */
const INLINE_MARKUP = /(\*\*|__|~~|==|[*_`])|<[^>]+>/g;
/**
 * Ведущие эмодзи с модификаторами и склейками.
 *
 * Селектор `\uFE0F`, склейка `\u200D` и клавишный знак `\u20E3` стоят в классе
 * намеренно: снимается вся ведущая эмодзи-последовательность целиком, по символу
 * за проход. Именно на это и ругается no-misleading-character-class - здесь это
 * не ошибка, а смысл.
 */
// eslint-disable-next-line no-misleading-character-class
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\u20E3\s]+/u;
/** Ведущие небуквенные символы. */
const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u;
/** Маркер списка вместе с чекбоксом. */
const LIST_MARKER = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

/**
 * Ключ сортировки по наименованию: первый элемент тела, очищенный от разметки.
 *
 * Считается один раз при индексации и живёт в `sortKey`. В файл не пишется -
 * это производная от тела, а не свойство задачи.
 *
 * Пустой ключ означает «карточка уходит в конец своей группы»: от строки из
 * одних эмодзи и знаков препинания сравнивать нечего.
 */
export const sortKeyOf = (body: string | null): string => {
	const first = (body ?? '').split('\n').find((line) => line.trim() !== '');
	if (!first) return '';

	const plain = first.trimStart().replace(LIST_MARKER, '');

	let text = plain
		.replace(WIKI_LINK, (_match, target: string, alias?: string) => alias ?? target)
		.replace(MD_LINK, (_match, label: string) => label)
		.replace(INLINE_MARKUP, '')
		.replace(/#(?=[\p{L}\p{N}])/gu, '');

	// Эмодзи снимаются до стабилизации: за флагом может стоять ещё один.
	let previous = '';
	while (previous !== text) {
		previous = text;
		text = text.replace(LEADING_EMOJI, '');
	}

	text = text.replace(LEADING_SYMBOLS, '').replace(/\s+/g, ' ').trim();

	return text || plain.replace(/\s+/g, ' ').trim();
};

/** Путь папки со слэшами по краям и имя файла без расширения. */
export const splitPath = (path: string): { filePath: string; fileName: string } => {
	const at = path.lastIndexOf('/');
	const name = at === -1 ? path : path.slice(at + 1);
	const folder = at === -1 ? '' : path.slice(0, at);

	return {
		filePath: folder ? `/${folder}/` : '/',
		fileName: name.replace(/\.md$/i, ''),
	};
};

/** День показа задачи: позиция в календаре, точка и просрочка считаются по нему. */
export const showDate = (task: Task): string => task.move ?? task.date;

/** Путь файла в хранилище по задаче - обратная операция к splitPath. */
export const taskVaultPath = (task: Task): string =>
	`${task.filePath.slice(1)}${task.fileName}.md`;

/**
 * Задачи файла - по одной на валидный блок.
 *
 * Блок валиден, только если есть 📅 с корректной датой, в теле есть хотя бы один
 * чекбокс и текст 🔁 (если он есть) разобрался. Иначе блок игнорируется **молча**:
 * в карту не попадает, карточка не рисуется, файл не правится.
 */
export const readTasks = (path: string, content: string): Task[] => {
	const lines = content.split('\n');
	const { filePath, fileName } = splitPath(path);
	const tasks: Task[] = [];

	for (const block of parseBlocks(lines)) {
		if (!isValidBlock(lines, block)) continue;

		const date = normalizeDate(block.params.date?.value) as string;
		const checkboxes = checkboxLines(lines, block);
		const body = bodyText(lines, block);

		tasks.push({
			key: `${filePath}${fileName}.md#${block.index}`,
			blockIndex: block.index,
			date,
			move: normalizeDate(block.params.move?.value),
			repeat: block.params.repeat?.value ?? null,
			done: normalizeDate(block.params.done?.value),
			fileName,
			filePath,
			body: body || null,
			checked: checkboxes.every((i) => isChecked(lines[i])),
			sortKey: sortKeyOf(body),
		});
	}

	return tasks;
};

/**
 * Отпечаток блока - **его строки параметров**.
 *
 * По нему автоматика узнаёт, что перед ней тот же самый блок, а не другой,
 * съехавший на этот номер: номер сам по себе ненадёжен, вставили блок выше - и
 * все номера сдвинулись. Параметры для этого годятся, а 📅 у блоков одной цепочки
 * повтора к тому же разные.
 *
 * **Тело в отпечаток не входит намеренно.** Дописали в закрытый блок снятую
 * подзадачу - блок перестал быть отмеченным целиком, и ✅ должно уйти. Считай мы
 * тело частью отпечатка, такая правка выглядела бы как «другой блок», и ✅
 * осталось бы висеть на невыполненной задаче.
 *
 */
export const blockShape = (block: ParsedBlock): string =>
	SHAPE_PARAMS
		.map((name) => `${name}:${block.params[name]?.value ?? ''}`)
		.join('|');

/**
 * Блок валиден: есть 📅 с корректной датой, разобранный 🔁 (если он есть) и хотя
 * бы один чекбокс в теле. Невалидный блок не попадает в карту, не рисуется
 * карточкой и **не правится автоматикой**.
 */
export const isValidBlock = (lines: string[], block: ParsedBlock): boolean => {
	if (!normalizeDate(block.params.date?.value)) return false;

	const repeat = block.params.repeat?.value;
	if (repeat !== undefined && !parseRepeat(repeat)) return false;

	return checkboxLines(lines, block).length > 0;
};

/** Правка файла: заменить `remove` строк начиная с `at` на `insert`. */
export interface Edit {
	at: number;
	remove: number;
	insert: string[];
}

/**
 * Применить правки одним проходом. Идут с конца, иначе первая же вставка сдвинет
 * номера строк для всех остальных.
 */
export const applyEdits = (lines: string[], edits: Edit[]): string[] => {
	const out = lines.slice();

	// При равном месте первой идёт правка, съедающая строку: вставка на то же
	// место должна лечь перед ней, а не быть ею затёрта.
	for (const edit of [...edits].sort((a, b) => b.at - a.at || b.remove - a.remove)) {
		out.splice(edit.at, edit.remove, ...edit.insert);
	}

	return out;
};

/** Строка параметра в каноническом виде. */
export const paramLine = (name: ParamName, value: string): string =>
	`- ${EMOJI[name]} ${value}`;

/**
 * Поставить параметр: заменить существующую строку или вписать новую в
 * канонический порядок 📅, 🔁, ✅.
 */
export const setParamEdit = (block: ParsedBlock, name: ParamName, value: string): Edit => {
	const existing = block.params[name];
	if (existing) return { at: existing.line, remove: 1, insert: [paramLine(name, value)] };

	// Место по канону: перед первым параметром, который должен идти позже.
	const after = PARAM_ORDER.slice(PARAM_ORDER.indexOf(name) + 1)
		.map((later) => block.params[later]?.line)
		.filter((line): line is number => line !== undefined);
	const at = after.length > 0
		? Math.min(...after)
		: Math.max(...block.paramLines) + 1;

	return { at, remove: 0, insert: [paramLine(name, value)] };
};

/** Убрать параметр. Его нет - править нечего. */
export const removeParamEdit = (block: ParsedBlock, name: ParamName): Edit | null => {
	const existing = block.params[name];

	return existing ? { at: existing.line, remove: 1, insert: [] } : null;
};

/**
 * Копия тела блока. Отступы нормализуются в табы, 1 таб на уровень: своё пишем
 * канонически, чужое не трогаем.
 *
 * `clear` снимает галочки - новому экземпляру задачи чужие отметки не нужны.
 * Перенос, наоборот, забирает состояние с собой: это тот же экземпляр, просто в
 * другой день.
 */
const copiedBody = (lines: string[], block: ParsedBlock, clear: boolean): string[] => {
	const levels = bodyLevels(lines, block);

	return block.body.map((i) => {
		const raw = lines[i].trimStart();
		const text = clear ? raw.replace(CHECKBOX_LINE, '$1 $3') : raw;

		return '\t'.repeat((levels.get(i) ?? 0) + 1) + text;
	});
};

/**
 * Новый блок цепочки повтора: 📅 по расчёту, та же строка 🔁, то же тело со
 * снятыми чекбоксами. Без ✅ - выполнение предыдущего к нему не относится.
 */
export const repeatBlockLines = (
	lines: string[],
	block: ParsedBlock,
	date: string
): string[] => {
	const params = [paramLine('date', date)];
	const repeat = block.params.repeat;
	if (repeat) params.push(paramLine('repeat', repeat.value));

	return [...params, ...copiedBody(lines, block, true)];
};

/**
 * Блок отдельного дня череды - того, который отметили наперёд.
 *
 * **Без 🔁:** цепочку ведёт текущий блок, и второй блок с повтором наплодил бы
 * свою собственную череду. Этот блок отвечает только за свой день, а дошедшая до
 * него череда его перескочит (`nextFreeDate`).
 */
export const occurrenceBlockLines = (
	lines: string[],
	block: ParsedBlock,
	date: string,
	keepMarks = false
): string[] => [paramLine('date', date), ...copiedBody(lines, block, !keepMarks)];

/**
 * Блок перенесённого экземпляра: 📅 - день череды, с которого он уехал, ↔️ - день
 * показа. **Без 🔁:** цепочку ведёт свой блок, второй с повтором наплодил бы свою
 * череду.
 *
 * 📅 остаётся днём череды намеренно: этот день теперь занят блоком, и череда его
 * перескочит - иначе на нём снова появилась бы карточка, уже вторая.
 */
export const movedBlockLines = (
	lines: string[],
	block: ParsedBlock,
	origin: string,
	date: string,
	keepMarks = false
): string[] => [
	paramLine('date', origin),
	paramLine('move', date),
	...copiedBody(lines, block, !keepMarks),
];

/** Снять галочки в теле блока - правками, не переписывая его целиком. */
export const clearChecksEdits = (lines: string[], block: ParsedBlock): Edit[] =>
	block.body
		.filter((i) => isChecked(lines[i]))
		.map((i) => ({ at: i, remove: 1, insert: [lines[i].replace(CHECKBOX_LINE, '$1 $3')] }));

/**
 * Место для **выполненного** блока - в конец, за последним.
 *
 * Так уходит вниз день, отмеченный наперёд: он закрыт, и в архиве ему самое
 * место. Уже лежащие блоки при этом не двигаются: ничего не сортируем и не
 * перекладываем, что где лежит - там и остаётся.
 *
 * Именно за последним блоком, а не в самый конец файла: там пустая строка,
 * которой файл заканчивается, и дописывать надо перед ней.
 */
export const blockAppendAt = (blocks: ParsedBlock[]): number =>
	blocks.length > 0 ? blocks[blocks.length - 1].end + 1 : 0;

/**
 * Переключить чекбокс блока. `index` - порядковый номер сверху вниз, ровно как
 * их отрисовал рендер. Меняется один символ в одной строке.
 *
 * Возвращает null, если блока или чекбокса с таким номером нет: писать нечего.
 */
export const toggleCheckboxEdit = (
	lines: string[],
	block: ParsedBlock,
	index: number
): Edit | null => {
	const line = checkboxLines(lines, block)[index];
	if (line === undefined) return null;

	const parts = lines[line].match(CHECKBOX_LINE);
	if (!parts) return null;

	const mark = parts[2].toLowerCase() === 'x' ? ' ' : 'x';

	return { at: line, remove: 1, insert: [`${parts[1]}${mark}${parts[3]}`] };
};

export const toggleCheckbox = (
	content: string,
	blockIndex: number,
	index: number
): string | null => {
	const lines = content.split('\n');
	const block = parseBlocks(lines).find((item) => item.index === blockIndex);
	if (!block) return null;

	const edit = toggleCheckboxEdit(lines, block, index);

	return edit ? applyEdits(lines, [edit]).join('\n') : null;
};

/** Все чекбоксы блока отмечены. Блок без чекбоксов невалиден и сюда не доходит. */
export const allChecked = (lines: string[], block: ParsedBlock): boolean => {
	const boxes = checkboxLines(lines, block);

	return boxes.length > 0 && boxes.every((i) => isChecked(lines[i]));
};

/** Символы, недопустимые в имени файла, и ломающие ссылки Obsidian. */
const FORBIDDEN_IN_NAME = /[\\/:*?"<>|#^[\]]/g;
/** Сколько текста оставляем в имени файла. */
const NAME_LIMIT = 100;

/**
 * Имя файла новой задачи: `YYYY-MM-DD - <текст>`, без расширения.
 *
 * Текст - первый элемент тела без маркера. Эмодзи, ссылки и разметка остаются
 * как есть: имя файла это не ключ сортировки. Пусто - остаётся одна дата.
 */
export const taskFileName = (date: string, text: string): string => {
	const cleaned = text
		.trimStart()
		.replace(LIST_MARKER, '')
		.replace(FORBIDDEN_IN_NAME, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (!cleaned) return date;

	if (cleaned.length <= NAME_LIMIT) return `${date} - ${cleaned}`;

	// Обрезаем по границе слова, а если слово одно - просто по длине.
	const cut = cleaned.slice(0, NAME_LIMIT);
	const space = cut.lastIndexOf(' ');
	const short = (space > 0 ? cut.slice(0, space) : cut).trim();

	return short ? `${date} - ${short}` : date;
};

/**
 * Текст нового файла задачи: 📅 выбранного дня и один снятый чекбокс.
 *
 * Файл начинается пустой строкой и заканчивается пустой строкой - так его
 * удобнее продолжать руками, дописывая блоки сверху и снизу.
 */
export const buildTaskFile = (date: string, text: string): string =>
	['', paramLine('date', date), `\t- [ ] ${text}`, ''].join('\n');

/**
 * Сравнение наименований одним общим коллатором: собирать его на каждое
 * сравнение (как делает localeCompare со строкой локали) заметно дороже.
 */
const collator = new Intl.Collator('ru', {
	numeric: true,
	sensitivity: 'base',
	ignorePunctuation: true,
});

/** Ключи второго уровня при равенстве: дата, имя файла, номер блока. */
const compareTail = (a: Task, b: Task): number => {
	const byDate = a.date.localeCompare(b.date);
	if (byDate !== 0) return byDate;

	const byFile = collator.compare(a.fileName, b.fileName);
	if (byFile !== 0) return byFile;

	return a.blockIndex - b.blockIndex;
};

/** По наименованию. Задача без ключа уходит в конец группы. */
export const compareByName = (a: Task, b: Task): number => {
	if (!a.sortKey || !b.sortKey) {
		if (a.sortKey !== b.sortKey) return a.sortKey ? -1 : 1;
	} else {
		const byName = collator.compare(a.sortKey, b.sortKey);
		if (byName !== 0) return byName;
	}

	return compareTail(a, b);
};

/** По дате, старое сверху. Так идут просроченные. */
export const compareByDate = (a: Task, b: Task): number => {
	const byDate = showDate(a).localeCompare(showDate(b));

	return byDate !== 0 ? byDate : compareByName(a, b);
};

/** Задача просрочена: её дата в прошлом и ✅ нет. */
export const isOverdue = (task: Task, today: string): boolean =>
	task.done === null && showDate(task) < today;
