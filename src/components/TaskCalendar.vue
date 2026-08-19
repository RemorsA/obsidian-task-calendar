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
							v-if="daysWithTasks[day.date]"
							class="week-day--dot"
						></span>
					</button>
				</main>
			</div>
		</div>

		<form
			class="task__calendar-create"
			@submit.prevent="handleCreateTask"
		>
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

		<div class="task__calendar-tasks">
			<!--
				Список идёт одним порядком, без разделителей: сначала просроченные,
				потом задачи выбранного дня, в конце закрытые.

				Просроченные - только на сегодняшнем дне: они здесь, чтобы о долге не
				забыть, а не чтобы висеть в каждой дате. Отличает их рамка, а закрывает
				карточка свой пропущенный день, а не сегодняшнее число.
			-->
			<div
				v-for="task in overdueTasks"
				:key="`overdue-${task.link}`"
				class="tasks__item --is-overdue"
			>
				<button
					class="task__calendar-default-button tasks__item-link-button"
					aria-label="Перейти на задачу"
					@click="handleClickTaskLink(task)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="m715.6 625.2l-45.2-45.3l90.5-90.6c75-74.9 85.1-186.3 22.7-248.9c-62.6-62.4-174-52.3-249 22.7l-90.4 90.5l-45.3-45.2l90.5-90.5c100-100 252-110.1 339.5-22.7c87.5 87.5 77.3 239.4-22.7 339.5l-90.5 90.5zm-90.4 90.4l-90.5 90.5c-100 100-252 110.1-339.5 22.7c-87.5-87.5-77.3-239.4 22.7-339.5l90.5-90.5l45.2 45.3l-90.5 90.6c-75 74.9-85.1 186.3-22.7 248.9c62.6 62.4 174 52.3 249-22.7l90.5-90.5zm0-362l45.2 45.2l-271.6 271.6l-45.2-45.2z"/></svg>
				</button>

				<TaskBody
					v-if="task.body"
					:app="props.plugin.app"
					:markdown="task.body"
					:source-path="task.link"
					@toggle-checkbox="handleToggleSubtask(task, $event)"
				/>
			</div>

			<div
				v-for="task in selectedTasks"
				:key="task.link"
				class="tasks__item"
			>
				<button
					class="task__calendar-default-button tasks__item-link-button"
					aria-label="Перейти на задачу"
					@click="handleClickTaskLink(task)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="m715.6 625.2l-45.2-45.3l90.5-90.6c75-74.9 85.1-186.3 22.7-248.9c-62.6-62.4-174-52.3-249 22.7l-90.4 90.5l-45.3-45.2l90.5-90.5c100-100 252-110.1 339.5-22.7c87.5 87.5 77.3 239.4-22.7 339.5l-90.5 90.5zm-90.4 90.4l-90.5 90.5c-100 100-252 110.1-339.5 22.7c-87.5-87.5-77.3-239.4 22.7-339.5l90.5-90.5l45.2 45.3l-90.5 90.6c-75 74.9-85.1 186.3-22.7 248.9c62.6 62.4 174 52.3 249-22.7l90.5-90.5zm0-362l45.2 45.2l-271.6 271.6l-45.2-45.2z"/></svg>
				</button>

				<TaskBody
					v-if="task.body"
					:app="props.plugin.app"
					:markdown="task.body"
					:source-path="task.link"
					@toggle-checkbox="handleToggleSubtask(task, $event)"
				/>
			</div>

			<!--
				Закрытые в этот день - в конце списка, одной строкой: чекбоксы тела
				при закрытии сброшены, отмечать в нём нечего, и от задачи остаётся
				текст только первого - родительского - чекбокса.

				Сам чекбокс отмечен по журналу «Выполнено», а не по телу, и он же
				кнопка отмены: клик убирает день из журнала. Разметка та же, что у
				рендера тела, чтобы чекбокс выглядел ровно как в самой задаче.
			-->
			<div
				v-for="task in completedTasks"
				:key="task.link"
				class="tasks__item --is-done"
			>
				<button
					class="task__calendar-default-button tasks__item-link-button"
					aria-label="Перейти на задачу"
					@click="handleClickTaskLink(task)"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="m715.6 625.2l-45.2-45.3l90.5-90.6c75-74.9 85.1-186.3 22.7-248.9c-62.6-62.4-174-52.3-249 22.7l-90.4 90.5l-45.3-45.2l90.5-90.5c100-100 252-110.1 339.5-22.7c87.5 87.5 77.3 239.4-22.7 339.5l-90.5 90.5zm-90.4 90.4l-90.5 90.5c-100 100-252 110.1-339.5 22.7c-87.5-87.5-77.3-239.4 22.7-339.5l90.5-90.5l45.2 45.3l-90.5 90.6c-75 74.9-85.1 186.3-22.7 248.9c62.6 62.4 174 52.3 249-22.7l90.5-90.5zm0-362l45.2 45.2l-271.6 271.6l-45.2-45.2z"/></svg>
				</button>

				<div class="tasks__item-body markdown-preview-view markdown-rendered">
					<ul class="contains-task-list">
						<li
							class="task-list-item is-checked"
							data-task="x"
						>
							<input
								class="task-list-item-checkbox"
								type="checkbox"
								checked
								aria-label="Отменить выполнение"
								@click.prevent="handleCancelTask(task)"
							>

							<span class="tasks__item-title">{{ task.title }}</span>
						</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, computed } from 'vue';
