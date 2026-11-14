import { moment, parseYaml } from 'obsidian';

/**
 * Формат задачи: отдельный файл со свойствами (версия 1.0.1, 13.11.2026).
 *
 * ```yaml
 * ---
 * Задача: Купить молоко
 * Выполнено: false
 * Дата и время: 2026-11-13T08:00:00
 * Дата выполнения:
 * Повтор: Каждый день
 * Дата переноса:
 * Подзадача-1: Проверить срок
 * Подзадача-1-выполнено: false
 * ---
 * ```
 *
 * Задача - любой `.md` хранилища с непустым строковым `Задача`. Имя файла - время
 * создания `ГГГГММДД_ЧЧММСС`. Порядок карточек - по `Дата и время`, раньше выше.
 * Тело файла под свойствами плагин не читает и не трогает.
 *
 * Здесь всё, что не обращается к хранилищу: чтение свойств, сборка файла,
 * грамматика повтора, автоматика переходов и порядок списка.
 */

export const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Даты задачи со временем - `Дата и время`, `Дата выполнения`, `Дата переноса`:
 * так их пишет сам Obsidian, тип «Дата и время».
 */
export const DATE_TIME_FORMAT = 'YYYY-MM-DD[T]HH:mm:ss';

/**
 * Время в `Дата и время` новой задачи и следующего повтора - всегда 08:00
 * (просьба пользователя 14.11.2026). Имя файла на даты не влияет.
 */
export const DEFAULT_TIME = '08:00:00';

/** Свойства задачи - ровно так, как они называются в файле. */
export const PROPS = {
	text: 'Задача',
	checked: 'Выполнено',
	// До 14.11.2026 - «Дата» без времени; переименовано по просьбе пользователя.
	date: 'Дата и время',
	doneDate: 'Дата выполнения',
	repeat: 'Повтор',
	move: 'Дата переноса',
} as const;

/**
 * Типы свойств в панели свойств Obsidian. Пустое при создании свойство Obsidian
 * показал бы текстом: у «Дата переноса» не было бы выбора даты. Все три даты -
 * со временем (14.11.2026). Галочки подзадач с номером в имени не перечислить -
 * их `false` Obsidian и так показывает флажком.
 */
export const PROPERTY_TYPES: Record<string, string> = {
	[PROPS.checked]: 'checkbox',
	[PROPS.date]: 'datetime',
	[PROPS.doneDate]: 'datetime',
	[PROPS.move]: 'datetime',
};

/** Номер подзадачи в имени свойства: путь [1, 2] - `1-2`. */
const pathKey = (path: number[]): string => path.join('-');

export const subtaskTextKey = (path: number[]): string => `Подзадача-${pathKey(path)}`;
export const subtaskCheckedKey = (path: number[]): string => `Подзадача-${pathKey(path)}-выполнено`;

/**
 * Ключ подзадачи: текст `Подзадача-N` или галочка `Подзадача-N-выполнено`. Номер
 * бывает многоуровневым - `Подзадача-1-2` вложена в `Подзадача-1` (просьба
 * пользователя 14.11.2026), глубина не ограничена.
 */
const SUBTASK_KEY = /^Подзадача-(\d+(?:-\d+)*)(-выполнено)?$/;


/** `ГГГГ-ММ-ДД`, `ГГГГ-ММ-ДДTЧЧ:ММ` или `ГГГГ-ММ-ДДTЧЧ:ММ:СС`, без таймзоны. */
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(:\d{2})?)?$/;

export type Frontmatter = Record<string, unknown>;

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

export interface Subtask {
	/**
	 * Номер из имени свойства по уровням: `Подзадача-1-2` - [1, 2]. По нему
	 * подзадача находится в файле, длина - уровень вложенности.
	 */
	path: number[];
	text: string;
	checked: boolean;
}

/** Задача в карте - один файл. */
export interface Task {
	/** Путь файла в хранилище - он же ключ задачи. */
	path: string;
	/** Имя файла без `.md`: время создания, по нему идёт порядок карточек. */
	fileName: string;
	/** Папка файла без слэшей по краям, корень хранилища - пустая строка. */
	folder: string;
	text: string;
	/** `Выполнено` - галочка самой задачи. */
	checked: boolean;
	/** День из `Дата и время`, `ГГГГ-ММ-ДД` - день задачи и база расчёта повтора. */
	date: string | null;
	/** `Дата и время` целиком, `ГГГГ-ММ-ДДTЧЧ:ММ:СС` - по нему порядок списка. */
	dateTime: string | null;
	/**
	 * `Дата выполнения`, `ГГГГ-ММ-ДДTЧЧ:ММ:СС` - момент выполнения; есть она,
	 * значит задача выполнена.
	 */
	doneDate: string | null;
	/** `Повтор` - текст как написан. Нераспознанный - задача без повтора. */
	repeat: string | null;
	/** `Дата переноса`, `ГГГГ-ММ-ДДTЧЧ:ММ:СС` - куда перенесли повторную задачу. */
	move: string | null;
	/** Подзадачи с текстом по порядку N. */
	subtasks: Subtask[];
}

