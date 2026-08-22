<template>
	<div class="task__calendar-container">
		<div class="task__calendar-calendar">
			<header class="task__calendar-header">
				<button
					:class="[
						'task__calendar-default-button',
						'calendar__header-month-year-button',
						isCurrentMonth && '--is-current-month',
					]"
					@click="handleClickToday"
				>
					{{ monthYearLabel }}
				</button>

				<div class="calendar__header-group-button">
					<button
						class="task__calendar-default-button calendar__header-prev-button"
						@click="handleClickPrev"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M224 480h640a32 32 0 1 1 0 64H224a32 32 0 0 1 0-64"/><path fill="currentColor" d="m237.248 512l265.408 265.344a32 32 0 0 1-45.312 45.312l-288-288a32 32 0 0 1 0-45.312l288-288a32 32 0 1 1 45.312 45.312z"/></svg>
					</button>

					<button
						class="task__calendar-default-button calendar__header-next-button"
						@click="handleClickNext"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M754.752 480H160a32 32 0 1 0 0 64h594.752L521.344 777.344a32 32 0 0 0 45.312 45.312l288-288a32 32 0 0 0 0-45.312l-288-288a32 32 0 1 0-45.312 45.312z"/></svg>
					</button>
				</div>
			</header>

			<div class="task__calendar-grid">
				<header	class="calendar__grid-header">
					<div
						v-for="dayName in weekDays"
						:key="dayName"
						class="week-name"
					>
						{{ dayName }}
					</div>
				</header>

				<main class="calendar__grid-body">
					<button
						v-for="day in calendarDays"
						:key="day.date"
						:class="[
							'task__calendar-default-button',
							'week-day',
							isToday(day.date) && '--is-today',
							!day.isCurrentMonth && '--is-other-month',
							day.date === selectedDate && '--is-focused',
						]"
						@click="handleClickDayNumber(day)"
					>
						<span class="week-day--number">
							{{ day.number }}
						</span>

						<span
							v-if="daysWithTasks.has(day.date)"
							class="week-day--dot"
						></span>
					</button>
				</main>
			</div>
		</div>

		<!--
			Кнопка слева создаёт задачу и открывает файл, кнопка справа - только
			создаёт. Enter отправляет форму, то есть создаёт без перехода: на
			телефоне переход после каждой задачи мешал бы заводить их подряд.
		-->
		<form
			class="task__calendar-create"
			@submit.prevent="handleCreateTask(false)"
		>
			<button
				class="task__calendar-default-button task__calendar-create-button"
				type="button"
				aria-label="Создать задачу и перейти"
				:disabled="isCreateButtonDisabled"
				@click="handleCreateTask(true)"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M768 256H353.6a32 32 0 1 1 0-64H800a32 32 0 0 1 32 32v448a32 32 0 0 1-64 0z"/><path fill="currentColor" d="M777.3 201.3a32 32 0 0 1 45.4 45.4l-544 544a32 32 0 0 1-45.4-45.4z"/></svg>
			</button>

			<input
				ref="taskNameInput"
				v-model="actionText"
				class="task__calendar-create-input"
				type="text"
				enterkeyhint="done"
				:placeholder="`Новая задача на ${selectedDate}`"
			>

			<button
				class="task__calendar-default-button task__calendar-create-button"
				type="submit"
				aria-label="Создать задачу"
				:disabled="isCreateButtonDisabled"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M480 480V128a32 32 0 0 1 64 0v352h352a32 32 0 1 1 0 64H544v352a32 32 0 1 1-64 0V544H128a32 32 0 0 1 0-64z"/></svg>
			</button>
		</form>

		<div
			v-if="isLoading"
			class="task__calendar-tasks-loading"
		>
			Загрузка...
		</div>

		<!--
			Список идёт одним порядком, без разделителей: сначала просроченные,
			потом задачи выбранного дня, в конце выполненные. Группы различает вид
			самой карточки - рамка у просроченной, перечёркнутый текст у выполненной.
		-->
		<div
			v-else
			class="task__calendar-tasks"
		>
			<div
				v-for="card in cards"
				:key="card.task.key"
				:class="['tasks__item', card.modifier]"
			>
				<!--
					Дату меняет штатный календарь браузера: у поля type="date" он
					открывается по showPicker() и сам знает, как выглядеть на телефоне
					и на ПК. Поле рядом с кнопкой, а не спрятано насовсем: невидимому
					элементу showPicker() открыть нечего.
				-->
				<div class="tasks__item-date">
					<button
						class="task__calendar-default-button tasks__item-date-button"
						aria-label="Поменять дату"
						@click="handleClickTaskDate($event)"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M128 384v512h768V192H768v32a32 32 0 1 1-64 0v-32H320v32a32 32 0 0 1-64 0v-32H128v128h768v64zm192-256h384V96a32 32 0 1 1 64 0v32h160a32 32 0 0 1 32 32v768a32 32 0 0 1-32 32H96a32 32 0 0 1-32-32V160a32 32 0 0 1 32-32h160V96a32 32 0 0 1 64 0zm-32 384h64a32 32 0 0 1 0 64h-64a32 32 0 0 1 0-64m0 192h64a32 32 0 1 1 0 64h-64a32 32 0 1 1 0-64m192-192h64a32 32 0 0 1 0 64h-64a32 32 0 0 1 0-64m0 192h64a32 32 0 1 1 0 64h-64a32 32 0 1 1 0-64m192-192h64a32 32 0 1 1 0 64h-64a32 32 0 1 1 0-64m0 192h64a32 32 0 1 1 0 64h-64a32 32 0 1 1 0-64"/></svg>
					</button>

					<input
						class="tasks__item-date-input"
						type="date"
						tabindex="-1"
						aria-hidden="true"
						:value="card.date"
						@change="handleChangeTaskDate(card.task, $event)"
					>
				</div>

				<button
					class="task__calendar-default-button tasks__item-link-button"
					aria-label="Перейти на задачу"
					@click="handleClickTaskLink(card.task)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="m715.6 625.2l-45.2-45.3l90.5-90.6c75-74.9 85.1-186.3 22.7-248.9c-62.6-62.4-174-52.3-249 22.7l-90.4 90.5l-45.3-45.2l90.5-90.5c100-100 252-110.1 339.5-22.7c87.5 87.5 77.3 239.4-22.7 339.5l-90.5 90.5zm-90.4 90.4l-90.5 90.5c-100 100-252 110.1-339.5 22.7c-87.5-87.5-77.3-239.4 22.7-339.5l90.5-90.5l45.2 45.3l-90.5 90.6c-75 74.9-85.1 186.3-22.7 248.9c62.6 62.4 174 52.3 249-22.7l90.5-90.5zm0-362l45.2 45.2l-271.6 271.6l-45.2-45.2z"/></svg>
				</button>

				<TaskBody
					v-if="card.task.body"
					:app="props.plugin.app"
					:markdown="card.task.body"
					:source-path="taskVaultPath(card.task)"
					@toggle-checkbox="handleToggleSubtask(card, $event)"
				/>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, computed } from 'vue';
