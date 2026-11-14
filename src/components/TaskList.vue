<template>
	<div class="task__calendar-list">
		<!--
			Календарь сверху всегда (просьба пользователя 14.11.2026, отдельного
			календаря больше нет). Режим задаёт свитч «Календарь в списке»: выключен -
			клик по дню выбирает его, под календарём задачи выбранного дня; включён -
			день не выбирается (без selectedDate ячейки не кнопки), под календарём
			100 ближайших невыполненных задач и группа «Выполнено».
		-->
		<TaskCalendar
			:plugin="props.plugin"
			:selected-date="isDayMode ? selectedDate : undefined"
			@select="handleSelectDay"
		/>

		<div
			v-if="isLoading"
			class="task__calendar-list-loading"
		>
			Загрузка...
		</div>

		<!--
			Нечего показать - «Задач нет», в обоих режимах: и пустой выбранный день,
			и пустой список при включённом свитче (просьба пользователя 14.11.2026;
			с 13.11 пустой день ничего не писал).
		-->
		<div
			v-else-if="shownTasks.length === 0"
			class="task__calendar-list-empty"
		>
			Задач нет
		</div>

		<!--
			Карточки разделами (`sections`): сначала задачи без заголовка - выбранного
			дня (`dayTasks`) или 100 ближайших невыполненных (`openTasks`); при
			включённом свитче под ними группа «Выполнено» (просьба пользователя
			14.11.2026: из прежних групп вернули только её).

			«Выполнено» сворачивается: заголовок - кнопка со стрелкой, число задач
			видно и у свёрнутой. Карточки свёрнутой группы остаются в разметке - иначе
			плавно схлопывать было бы нечего, - но недоступны: inert убирает их из
			фокуса и клика. У развёрнутой атрибута нет вовсе (undefined, а не false):
			там, где у элемента нет свойства inert, Vue написал бы inert="false", а
			атрибут работает при любом значении.
		-->
		<section
			v-for="section in sections"
			:key="section.id"
			:class="['task__calendar-list-section', `--is-${section.id}`, section.collapsed && '--is-collapsed']"
		>
			<h2
				v-if="section.title"
				class="task__calendar-group-heading"
			>
				<button
					class="task__calendar-group-toggle task__calendar-default-button"
					type="button"
					:aria-expanded="!section.collapsed"
					@click="handleToggleDone"
				>
					<svg class="task__calendar-group-arrow" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M104.7 338.8a64 64 0 0 1 90.5 0L512 655.6l316.8-316.8a64 64 0 0 1 90.5 90.4l-362 362.1a64 64 0 0 1-90.5 0l-362.1-362a64 64 0 0 1 0-90.5"/></svg>

					<span class="task__calendar-group-title">{{ section.title }}</span>

					<span class="task__calendar-group-count">{{ section.count }}</span>
				</button>

				<!--
					Подчёркивание - отдельный элемент, а не рамка кнопки (просьба
					пользователя 14.11.2026): скругление кнопки загибало линию по краям.
				-->
				<span
					class="task__calendar-group-line"
					aria-hidden="true"
				/>
			</h2>

			<div
				class="task__calendar-list-section-body"
				:inert="section.collapsed || undefined"
			>
				<!--
					--i - номер карточки в разделе: при разворачивании «Выполнено»
					карточки появляются по очереди, с задержкой по номеру.
				-->
				<div class="task__calendar-list-cards">
					<article
						v-for="(task, i) in section.tasks"
						:key="task.path"
						:class="['tasks__item', modifierOf(task)]"
						:style="{ '--i': i }"
					>
						<!--
							В задачах дня дня в заголовке карточки нет (просьба пользователя
							13.11.2026): день выбран в календаре. Кнопка редактирования
							остаётся.
						-->
						<header class="tasks__item-header">
							<span
								v-if="!isDayMode"
								class="tasks__item-date"
							>
								{{ cardDate(showDate(task)) }}
							</span>

							<button
								class="task__calendar-default-button tasks__item-edit-button"
								aria-label="Редактировать задачу"
								@click="handleClickEdit(task)"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="m199 672.6l194 112l224-388l-193.9-112l-224 388.1zm-23.8 60.2L208 881.1l145-45.7zM455 229.2l194 112l56.7-98l-194-112zM104.3 708.8l384-665l304.8 176l-384 665h.1l-248.4 78.3zm384 254.3v-64h448v64z"/></svg>
							</button>
						</header>

						<TaskBody
							:app="props.plugin.app"
							:markdown="bodyOf(task)"
							:source-path="task.path"
							@toggle-checkbox="handleToggle(task, $event)"
						/>
					</article>
				</div>
			</div>
		</section>

		<!--
			Новая задача (просьба пользователя 14.11.2026, вместо окна с полями):
			внизу списка прилипшая кнопка с плюсом, она создаёт файл с пустыми
			свойствами и открывает его для ручного заполнения.
		-->
		<button
			class="task__calendar-default-button task__calendar-create-open"
			type="button"
			aria-label="Новая задача"
			@click="handleCreate"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M480 480V128a32 32 0 0 1 64 0v352h352a32 32 0 1 1 0 64H544v352a32 32 0 1 1-64 0V544H128a32 32 0 0 1 0-64z"/></svg>
		</button>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, computed } from 'vue';