/** Данные нового файла задачи: пустой шаблон или следующий повтор. */
export interface NewTask {
	/** `Задача`. Пусто - пустое свойство (шаблон для ручного заполнения). */
	text: string;
	/**
	 * День `Дата и время`, `ГГГГ-ММ-ДД`. Время - всегда `DEFAULT_TIME` (08:00), его
	 * ставит запись (`buildTaskFile`).
	 */
	date: string | null;
	repeat: string | null;
	/** Подзадачи: номер по уровням и текст, галочки сняты. */
	subtasks: { path: number[]; text: string }[];
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

const REPEAT_UNITS = Object.keys(REPEAT_UNIT_WORDS) as RepeatUnit[];

const unitOf = (word: string): RepeatUnit | undefined =>
	REPEAT_UNITS.find((key) => REPEAT_UNIT_WORDS[key].includes(word));

/**
 * Единица и оговорка после неё. Оговорка пишется с «в» («каждую неделю в
 * субботу») или без него («каждую неделю суббота, воскресенье») - упрощённая
 * запись из обновления 1.0.1, намеренная, а не опечатка.
 */
const splitClause = (rest: string): { head: string; tail: string | null } => {
	const clauseAt = rest.search(CLAUSE);

	if (clauseAt !== -1) {
		return { head: rest.slice(0, clauseAt), tail: rest.slice(clauseAt).replace(CLAUSE, '') };
	}

	const space = rest.indexOf(' ');
	if (space !== -1 && unitOf(rest.slice(0, space))) {
		return { head: rest.slice(0, space), tail: rest.slice(space + 1) };
	}

	return { head: rest, tail: null };
};

/**
 * Разобрать текст повтора. Незнакомая форма - null, и задача живёт как обычная:
 * не генерирует следующую и в календаре не размножается.
 *
 * Понимает:
 * - «каждый день», «каждый 2 день», «каждые 3 дня»;
 * - «каждую неделю», «каждые 2 недели»; «каждый месяц»; «каждый год»;
 * - «каждые 2 недели в субботу», «каждую неделю в понедельник, среду»;
 * - то же без «в»: «каждую неделю суббота, воскресенье», «каждый год июль, август»;
 * - «каждый год в марте, сентябре»;
 * - короткие формы «каждую субботу» и «каждый март»;
 * - наречия «ежедневно», «еженедельно», «ежемесячно», «ежегодно».
 *
 * Оговорка уточняет **только свою единицу**: дни недели - неделю, месяцы - год.
 * «Каждый месяц в субботу» и «каждую неделю в марте» не принимаются.
 *
 * «Каждые 2 марта» - это «каждые 2 года в марте», а не второе марта: число в
 * повторе всегда означает шаг, число месяца берётся из `Дата и время`.
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

	const { head, tail } = splitClause(rest);
	const unit = unitOf(head);

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

/**
 * Значение свойства-даты со временем (`Дата и время`, `Дата выполнения`,
 * `Дата переноса`) строкой `ГГГГ-ММ-ДДTЧЧ:ММ:СС`. Obsidian пишет его с
 * секундами, без секунд тоже читается; одна дата без времени (вписали руками
 * текстом) - полночь. Остальное - null.
 *
 * Объект `Date` из YAML (парсер без схемы) - время в UTC.
 */
export const normalizeDateTime = (value: unknown): string | null => {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : moment.utc(value).format(DATE_TIME_FORMAT);
	}

	if (typeof value !== 'string') return null;

	const match = value.trim().match(DATE_TIME);
	if (!match) return null;

	const text = `${match[1]}T${match[2] ?? '00:00'}${match[3] ?? ':00'}`;

	return moment(text, DATE_TIME_FORMAT, true).isValid() ? text : null;
};