import type TaskCalendarPlugin from '../TaskCalendarPlugin';
import { Notice, TAbstractFile, TFile, debounce, moment } from 'obsidian';
import TaskBody from './TaskBody.vue';
import {
	buildTaskNote,
	clearBodyChecks,
	collapseBodyBlocks,
	DATE_FORMAT,
	extractBody,
	extractLists,
	FIELD,
	firstCheckboxText,
	firstPendingUpTo,
	hasCheckboxes,
	isBodyComplete,
	isDoneOn,
	pendingDays,
	getDoneTasksForDate,
	getOverdueTasks,
	getTasksForDate,
	normalizeDate,
	readTaskNote,
	SelectedTask,
	TaskNote,
	taskNoteFileName,
	toggleBodyCheckbox,
} from '../taskFormat';

interface CalendarDay {
	number: number;
	date: string;
	isCurrentMonth: boolean;
}

const props = defineProps<{
	plugin: TaskCalendarPlugin;
}>();

const currentDate = shallowRef(moment());
/** Все заметки-задачи из папки настроек. */
const taskNotes = shallowRef<TaskNote[]>([]);
/** Задачи выбранного дня: наименование, путь до файла и текст после свойств. */
const selectedTasks = ref<SelectedTask[]>([]);
/**
 * Просроченные - с незакрытым днём в прошлом. Показываются только на сегодняшнем
 * дне, над задачами дня: это напоминание о долге, а не содержимое даты.
 */
const overdueTasks = ref<SelectedTask[]>([]);
/** Закрытые в выбранный день - хвост списка, одной строкой. */
const completedTasks = ref<SelectedTask[]>([]);
const isLoading = ref(false);
const selectedDate = ref<string>('');
const actionText = ref<string>('');
/**
 * Сегодняшний день. Не константа: календарь держат открытым сутками, и через
 * полночь подсветка иначе осталась бы на вчерашнем дне. Обновляется на каждом
 * пересчёте - события хранилища и так идут постоянно.
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

/** Путь без ведущих и замыкающих слэшей: '/' -> '', 'a/b/' -> 'a/b'. */
const normalizeFolderPath = (path: string): string => path.replace(/^\/+|\/+$/g, '');

/**
 * Папка с задачами из настроек. Намеренно ref, а не computed: настройки плагина -
 * обычный объект, Vue за ним не следит, и вычисляемое значение навсегда осталось
 * бы первым, до перезапуска плагина. Обновляется по событию от плагина.
 */
const tasksFolderPath = ref(normalizeFolderPath(props.plugin.settings.tasksFolderPath));

const isToday = (date: string): boolean => date === todayStr.value;