import type TaskCalendarPlugin from '../TaskCalendarPlugin';
import { Notice, moment } from 'obsidian';
import TaskBody from './TaskBody.vue';
import {
	compareByDate,
	compareByName,
	DATE_FORMAT,
	isOverdue,
	occurrencesInRange,
	parseRepeat,
	showDate,
	Task,
	taskVaultPath,
} from '../taskFormat';

interface CalendarDay {
	number: number;
	date: string;
	isCurrentMonth: boolean;
}

/** Карточка списка: задача, модификатор группы и день, за который она стоит. */
interface TaskCard {
	task: Task;
	modifier: string;
	/**
	 * День карточки. У задач дня, просроченных и выполненных это дата показа
	 * задачи, у расчётного дня череды - сам этот день: отметка закроет его.
	 */
	date: string;
}

const props = defineProps<{
	plugin: TaskCalendarPlugin;
}>();

const taskMap = props.plugin.taskMap;

const currentDate = shallowRef(moment());
/** Все задачи хранилища из карты. */
const tasks = shallowRef<Task[]>([]);
const isLoading = ref(false);
const selectedDate = ref<string>('');
const actionText = ref<string>('');
/**
 * Сегодняшний день. Не константа: календарь держат открытым сутками, и через
 * полночь подсветка иначе осталась бы на вчерашнем дне. Обновляется на каждом
 * изменении карты - события хранилища и так идут постоянно.
 */
const todayStr = ref(moment().format(DATE_FORMAT));
const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthNames = [
	'Январь',
	'Февраль',
	'Март',
	'Апрель',
	'Май',
	'Июнь',
	'Июль',
	'Август',
	'Сентябрь',
	'Октябрь',
	'Ноябрь',
	'Декабрь',
];

const monthYearLabel = computed(() => {
	const month = monthNames[currentDate.value.month()];
	const year = currentDate.value.year();

	return `${month} ${year}`;
});