/**
 * Следующая дата повтора. База - `Дата и время` выполненной задачи, шаг применяется
 * **ровно один раз**: ни дата выполнения, ни сегодняшний день в расчёте не
 * участвуют.
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
 * Дата файла следующего повтора: следующая после `Дата и время`. Совпала с днём, на
 * который перенесли саму задачу, - берётся следующая за ней, иначе в один день
 * встали бы две одинаковые карточки.
 */
export const nextRepeatDate = (base: string, repeat: Repeat, skip: string | null): string | null => {
	const next = nextDate(base, repeat);

	return next !== null && next === skip ? nextDate(next, repeat) : next;
};

/**
 * Сколько шагов повтора перебираем, докручивая его до видимого окна. Ежедневная
 * задача покрывает этим полтора года; дальше проекция молча обрывается - точнее
 * посчитать нельзя, а вешать интерфейс на бесконечном переборе нельзя тем более.
 */
export const OCCURRENCE_LIMIT = 500;

/**
 * Дни повтора **строго после базы**, попавшие в окно `[from, to]`.
 *
 * Нужна календарю: в хранилище лежит только текущий файл повтора, следующий
 * появляется после выполнения. Без проекции у повторяющейся задачи была бы одна
 * точка - на её собственном дне.
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
	limit: number = OCCURRENCE_LIMIT
): string[] => {
	const days: string[] = [];
	let current = base;

	for (let step = 0; step < limit; step++) {
		const next = nextDate(current, repeat);
		// Повтор, не двигающий дату, невозможен, но зациклиться на нём нельзя.
		if (!next || next <= current) break;

		current = next;
		if (current > to) break;
		if (current >= from) days.push(current);
	}

	return days;
};

/** Текст свойства: строка или число, обрезанное и непустое. */
const readText = (value: unknown): string | null => {
	if (typeof value === 'number') return String(value);
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();

	return trimmed === '' ? null : trimmed;
};

/** Галочка свойства: булево `true`; строка `true` - так её пишут в кавычках. */
const readFlag = (value: unknown): boolean =>
	value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

/**
 * Порядок обхода дерева подзадач: родитель перед детьми, соседи по номеру -
 * 1, 1-1, 1-2, 2, 2-1.
 */
const comparePaths = (a: number[], b: number[]): number => {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}

	return a.length - b.length;
};

/** Номера подзадач, у которых есть хоть одно свойство пары, в порядке обхода дерева. */
export const subtaskPaths = (frontmatter: Frontmatter): number[][] => {
	const paths = new Map<string, number[]>();

	for (const key of Object.keys(frontmatter)) {
		const match = key.match(SUBTASK_KEY);
		if (!match) continue;

		const path = match[1].split('-').map(Number);
		paths.set(pathKey(path), path);
	}

	return [...paths.values()].sort(comparePaths);
};

/**
 * Подзадачи в порядке обхода дерева. Текст без пары `-выполнено` - неотмеченная
 * подзадача; `-выполнено` без текста пропускается: показывать в карточке нечего.
 */
export const readSubtasks = (frontmatter: Frontmatter): Subtask[] =>
	subtaskPaths(frontmatter).flatMap((path) => {
		const text = readText(frontmatter[subtaskTextKey(path)]);

		return text === null
			? []
			: [{ path, text, checked: readFlag(frontmatter[subtaskCheckedKey(path)]) }];
	});

/**
 * Номера подзадач подряд на каждом уровне: старый номер -> новый. Узлы дерева -
 * все номера и их начала: у `Подзадача-2-1` есть родитель 2, даже если у самой
 * второй свойств нет. Соседи нумеруются 1, 2, 3 по порядку, дети едут за
 * родителем: 1, 3, 3-2 -> 1, 2, 2-1.
 */
const renumberedPaths = (frontmatter: Frontmatter): Map<string, number[]> => {
	const nodes = new Map<string, number[]>();

	for (const path of subtaskPaths(frontmatter)) {
		for (let depth = 1; depth <= path.length; depth++) {
			const prefix = path.slice(0, depth);
			nodes.set(pathKey(prefix), prefix);
		}
	}

	const renumbered = new Map<string, number[]>();
	const lastNumber = new Map<string, number>();

	// Обход дерева: родитель уже перенумерован, соседи идут по возрастанию.
	for (const path of [...nodes.values()].sort(comparePaths)) {
		const parent = pathKey(path.slice(0, -1));
		const number = (lastNumber.get(parent) ?? 0) + 1;

		lastNumber.set(parent, number);
		renumbered.set(pathKey(path), [...(renumbered.get(parent) ?? []), number]);
	}

	return renumbered;
};