import type TaskCalendarPlugin from '../TaskCalendarPlugin';
import { Notice, moment } from 'obsidian';
import TaskBody from './TaskBody.vue';
import TaskCalendar from './TaskCalendar.vue';
import { vibrate } from '../haptics';
import {
	compareByDateTime,
	compareByDone,
	compareOverdueFirst,
	DATE_FORMAT,
	isOverdue,
	occurrencesInRange,
	parseRepeat,
	showDate,
	Task,
} from '../taskFormat';

const props = defineProps<{
	plugin: TaskCalendarPlugin;
}>();

const taskMap = props.plugin.taskMap;

/** Все задачи хранилища из карты. */
const tasks = shallowRef<Task[]>([]);
const isLoading = ref(false);
/**
 * Сегодняшний день. Не константа: список держат открытым сутками, и через
 * полночь «Сегодня» иначе осталось бы вчерашним. Обновляется на каждом изменении
 * карты - события хранилища и так идут постоянно.
 */
const todayStr = ref(moment().format(DATE_FORMAT));

/** Сколько невыполненных задач показывает список при включённом свитче. */
const LIST_LIMIT = 100;

/**
 * Невыполненные задачи: просроченные первыми, дальше по `Дата и время`, раньше
 * выше - сверху ближайшие; не больше `LIST_LIMIT` (просьба пользователя
 * 14.11.2026). Выполненные - не здесь, а в группе «Выполнено» под ними
 * (`doneTasks`).
 */
const openTasks = computed<Task[]>(() =>
	tasks.value
		.filter((task) => task.doneDate === null)
		.sort(compareOverdueFirst(todayStr.value))
		.slice(0, LIST_LIMIT)
);

/**
 * Свитч «Календарь в списке». Настройки Vue не отслеживает: свитч приходит
 * подпиской на смену настроек, без перезапуска списка.
 */
const calendarInList = ref(props.plugin.settings.calendarInList);

/** Режим дня: свитч выключен - день выбирается, под календарём его задачи. */
const isDayMode = computed((): boolean => !calendarInList.value);

/** Выбранный в календаре день, сначала сегодня. */
const selectedDate = ref(todayStr.value);

const handleSelectDay = (date: string): void => {
	selectedDate.value = date;
};

/**
 * На выбранный день приходится будущий день повтора задачи - там же, где у
 * календаря точка. Отметка такой карточки закрывает саму задачу, как в списке.
 */
const repeatsOn = (task: Task, day: string): boolean => {
	const repeat = parseRepeat(task.repeat);
	if (!repeat || !task.date) return false;

	return occurrencesInRange(task.date, repeat, day, day).length > 0;
};

/**
 * Задачи выбранного дня, как до версии 1.0.1: просроченные видны в любой
 * выбранный день, чтобы о долге не забыть; дальше задачи дня - день показа или
 * день повтора, - выполненные в этот день в конце. Внутри каждой части - по
 * `Дата и время`, раньше выше. Заголовков нет - просроченные отличает красная
 * рамка карточки.
 *
 * Отмеченная карточка поэтому уезжает в конец дня, а соседние поднимаются на её
 * место. При одинаковых текстах задач это легко принять за отметку соседней -
 * проверено 13.11.2026, отмечается именно нажатая; порядок оставлен (решение
 * пользователя).
 */