/**
 * Файл лежит в папке задач. Сравнение по границе пути, а не подстрокой: иначе
 * папка «Задачи» цепляла бы и «Старые Задачи», и файл «Задачи.md» где угодно.
 * Пустой путь в настройках - всё хранилище.
 */
const isInTasksFolder = (path: string): boolean =>
	tasksFolderPath.value === '' || path.startsWith(`${tasksFolderPath.value}/`);

/**
 * Дни сетки, на которых есть невыполненные задачи. Считается разом на все 42
 * дня, чтобы не звать разбор из шаблона.
 */
const daysWithTasks = computed<Record<string, boolean>>(() =>
	pendingDays(taskNotes.value, calendarDays.value.map((day) => day.date))
);

const handleClickPrev = (): void => {
	currentDate.value = currentDate.value.clone().subtract(1, 'month');
};

const handleClickToday = (): void => {
	currentDate.value = moment();
};

const handleClickNext = (): void => {
	currentDate.value = currentDate.value.clone().add(1, 'month');
};

const handleClickDayNumber = async (day: CalendarDay): Promise<void> => {
	selectedDate.value = day.date;

	await loadSelectedTasks(day.date);
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

/** Открыть заметку задачи. */
const openTaskNote = async (task: SelectedTask, edit = false): Promise<void> => {
	await openNote(task.link, edit);
};

/** Поле ввода названия новой задачи - кнопка в шапке ставит в него курсор. */
const taskNameInput = ref<HTMLInputElement | null>(null);

/**
 * Создать задачу на выбранный день.
 *
 * Имя файла - «дата - название», свойства заполнены по шаблону, в теле один
 * снятый чекбокс с названием. Созданная заметка **сразу открывается на правку**:
 * шаблон это только заготовка, дальше в неё вписывают подзадачи и повтор.
 *
 * Заметка с таким именем уже есть - ничего не перезаписываем и не открываем,
 * только говорим об этом: задачу с этим названием на этот день уже заводили.
 */
const handleCreateTask = async (): Promise<void> => {
	if (isCreateButtonDisabled.value) return;

	const name = actionText.value.trim();
	const fileName = taskNoteFileName(selectedDate.value, name);

	// От названия из одних запрещённых символов не остаётся ничего.
	if (!fileName) {
		new Notice('Не получилось имя файла из этого названия');

		return;
	}

	const { vault } = props.plugin.app;
	const folder = tasksFolderPath.value;
	const path = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

	if (vault.getAbstractFileByPath(path)) {
		new Notice('Такая задача уже есть');

		return;
	}

	try {
		await vault.create(path, buildTaskNote(selectedDate.value, name));
		actionText.value = '';
	} catch (error) {
		console.error(`${path}:`, error);
		new Notice('Не удалось создать задачу');

		return;
	}

	// Открытие - отдельно от создания: заметка уже есть, и не открывшаяся вкладка
	// не повод говорить, что задачу не создали.
	await openNote(path, true);
};

const handleClickTaskLink = async (task: SelectedTask): Promise<void> => {
	await openTaskNote(task, true);
};

/**
 * Записать или снять день в журнале «Выполнено».
 *
 * Журнал - единственное место, где живёт выполнение: по нему календарь и решает,
 * закрыта задача на выбранную дату или нет. День дописывается, когда отмечены все
 * чекбоксы тела, и убирается по отмене из хвоста «Выполнено».
 *
 * Сравнение через normalizeDate: в свойстве день мог быть записан объектом Date
 * или с временем, и построчное сравнение промахнулось бы.
 */
const syncDoneForDay = async (note: TaskNote, day: string, complete: boolean): Promise<void> => {
	const file = taskFiles.get(note.link);
	if (!file) return;

	// Уже так и записано - файл не трогаем, иначе каждая галочка била бы в диск.
	if (isDoneOn(note, day) === complete) return;

	const target = complete
		? [...note.done.filter((item) => item !== day), day]
		: note.done.filter((item) => item !== day);

	// Ту же запись уже сделали, кэш свойств просто ещё не догнал.
	if (writtenDone.get(note.link) === doneKey(target)) return;

	try {
		writtenDone.set(note.link, doneKey(target));

		await props.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const done = frontmatter[FIELD.done];
			const dates = Array.isArray(done) ? done : (done ? [done] : []);
			const rest = dates.filter((item: unknown) => normalizeDate(item) !== day);

			frontmatter[FIELD.done] = complete ? [...rest, day] : rest;
		});
	} catch (error) {
		writtenDone.delete(note.link);
		console.error(`${note.link}:`, error);
		new Notice('Не удалось записать выполнение');
	}
};