/** В нумерации подзадач дыра на каком-нибудь уровне: удалили пару из середины. */
export const hasNumberingGap = (frontmatter: Frontmatter): boolean =>
	[...renumberedPaths(frontmatter)].some(([key, path]) => key !== pathKey(path));

/**
 * Перенумеровать подзадачи подряд на каждом уровне: 1, 3, 4 -> 1, 2, 3, а
 * вложенные переезжают вместе с родителем (3-1 -> 2-1). Пары переезжают целиком,
 * вместе с пустыми значениями: недописанную подзадачу не теряем.
 */
export const renumberSubtasks = (frontmatter: Frontmatter): void => {
	const renumbered = renumberedPaths(frontmatter);
	const pairs = subtaskPaths(frontmatter).map((path) => ({
		path: renumbered.get(pathKey(path)) ?? path,
		text: frontmatter[subtaskTextKey(path)],
		checked: frontmatter[subtaskCheckedKey(path)],
		hasText: subtaskTextKey(path) in frontmatter,
		hasChecked: subtaskCheckedKey(path) in frontmatter,
	}));

	for (const key of Object.keys(frontmatter)) {
		if (SUBTASK_KEY.test(key)) delete frontmatter[key];
	}

	for (const pair of pairs) {
		if (pair.hasText) frontmatter[subtaskTextKey(pair.path)] = pair.text;
		if (pair.hasChecked) frontmatter[subtaskCheckedKey(pair.path)] = pair.checked;
	}
};

/** Папка без слэшей по краям и имя файла без расширения. */
export const splitPath = (path: string): { folder: string; fileName: string } => {
	const at = path.lastIndexOf('/');

	return {
		folder: at === -1 ? '' : path.slice(0, at),
		fileName: (at === -1 ? path : path.slice(at + 1)).replace(/\.md$/i, ''),
	};
};

/** Задача из свойств файла. Нет непустого `Задача` - это не задача. */
export const readTask = (path: string, frontmatter: unknown): Task | null => {
	if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return null;

	const props = frontmatter as Frontmatter;
	const text = readText(props[PROPS.text]);
	if (text === null) return null;

	const dateTime = normalizeDateTime(props[PROPS.date]);

	return {
		path,
		...splitPath(path),
		text,
		checked: readFlag(props[PROPS.checked]),
		date: dateTime?.slice(0, 10) ?? null,
		dateTime,
		doneDate: normalizeDateTime(props[PROPS.doneDate]),
		repeat: readText(props[PROPS.repeat]),
		move: normalizeDateTime(props[PROPS.move]),
		subtasks: readSubtasks(props),
	};
};

/** Блок свойств в начале файла. Пустой блок `---` и `---` подряд - тоже блок. */
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * Свойства файла. Нет блока свойств или YAML не разобрался - null: такой файл
 * задачей не считается, а не роняет индексацию.
 */
export const frontmatterOf = (content: string): Frontmatter | null => {
	const match = content.match(FRONTMATTER);
	if (!match?.[1]) return null;

	try {
		const parsed: unknown = parseYaml(match[1]);

		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? parsed as Frontmatter
			: null;
	} catch {
		return null;
	}
};

export const readTaskFile = (path: string, content: string): Task | null =>
	readTask(path, frontmatterOf(content));

/** Отмечено всё: и сама задача, и все подзадачи. */
export const allChecked = (task: Task): boolean =>
	task.checked && task.subtasks.every((subtask) => subtask.checked);

/**
 * День показа - день из `Дата и время`. `Дата переноса` на показ не влияет
 * (решение пользователя 14.11.2026: у обычной задачи её не учитывать, а
 * перенесённая повторная получает новый день прямо в `Дата и время`, см.
 * `automate`). До этого день показа был `Дата переноса ?? Дата и время`.
 */
export const showDate = (task: Task): string | null => task.date;

/** Задача просрочена: не выполнена, а её день показа уже прошёл. */
export const isOverdue = (task: Task, today: string): boolean => {
	const day = showDate(task);

	return task.doneDate === null && day !== null && day < today;
};

/** Состояние задачи с прошлой индексации - по нему узнаётся переход. */
export interface TaskState {
	/** Отмечено всё. */
	all: boolean;
	move: string | null;
}

export const stateOf = (task: Task): TaskState => ({ all: allChecked(task), move: task.move });

/** День из даты со временем: `ГГГГ-ММ-ДДTЧЧ:ММ:СС` -> `ГГГГ-ММ-ДД`. */
const dayOf = (dateTime: string | null): string | null => dateTime?.slice(0, 10) ?? null;