const dayTasks = computed<Task[]>(() => {
	const day = selectedDate.value;
	const today = todayStr.value;
	const overdue: Task[] = [];
	const open: Task[] = [];
	const done: Task[] = [];

	for (const task of tasks.value) {
		if (isOverdue(task, today)) overdue.push(task);
		else if (showDate(task) === day) (task.doneDate === null ? open : done).push(task);
		else if (task.doneDate === null && repeatsOn(task, day)) open.push(task);
	}

	return [
		...overdue.sort(compareByDateTime),
		...open.sort(compareByDateTime),
		...done.sort(compareByDateTime),
	];
});

/** Что показывает список: выбранный день или ближайшие невыполненные. */
const shownTasks = computed<Task[]>(() =>
	isDayMode.value ? dayTasks.value : openTasks.value
);

/**
 * Сколько карточек видно в «Выполнено» (просьба пользователя 14.11.2026): только
 * что выполненные. Число в заголовке - все выполненные задачи, любой давности
 * (решение пользователя 13.11.2026).
 */
const DONE_SHOWN = 20;

/**
 * Все выполненные, только что выполненные сверху (`compareByDone`). Только при
 * включённом свитче: в режиме дня выполненные идут в конце дня, без группы.
 */
const doneTasks = computed<Task[]>(() =>
	isDayMode.value
		? []
		: tasks.value.filter((task) => task.doneDate !== null).sort(compareByDone)
);

/**
 * Группа «Выполнено» свёрнута. Хранится в настройках плагина, чтобы пережить
 * перезапуск; настройки Vue не отслеживает, поэтому здесь своя реактивная копия.
 */
const doneCollapsed = ref(props.plugin.settings.doneCollapsed);

const handleToggleDone = async (): Promise<void> => {
	doneCollapsed.value = !doneCollapsed.value;

	props.plugin.settings.doneCollapsed = doneCollapsed.value;
	await props.plugin.saveSettings();
};

interface Section {
	id: 'tasks' | 'done';
	/** Заголовок раздела; у задач без группы его нет. */
	title: string | null;
	/** Число в заголовке. */
	count: number;
	tasks: Task[];
	collapsed: boolean;
}

/**
 * Разделы списка сверху вниз: задачи (выбранного дня или ближайшие
 * невыполненные), под ними при включённом свитче - «Выполнено». Пустые не
 * показываются: нечего показать - над ними «Задач нет».
 */
const sections = computed<Section[]>(() => {
	const list: Section[] = [];

	if (shownTasks.value.length > 0) {
		list.push({ id: 'tasks', title: null, count: shownTasks.value.length, tasks: shownTasks.value, collapsed: false });
	}

	if (doneTasks.value.length > 0) {
		list.push({
			id: 'done',
			title: 'Выполнено',
			count: doneTasks.value.length,
			tasks: doneTasks.value.slice(0, DONE_SHOWN),
			collapsed: doneCollapsed.value,
		});
	}

	return list;
});

/**
 * Вид карточки: красная рамка у просроченной, свой вид у выполненной. По самой
 * задаче: в выбранном дне календаря выполненные идут вместе с открытыми.
 */
const modifierOf = (task: Task): string => {
	if (task.doneDate !== null) return '--is-done';

	return isOverdue(task, todayStr.value) ? '--is-overdue' : '';
};

const checkbox = (checked: boolean): string => (checked ? '[x]' : '[ ]');

/** Одна строка: перевод строки в тексте свойства развалил бы список. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ');

/**
 * Уровень подзадачи в карточке: на один глубже ближайшего показанного предка
 * (`Подзадача-1-2` - под `Подзадача-1`, просьба пользователя 14.11.2026). Предка
 * без текста нет в карточке - тогда подзадача встаёт уровнем выше, а не под
 * чужого соседа. Подзадачи идут в порядке обхода дерева: предок уже посчитан.
 */