/**
 * Снять все галочки в теле заметки. Отдаёт `true`, если тело после этого чистое.
 *
 * Тело задачи это черновик одного захода: закрыли день - он ушёл в «Выполнено», а
 * чекбоксы освободились под следующий раз. Убрали день из журнала - сбрасываются
 * тоже, даже если часть галочек стояла: состояние задаёт журнал, а не тело.
 *
 * Читаем свежий текст, а не `cachedRead`: дальше по нему пишем, а заметку могли
 * поменять в редакторе.
 *
 * Успех возвращается, потому что от него зависит запись журнала: остались бы
 * отмеченные чекбоксы при тронутом журнале - следующий скан снова счёл бы задачу
 * выполненной и закрыл ещё один день, и так до конца череды.
 */
const clearChecksInFile = async (note: TaskNote): Promise<boolean> => {
	const file = taskFiles.get(note.link);
	if (!file) return false;

	const { vault } = props.plugin.app;

	try {
		const content = await vault.read(file);
		// Заодно сворачиваем старые блоки `## дата`: пишем в тело всё равно, а
		// показан в карточке свёрнутый набор - пусть и в файле будет он же.
		const collapsed = collapseBodyBlocks(content) ?? content;
		const updated = clearBodyChecks(collapsed) ?? collapsed;

		// Ничего не изменилось - файл не трогаем, иначе каждый скан бил бы в диск.
		if (updated !== content) await vault.modify(file, updated);
	} catch (error) {
		console.error(`${note.link}:`, error);
		new Notice('Не удалось сбросить подзадачи');

		return false;
	}

	return true;
};

/**
 * Галочка подзадачи в теле заметки. Правится ровно одна строка файла, поэтому
 * читаем свежий текст, а не `cachedRead`: между отрисовкой и кликом заметку
 * могли поменять в редакторе.
 *
 * Отмечены все - день карточки уходит в «Выполнено», а чекбоксы сбрасываются
 * тем же письмом: набор в теле один, и следующему разу он нужен чистым. День
 * берётся у карточки, а не из выбранной даты: у просроченной это её пропущенный
 * день.
 *
 * Снятая галочка из журнала ничего не убирает: закрытый день в списке
 * невыполненных не показывается, отменяют его кликом по хвосту «Выполнено».
 */
const handleToggleSubtask = async (task: SelectedTask, index: number): Promise<void> => {
	const file = taskFiles.get(task.link);
	const note = taskNotes.value.find((item) => item.link === task.link);
	const day = task.date;
	if (!file || !note || !day) return;

	const { vault } = props.plugin.app;
	let complete = false;

	try {
		const content = await vault.read(file);
		// Заметка со старыми блоками `## дата` сворачивается перед правкой: в
		// карточке показан свёрнутый набор, по нему и считаются номера чекбоксов.
		const prepared = collapseBodyBlocks(content) ?? content;
		const toggled = toggleBodyCheckbox(prepared, index);

		// Чекбокса с таким номером в файле нет - писать нечего.
		if (toggled === null) return;

		complete = isBodyComplete(extractBody(toggled));

		const updated = complete ? clearBodyChecks(toggled) ?? toggled : toggled;

		await vault.modify(file, updated);

		/*
		 * Разметку карточки обновляем сразу, не дожидаясь пересчёта: галочку
		 * ставит не браузер, а текст заметки (см. `preventDefault` в TaskBody), и
		 * без этого до конца debounce карточка стояла бы в прежнем виде.
		 *
		 * Заодно снимается старая беда просроченных: после закрытия дня галочки в
		 * файле сброшены, но у следующего долга разметка ровно та же, перерисовки
		 * не случалось - и галочка оставалась стоять до второго клика.
		 */
		task.body = extractLists(extractBody(updated));
	} catch (error) {
		console.error(`${task.link}:`, error);
		new Notice('Не удалось отметить подзадачу');

		return;
	}

	if (complete) await syncDoneForDay(note, day, true);
};

