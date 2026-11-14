<template>
	<div class="task__calendar-list">
		<!--
			Календарь сверху всегда (просьба пользователя 14.11.2026, отдельного
			календаря больше нет). Режим задаёт свитч «Календарь в списке»: выключен -
			клик по дню выбирает его, под календарём задачи выбранного дня; включён -
			день не выбирается (без selectedDate ячейки не кнопки), под календарём
			100 ближайших невыполненных задач.
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
			Пустой день ничего не пишет (просьба пользователя 13.11.2026): точек в
			календаре на нём и так нет.
		-->
		<div
			v-else-if="!isDayMode && shownTasks.length === 0"
			class="task__calendar-list-empty"
		>
			Задач нет
		</div>

		<!--
			Карточки одним списком, без групп: задачи выбранного дня (`dayTasks`) или
			100 ближайших невыполненных (`openTasks`).
		-->
		<div
			v-if="shownTasks.length > 0"
			class="task__calendar-list-cards"
		>
			<article
				v-for="task in shownTasks"
				:key="task.path"
				:class="['tasks__item', modifierOf(task)]"
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
 * 14.11.2026). Выполненные не показываются - их тысячи; они остаются в файлах и
 * в днях календаря.
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
 * Тело карточки - список: сама задача и подзадачи с отступом. Галочки идут в
 * том же порядке, в каком их номера отдаёт `TaskBody`: 0 - задача, дальше
 * подзадачи.
 */
const bodyOf = (task: Task): string => [
	`- ${checkbox(task.checked)} ${oneLine(task.text)}`,
	...task.subtasks.map((subtask) => `\t- ${checkbox(subtask.checked)} ${oneLine(subtask.text)}`),
].join('\n');

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

const CARD_MONTHS = [
	'январь',
	'февраль',
	'март',
	'апрель',
	'май',
	'июнь',
	'июль',
	'август',
	'сентябрь',
	'октябрь',
	'ноябрь',
	'декабрь',
];

/**
 * День в заголовке карточки: «июль 04 2027» - месяц словом, число двумя
 * цифрами, год (просьба пользователя 14.11.2026). Дата приходит уже строгой
 * `ГГГГ-ММ-ДД`.
 */
const cardDate = (date: string | null): string => {
	if (!date) return 'Без даты';

	const [year, month, day] = date.split('-');

	return `${CARD_MONTHS[Number(month) - 1]} ${day} ${year}`;
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