const isCurrentMonth = computed(() =>
	currentDate.value.month() === moment().month() && currentDate.value.year() === moment().year()
);

const isCreateButtonDisabled = computed((): boolean =>
	!selectedDate.value || !actionText.value.trim()
);

const calendarDays = computed<CalendarDay[]>(() => {
	const startOfMonth = currentDate.value.clone().startOf('month');
	const currentMonth = startOfMonth.month();

	const firstDayOfWeek = startOfMonth.day();
	const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
	const gridStart = startOfMonth.clone().subtract(offset, 'day');

	const days: CalendarDay[] = [];

	for (let i = 0; i < 42; i++) {
		const date = gridStart.clone().add(i, 'day');
		days.push({
			number: date.date(),
			date: date.format(DATE_FORMAT),
			isCurrentMonth: date.month() === currentMonth,
		});
	}

	return days;
});

const isToday = (date: string): boolean => date === todayStr.value;

/**
 * Дни, у которых в файле уже есть свой блок. Череда их перескакивает: такой день
 * показывает свой блок, а не расчёт, иначе на нём было бы две карточки.
 */
const takenDays = computed<Map<string, Set<string>>>(() => {
	const byFile = new Map<string, Set<string>>();

	for (const task of tasks.value) {
		const path = taskVaultPath(task);
		const days = byFile.get(path) ?? new Set<string>();

		days.add(showDate(task));
		byFile.set(path, days);
	}

	return byFile;
});

/**
 * Дни череды повтора внутри видимой сетки - без дня самой задачи.
 *
 * В файле живёт только текущий блок, следующий появляется после закрытия
 * предыдущего. Без расчёта у повторяющейся задачи была бы одна точка, и выбрать
 * следующую субботу, чтобы отметить именно её, было бы негде.
 */
const repeatDays = (task: Task, from: string, to: string): string[] => {
	const repeat = parseRepeat(task.repeat);
	if (!repeat) return [];

	const taken = takenDays.value.get(taskVaultPath(task));

	return occurrencesInRange(showDate(task), repeat, from, to, taken);
};

/**
 * Дни с невыполненными задачами: точка в сетке. Дата точки - `↔️ ?? 📅`, плюс
 * расчётные дни череды повтора. До 📅 задачи не существовало - туда череда не
 * заглядывает.
 */
const daysWithTasks = computed<Set<string>>(() => {
	const days = new Set<string>();
	const grid = calendarDays.value;
	const from = grid[0].date;
	const to = grid[grid.length - 1].date;

	for (const task of tasks.value) {
		if (task.done !== null) continue;

		days.add(showDate(task));

		for (const day of repeatDays(task, from, to)) days.add(day);
	}

	return days;
});

/** Просроченные - в списке любого выбранного дня, чтобы о долге не забыть. */
const overdueTasks = computed<Task[]>(() =>
	tasks.value.filter((task) => isOverdue(task, todayStr.value)).sort(compareByDate)
);

/** Задачи выбранного дня. Просроченная сюда не попадает - она уже в своей группе. */
const selectedTasks = computed<Task[]>(() =>
	tasks.value
		.filter((task) => showDate(task) === selectedDate.value
			&& task.done === null
			&& !isOverdue(task, todayStr.value))
		.sort(compareByName)
);

/**
 * Выполненные в выбранный день - хвост списка. Показываются целиком, вместе с
 * отмеченными чекбоксами: снять галочку это единственный способ вернуть задачу
 * в работу.
 */
const completedTasks = computed<Task[]>(() =>
	tasks.value
		.filter((task) => showDate(task) === selectedDate.value && task.done !== null)
		.sort(compareByName)
);

/**
 * Задачи, у которых на выбранный день приходится расчётный день череды.
 *
 * Карточка такая же, как у задачи дня: отметка на ней закроет именно этот день.
 * Задача, уже показанная в другой группе (чаще всего просроченная - она висит в
 * списке каждого дня), сюда не попадает: один блок - одна карточка на день.
 */
const projectedTasks = computed<Task[]>(() => {
	const day = selectedDate.value;
	if (!day) return [];

	const shown = new Set<string>([
		...overdueTasks.value,
		...selectedTasks.value,
		...completedTasks.value,
	].map((task) => task.key));

	return tasks.value
		.filter((task) => task.done === null
			&& !shown.has(task.key)
			&& repeatDays(task, day, day).length > 0)
		.sort(compareByName);
});