/**
 * Отменить выполнение закрытой задачи - клик по её отмеченному чекбоксу.
 *
 * Снять галочку в теле больше нельзя: при закрытии дня чекбоксы сбрасываются, и
 * тело о выполнении ничего не знает. Поэтому день убирается из журнала, а тело
 * приводится к чистому виду - на случай, если галочки успели наставить снова.
 *
 * Сначала тело, потом журнал: не вышло сбросить - лучше оставить всё как было,
 * чем открыть день с полностью отмеченным телом. Иначе следующий же скан счёл бы
 * задачу выполненной и закрыл день обратно.
 */
const handleCancelTask = async (task: SelectedTask): Promise<void> => {
	const note = taskNotes.value.find((item) => item.link === task.link);
	if (!note) return;

	if (!await clearChecksInFile(note)) return;

	await syncDoneForDay(note, task.date, false);
};

/**
 * Закрыть задачу по отметке в самой заметке.
 *
 * Отмечать можно не только из календаря: галочки ставят руками в редакторе или
 * они прилетают синхронизацией с другого устройства. Поэтому после каждого
 * пересчёта тело читается заново, и полностью отмеченное закрывает свой день.
 *
 * Своей даты у чекбоксов больше нет - блоки итераций не заводятся. Закрывается
 * **самый ранний непокрытый день, не позже сегодня**: в заметке отмечают то, что
 * уже сделали, и старый долг закрывается раньше свежего. Будущий день так не
 * закрыть - для этого есть клик по нему в календаре.
 *
 * Тело **без чекбоксов пропускается**: «отмечать нечем» это не «выполнено».
 * Иначе задача без чекбоксов получала бы закрытие на пустом месте.
 *
 * Задачу на паузе («Стоп повтор») не трогаем: пауза на то и пауза, чтобы плагин
 * в неё не лез.
 *
 * Зацикливания нет: своя же запись поднимает `modify` и новый скан, но чекбоксы
 * к тому времени сброшены, и второй проход ничего не находит.
 */
const syncDoneFromBody = async (note: TaskNote): Promise<void> => {
	const file = taskFiles.get(note.link);
	if (!file || note.stopped) return;

	let body: string;

	try {
		const content = await props.plugin.app.vault.cachedRead(file);

		// Старые блоки `## дата` в счёт не идут: считаем по свёрнутому набору,
		// иначе «отмечены все» никогда не сойдётся - прошлые дни тянут за собой
		// свои галочки.
		body = extractBody(collapseBodyBlocks(content) ?? content);
	} catch (error) {
		console.error(`${note.link}:`, error);

		return;
	}

	if (!hasCheckboxes(body) || !isBodyComplete(body)) return;

	const day = firstPendingUpTo(note, todayStr.value);

	// Закрывать нечего: всё до сегодня уже в журнале, а будущее - не отсюда.
	if (!day) return;

	// Сначала тело, потом журнал: не вышло сбросить чекбоксы - день не закрываем.
	// Иначе следующий скан снова увидел бы отмеченное тело и закрыл ещё один
	// день, и так до конца череды повторов.
	if (!await clearChecksInFile(note)) return;

	await syncDoneForDay(note, day, true);
};

/** Файлы задач по пути - чтобы дочитывать тело только для выбранного дня. */
const taskFiles = new Map<string, TFile>();

/**
 * Разобранные заметки по пути. Ключ проверки - сам объект свойств из кэша
 * Obsidian: он остаётся тем же, пока файл не менялся, поэтому при тысяче задач
 * скан заново разбирает только то, что действительно тронули.
 */
const noteCache = new Map<string, { frontmatter: unknown; note: TaskNote | null }>();