const subtaskDepths = (task: Task): number[] => {
	const depths = new Map<string, number>();

	return task.subtasks.map(({ path }) => {
		let depth = 1;

		for (let length = path.length - 1; length > 0; length--) {
			const parent = depths.get(path.slice(0, length).join('-'));

			if (parent !== undefined) {
				depth = parent + 1;
				break;
			}
		}

		depths.set(path.join('-'), depth);

		return depth;
	});
};

/**
 * Тело карточки - список: сама задача и подзадачи с отступом по уровню. Галочки
 * идут в том же порядке, в каком их номера отдаёт `TaskBody`: 0 - задача, дальше
 * подзадачи в порядке обхода дерева.
 */
const bodyOf = (task: Task): string => {
	const depths = subtaskDepths(task);

	return [
		`- ${checkbox(task.checked)} ${oneLine(task.text)}`,
		...task.subtasks.map((subtask, i) =>
			`${'\t'.repeat(depths[i])}- ${checkbox(subtask.checked)} ${oneLine(subtask.text)}`),
	].join('\n');
};

/** Открыть файл задачи на правку свойств. */
const openTask = async (path: string): Promise<void> => {
	try {
		await props.plugin.app.workspace.openLinkText(path, '', false, { state: { mode: 'source' } });
	} catch (error) {
		console.error(`${path}:`, error);
		new Notice('Не удалось открыть задачу');
	}
};

const handleClickEdit = (task: Task): Promise<void> => openTask(task.path);

/**
 * Галочка в карточке: номер сверху вниз, запись делает карта. На телефоне -
 * короткая вибрация сразу по клику, не дожидаясь записи в файл.
 */
const handleToggle = async (task: Task, index: number): Promise<void> => {
	vibrate();
	await taskMap.toggle(task.path, index);
};

/** Дни недели по ISO: 1 - понедельник. Свои, а не локаль moment: язык Obsidian бывает любым. */
const CARD_WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

/** Месяцы в родительном падеже: «14 июля». */
const CARD_MONTHS = [
	'января',
	'февраля',
	'марта',
	'апреля',
	'мая',
	'июня',
	'июля',
	'августа',
	'сентября',
	'октября',
	'ноября',
	'декабря',
];

/**
 * День в заголовке карточки: «Суббота 14 июля» - день недели, число, месяц
 * (просьба пользователя 14.11.2026; до этого «июль 04 2027»). Год - только если
 * не текущий: «Понедельник 4 октября 2027», иначе дни разных лет не различить.
 * Дата приходит уже строгой `ГГГГ-ММ-ДД`.
 */
const cardDate = (date: string | null): string => {
	if (!date) return 'Без даты';

	const [year, month, day] = date.split('-');
	const weekday = CARD_WEEKDAYS[moment(date, DATE_FORMAT, true).isoWeekday() - 1];
	const text = `${weekday} ${Number(day)} ${CARD_MONTHS[Number(month) - 1]}`;

	return year === todayStr.value.slice(0, 4) ? text : `${text} ${year}`;
};

/**
 * Новая задача: файл с пустыми свойствами сразу открывается на правку, как по
 * кнопке редактирования. В списке он появится, когда заполнят `Задача`.
 */
const handleCreate = async (): Promise<void> => {
	const path = await taskMap.createBlankTask();
	if (path) await openTask(path);
};

let unsubscribe: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;

onMounted(async () => {
	// Подписки до первого await: вкладку могли закрыть, пока идёт индексация.
	unsubscribe = taskMap.onChange(() => {
		todayStr.value = moment().format(DATE_FORMAT);
		tasks.value = taskMap.all();
	});
	unsubscribeSettings = props.plugin.onSettingsChange(() => {
		calendarInList.value = props.plugin.settings.calendarInList;
		doneCollapsed.value = props.plugin.settings.doneCollapsed;
	});

	tasks.value = taskMap.all();
	isLoading.value = tasks.value.length === 0;

	try {
		// Карту обычно поднимает плагин на onLayoutReady. Повторный вызов ничего не
		// делает, но список, открытый раньше этого, не останется пустым.
		await taskMap.start();
	} finally {
		isLoading.value = false;
	}
});

onUnmounted(() => {
	unsubscribe?.();
	unsubscribe = null;
	unsubscribeSettings?.();
	unsubscribeSettings = null;
});
</script>