const cards = computed<TaskCard[]>(() => [
	...overdueTasks.value.map((task) => ({
		task,
		modifier: '--is-overdue',
		date: showDate(task),
	})),
	...[...selectedTasks.value, ...projectedTasks.value].sort(compareByName).map((task) => ({
		task,
		modifier: '',
		date: selectedDate.value,
	})),
	...completedTasks.value.map((task) => ({
		task,
		modifier: '--is-done',
		date: showDate(task),
	})),
]);

const handleClickPrev = (): void => {
	currentDate.value = currentDate.value.clone().subtract(1, 'month');
};

const handleClickToday = (): void => {
	currentDate.value = moment();
};

const handleClickNext = (): void => {
	currentDate.value = currentDate.value.clone().add(1, 'month');
};

const handleClickDayNumber = (day: CalendarDay): void => {
	selectedDate.value = day.date;
};

/** Открыть заметку по пути. В режиме правки - вторым аргументом. */
const openNote = async (path: string, edit = false): Promise<void> => {
	try {
		await props.plugin.app.workspace.openLinkText(
			path,
			'',
			false,
			edit ? { state: { mode: 'source' } } : undefined
		);
	} catch (error) {
		console.error(`${path}:`, error);
		new Notice('Не удалось открыть заметку');
	}
};

/** Поле ввода названия новой задачи. */
const taskNameInput = ref<HTMLInputElement | null>(null);

/**
 * Создать задачу на выбранный день: новый файл с 📅 и одним снятым чекбоксом.
 *
 * Открытие идёт отдельным шагом после создания - не открывшаяся вкладка не повод
 * говорить, что задачу не создали.
 */
const handleCreateTask = async (open: boolean): Promise<void> => {
	if (isCreateButtonDisabled.value) return;

	const path = await taskMap.createTask(selectedDate.value, actionText.value);
	if (!path) return;

	actionText.value = '';

	if (open) await openNote(path, true);
};

const handleClickTaskLink = async (task: Task): Promise<void> => {
	await openNote(taskVaultPath(task), true);
};

/**
 * Открыть штатный календарь браузера. Поле лежит рядом с кнопкой, поэтому окно
 * выбора встаёт у карточки; на телефоне системный выбор даты и так во весь экран.
 *
 * showPicker() бросает исключение, если поле не отрисовано или вызов пришёл не от
 * действия пользователя - тогда остаётся обычный клик по полю.
 */
const handleClickTaskDate = (event: MouseEvent): void => {
	const button = event.currentTarget as HTMLElement | null;
	const input = button?.parentElement?.querySelector<HTMLInputElement>('.tasks__item-date-input');
	if (!input) return;

	const picker = input as HTMLInputElement & { showPicker?: () => void };

	try {
		if (typeof picker.showPicker === 'function') picker.showPicker();
		else input.click();
	} catch (error) {
		console.error('Не открылся выбор даты:', error);
		input.click();
	}
};

/**
 * Перенести задачу на выбранную дату. Задаче с 🔁 карта пишет ↔️, задаче без
 * повтора двигает саму 📅 - решает это карта, здесь только новая дата.
 */
const handleChangeTaskDate = async (task: Task, event: Event): Promise<void> => {
	const value = (event.target as HTMLInputElement).value;
	if (!value) return;

	await taskMap.moveTask(task.key, value);
};

/**
 * Галочка подзадачи: номер чекбокса сверху вниз, запись делает карта.
 *
 * День карточки передаётся вместе с номером: отметили расчётный день череды -
 * карта закроет именно его, а не тот, на котором блок стоит сейчас.
 */
const handleToggleSubtask = async (card: TaskCard, index: number): Promise<void> => {
	await taskMap.toggleCheckbox(card.task.key, index, card.date);
};

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
	// Подписка до первого await: вкладку могли закрыть, пока идёт индексация.
	unsubscribe = taskMap.onChange(() => {
		todayStr.value = moment().format(DATE_FORMAT);
		tasks.value = taskMap.all();
	});

	selectedDate.value = todayStr.value;
	tasks.value = taskMap.all();

	isLoading.value = tasks.value.length === 0;

	try {
		// Карту обычно поднимает плагин на onLayoutReady. Повторный вызов ничего не
		// делает, но календарь, открытый раньше этого, не останется пустым.
		await taskMap.start();
	} finally {
		isLoading.value = false;
	}
});

onUnmounted(() => {
	unsubscribe?.();
	unsubscribe = null;
});
</script>