/**
 * Журнал, который мы только что записали: путь -> состав «Выполнено».
 *
 * Своя же запись поднимает `modify` раньше, чем обновится кэш свойств, и скан со
 * старым кэшем попросил бы записать то же самое второй раз. Память живёт до тех
 * пор, пока кэш не догонит запись.
 */
const writtenDone = new Map<string, string>();

const doneKey = (dates: string[]): string => [...dates].sort().join('|');

/** Номер последнего запроса задач: ответ на устаревший клик отбрасывается. */
let selectionToken = 0;

/**
 * Задачи выбранного дня. Свойства уже разобраны при скане, здесь дочитывается
 * только тело - текст после блока свойств.
 *
 * Три списка сразу: просроченные над днём, задачи дня и закрытые в этот день.
 * Тело читается всем троим одним и тем же способом - закрытой оно нужно, чтобы
 * взять текст родительского чекбокса для подписи.
 */
const loadSelectedTasks = async (date: string): Promise<void> => {
	const token = ++selectionToken;
	const { vault } = props.plugin.app;
	const notes = getTasksForDate(taskNotes.value, date);

	// Просроченные - только на сегодняшнем дне: карточка напоминает о долге, а не
	// рассказывает, что было в выбранной дате.
	const missed = date === todayStr.value ? getOverdueTasks(taskNotes.value, date) : [];

	/**
	 * Карточка задачи на день: списки тела и текст первого чекбокса.
	 *
	 * `day` у просроченной - её пропущенный день, а не выбранная дата: закрывать
	 * карточка будет именно его.
	 */
	const withBody = async (note: TaskNote, day: string): Promise<SelectedTask> => {
		const file = taskFiles.get(note.link);
		let body = '';
		let title: string | null = null;

		if (file) {
			try {
				const content = await vault.cachedRead(file);
				// Старые блоки `## дата` сворачиваются в один набор: иначе в карточке
				// показались бы чекбоксы всех дней разом.
				const text = extractBody(collapseBodyBlocks(content) ?? content);

				// В списке дня показываются только списки заметки - что делать.
				// Абзацы, заголовки и выноски отбрасываются: за ними в саму заметку.
				body = extractLists(text);
				title = firstCheckboxText(text);
			} catch (error) {
				console.error(`${note.link}:`, error);
			}
		}

		// Чекбоксов в теле нет - подписываем закрытую наименованием задачи.
		return { task: note.task, link: note.link, date: day, body, title: title ?? note.task };
	};

	const tasks = await Promise.all(notes.map((note) => withBody(note, date)));
	const overdue = await Promise.all(missed.map((item) => withBody(item.note, item.date)));
	const completed = await Promise.all(
		getDoneTasksForDate(taskNotes.value, date).map((note) => withBody(note, date))
	);

	// Пока читались тела, пользователь мог кликнуть по другой дате.
	if (token !== selectionToken) return;

	selectedTasks.value = tasks;
	overdueTasks.value = overdue;
	completedTasks.value = completed;
};