/**
 * Данные файла следующего повтора: то же, что у задачи, галочки сняты. День -
 * по расчёту; время выполненной не переносится - в `Дата и время` встанет
 * `DEFAULT_TIME`, 08:00 (просьба пользователя 14.11.2026).
 */
const nextTaskOf = (task: Task, date: string): NewTask => ({
	text: task.text,
	date,
	repeat: task.repeat,
	subtasks: task.subtasks.map(({ path, text }) => ({ path, text })),
});

export interface Automation {
	/** Свойства поменялись - файл надо записать. */
	changed: boolean;
	/** Файл следующего повтора, если его надо создать. */
	next: NewTask | null;
}

/**
 * Автоматика: что меняется в свойствах задачи после правки. Меняет `frontmatter`
 * на месте и возвращает, нужен ли файл следующего повтора.
 *
 * | Переход | Что делается |
 * |---|---|
 * | не всё отмечено -> всё | `Дата выполнения` - момент выполнения `now`; есть повтор - он очищается, нужен следующий файл |
 * | всё -> снята любая галочка | `Дата выполнения` очищается, повтор не возвращается |
 * | `Дата переноса` появилась у невыполненной повторной | повтор очищается, `Дата и время` = `Дата переноса` целиком, нужен следующий файл |
 * | дыра в нумерации подзадач | перенумеровать подряд |
 *
 * Срабатывают только переходы относительно прошлого состояния `previous`:
 * правки, сделанные при выключенном плагине, не догоняются.
 */
export const automate = (frontmatter: Frontmatter, previous: TaskState, now: string): Automation => {
	const result: Automation = { changed: false, next: null };

	if (hasNumberingGap(frontmatter)) {
		renumberSubtasks(frontmatter);
		result.changed = true;
	}

	const task = readTask('', frontmatter);
	if (!task) return result;

	const repeat = parseRepeat(task.repeat);
	const all = allChecked(task);

	if (all && !previous.all && task.doneDate === null) {
		frontmatter[PROPS.doneDate] = now;
		result.changed = true;

		const date = repeat && task.date ? nextRepeatDate(task.date, repeat, dayOf(task.move)) : null;

		if (date) {
			frontmatter[PROPS.repeat] = null;
			result.next = nextTaskOf(task, date);
		}

		return result;
	}

	if (!all && previous.all && task.doneDate !== null) {
		// Повтор не возвращается: следующий файл уже создан, задача стала обычной.
		frontmatter[PROPS.doneDate] = null;
		result.changed = true;

		return result;
	}

	if (task.move !== null && previous.move === null && task.doneDate === null && repeat && task.date) {
		// Следующий повтор - от исходного дня, до переноса.
		const date = nextRepeatDate(task.date, repeat, dayOf(task.move));

		if (date) {
			frontmatter[PROPS.repeat] = null;
			// Сама задача переезжает на `Дата переноса` целиком, с её временем: показ
			// и порядок - только по `Дата и время` (решения пользователя 14.11.2026).
			frontmatter[PROPS.date] = task.move;
			result.changed = true;
			result.next = nextTaskOf(task, date);
		}
	}

	return result;
};