const updateTasks = async () => {
	const { vault, metadataCache } = props.plugin.app;

	todayStr.value = moment().format(DATE_FORMAT);

	const files = vault.getMarkdownFiles().filter((file) => isInTasksFolder(file.path));
	const notes: TaskNote[] = [];

	taskFiles.clear();

	const scanned = new Set<string>();
	/**
	 * Заметки, у которых из «Выполнено» пропал день. Убрать дату руками в
	 * редакторе - то же, что отменить выполнение: чекбоксы тела сбрасываются, даже
	 * если часть галочек стояла.
	 */
	const uncompleted: TaskNote[] = [];

	for (const file of files) {
		scanned.add(file.path);

		const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
		const cached = noteCache.get(file.path);
		const entry = cached && cached.frontmatter === frontmatter
			? cached
			: { frontmatter, note: readTaskNote(file.path, file.basename, frontmatter) };

		noteCache.set(file.path, entry);

		if (!entry.note) continue;

		// Сравнивать есть с чем только со второго скана: до него журнал не с чем
		// сверять, и сбрасывать чекбоксы было бы не за что.
		const before = cached?.note?.done;
		const after = entry.note.done;

		if (before && before.some((day) => !after.includes(day))) uncompleted.push(entry.note);

		notes.push(entry.note);
		taskFiles.set(entry.note.link, file);

		// Кэш свойств догнал нашу запись - память о ней больше не нужна.
		if (writtenDone.get(file.path) === doneKey(entry.note.done)) {
			writtenDone.delete(file.path);
		}
	}

	// Файлы, которых больше нет, из кэшей не держим. Сверяемся с набором путей, а
	// не поиском по списку: при тысяче файлов перебор внутри перебора уже заметен.
	for (const path of noteCache.keys()) {
		if (scanned.has(path)) continue;

		noteCache.delete(path);
		writtenDone.delete(path);
	}

	taskNotes.value = notes;

	// Сверяем журнал с телом только у тронутых заметок: читать тело всех задач
	// на каждое событие хранилища накладно. Пустой набор - первый скан или смена
	// папки, тогда сверяем всё.
	const touched = changedPaths.size > 0
		? notes.filter((note) => changedPaths.has(note.link))
		: notes;

	changedPaths.clear();

	// Список дня рисуется раньше сверки: на первом скане сверять приходится все
	// задачи, и при тысяче заметок календарь иначе ждал бы тысячу чтений.
	await loadSelectedTasks(selectedDate.value);

	for (const note of uncompleted) await clearChecksInFile(note);

	await syncNotes(touched);
};

/** Сколько заметок читаем одновременно: диск любит очередь, но не по одной. */
const SYNC_CHUNK = 20;

/**
 * Сверить пачку заметок с их телами. Читаем группами, а не по одной и не все
 * разом: на тысяче задач последовательное чтение растягивается, а одновременное
 * упирается в диск.
 */
const syncNotes = async (notes: TaskNote[]): Promise<void> => {
	for (let i = 0; i < notes.length; i += SYNC_CHUNK) {
		await Promise.all(notes.slice(i, i + SYNC_CHUNK).map(syncDoneFromBody));
	}
};

const scheduleTasksUpdate = debounce(() => { updateTasks(); }, 300, true);

/**
 * Файлы, изменившиеся с прошлого пересчёта. Копятся, пока debounce ждёт, и
 * говорят, у каких задач стоит перечитать тело.
 */
const changedPaths = new Set<string>();

let unregisterEvents: (() => void) | null = null;

/**
 * Любое изменение файла в папке задач. Для переименования и перемещения приходит
 * ещё и старый путь: файл могли как принести в папку, так и унести из неё, и в
 * обоих случаях календарь нужно пересчитать.
 */
const handleFileChange = (file: TAbstractFile, oldPath?: string) => {
	if (isInTasksFolder(file.path) || (oldPath !== undefined && isInTasksFolder(oldPath))) {
		changedPaths.add(file.path);
		scheduleTasksUpdate();
	}
};

onMounted(async () => {
	const { vault, metadataCache } = props.plugin.app;

	vault.on('modify', handleFileChange);
	vault.on('create', handleFileChange);
	vault.on('delete', handleFileChange);
	vault.on('rename', handleFileChange);
	metadataCache.on('changed', handleFileChange);

	// Сменили папку в настройках - перечитываем задачи, не дожидаясь перезапуска.
	const unsubscribeSettings = props.plugin.onSettingsChange(() => {
		tasksFolderPath.value = normalizeFolderPath(props.plugin.settings.tasksFolderPath);
		scheduleTasksUpdate();
	});

	unregisterEvents = () => {
		scheduleTasksUpdate.cancel();
		changedPaths.clear();
		unsubscribeSettings();
		vault.off('modify', handleFileChange);
		vault.off('create', handleFileChange);
		vault.off('delete', handleFileChange);
		vault.off('rename', handleFileChange);
		metadataCache.off('changed', handleFileChange);
	};

	selectedDate.value = todayStr.value;

	isLoading.value = true;

	try {
		await updateTasks();
	} finally {
		isLoading.value = false;
	}
});

onUnmounted(() => {
	unregisterEvents?.();
	unregisterEvents = null;
});
</script>