/** Значения, которые YAML без кавычек прочитал бы не строкой. */
const YAML_KEYWORD = /^(?:true|false|yes|no|on|off|null|~)$/i;
/** Начало, которое YAML без кавычек понял бы как разметку или число. */
const YAML_SPECIAL_START = /^[\s\-?:,[\]{}#&*!|>'"%@`+.\d]/;
/** Внутри строки: «: », « #», двоеточие в конце, переводы строк и кавычки. */
const YAML_SPECIAL_INSIDE = /: | #|:$|[\n\r\t"\\]/;

/** Строка в YAML: без кавычек, если её нельзя прочитать иначе, иначе в JSON-кавычках. */
const yamlString = (value: string): string =>
	value !== value.trim()
		|| YAML_KEYWORD.test(value)
		|| YAML_SPECIAL_START.test(value)
		|| YAML_SPECIAL_INSIDE.test(value)
		? JSON.stringify(value)
		: value;

/** Строка свойства: пустое значение - ключ с двоеточием и ничего после. */
const yamlLine = (key: string, value: string | boolean | null): string =>
	value === null ? `${key}:` : `${key}: ${value}`;

/**
 * Текст файла новой задачи: все свойства шаблона, пустые - пустыми, галочки
 * сняты. Даты пишутся как есть, тексты - в кавычках, когда без них YAML прочитал
 * бы не то. Пустой текст - пустое `Задача:`: такой файл задачей не считается,
 * пока его не заполнят.
 *
 * `Дата и время` = день задачи и `DEFAULT_TIME` (08:00) - у пустого шаблона и у
 * следующего повтора одинаково.
 */
export const buildTaskFile = (task: NewTask): string => {
	const lines = [
		'---',
		yamlLine(PROPS.text, task.text ? yamlString(task.text) : null),
		yamlLine(PROPS.checked, false),
		yamlLine(PROPS.date, task.date ? `${task.date}T${DEFAULT_TIME}` : null),
		yamlLine(PROPS.doneDate, null),
		yamlLine(PROPS.repeat, task.repeat ? yamlString(task.repeat) : null),
		yamlLine(PROPS.move, null),
	];

	for (const { path, text } of task.subtasks) {
		lines.push(yamlLine(subtaskTextKey(path), yamlString(text)));
		lines.push(yamlLine(subtaskCheckedKey(path), false));
	}

	lines.push('---', '');

	return lines.join('\n');
};

/** Имя файла задачи без расширения: время создания `ГГГГММДД_ЧЧММСС`. */
export const taskFileName = (now: ReturnType<typeof moment>): string =>
	now.format('YYYYMMDD_HHmmss');

/** Имя, начинающееся со времени создания, - его ставит сам плагин. */
const CREATED_NAME = /^\d{8}_\d{6}/;

/**
 * Сравнение имён одним общим коллатором: собирать его на каждое сравнение (как
 * делает localeCompare со строкой локали) заметно дороже.
 */
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/**
 * Порядок по дате и времени из имени файла `ГГГГММДД_ЧЧММСС`, раньше выше. С
 * 14.11.2026 список идёт по `Дата и время` (`compareByDateTime`), а этот порядок
 * разводит только задачи с одинаковым `Дата и время`.
 *
 * `20261113_130215_2` ниже своего «тёзки» без суффикса: он создан позже в ту же
 * секунду. Файл с другим именем (заведён руками) - ниже всех, между собой по
 * имени. Одинаковые имена в разных папках - по пути.
 */
export const compareByCreation = (a: Task, b: Task): number => {
	const createdA = CREATED_NAME.test(a.fileName);
	const createdB = CREATED_NAME.test(b.fileName);
	if (createdA !== createdB) return createdA ? -1 : 1;

	if (a.fileName !== b.fileName) {
		if (createdA) return a.fileName < b.fileName ? -1 : 1;

		const byName = collator.compare(a.fileName, b.fileName);
		if (byName !== 0) return byName;
	}

	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
};

/**
 * Порядок списка - по `Дата и время`, раньше выше: сверху ближайшие (просьба
 * пользователя 14.11.2026, вместо групп и порядка по имени файла). День показа и
 * повтор не влияют. Без даты - ниже всех. Одинаковое время - раньше созданный
 * файл выше.
 */
export const compareByDateTime = (a: Task, b: Task): number => {
	if (a.dateTime !== b.dateTime) {
		if (a.dateTime === null) return 1;
		if (b.dateTime === null) return -1;

		return a.dateTime < b.dateTime ? -1 : 1;
	}

	return compareByCreation(a, b);
};

/**
 * Порядок группы «Выполнено» - только что выполненные сверху (просьба
 * пользователя 14.11.2026): по `Дата выполнения`, новее выше. Она с точностью до
 * минуты; выполненные в одну минуту - позже созданный файл выше. Без
 * `Дата выполнения` - ниже всех: в группу такие не попадают, правило - для
 * полноты.
 */
export const compareByDone = (a: Task, b: Task): number => {
	if (a.doneDate !== b.doneDate) {
		if (a.doneDate === null) return 1;
		if (b.doneDate === null) return -1;

		return a.doneDate > b.doneDate ? -1 : 1;
	}

	return compareByCreation(b, a);
};

/**
 * Порядок полного списка: просроченные первыми - отдельным правилом (просьба
 * пользователя 14.11.2026), дальше `compareByDateTime`. Без правила перенесённая
 * задача вставала бы по `Дата и время`, а не по дню показа: просроченная по
 * переносу ушла бы вниз, к будущим.
 */
export const compareOverdueFirst = (today: string) => (a: Task, b: Task): number => {
	const overdueA = isOverdue(a, today);
	if (overdueA !== isOverdue(b, today)) return overdueA ? -1 : 1;

	return compareByDateTime(a, b);
};
