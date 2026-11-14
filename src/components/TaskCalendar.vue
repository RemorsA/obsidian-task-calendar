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
						aria-label="Предыдущий месяц"
						@click="handleClickPrev"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M224 480h640a32 32 0 1 1 0 64H224a32 32 0 0 1 0-64"/><path fill="currentColor" d="m237.248 512l265.408 265.344a32 32 0 0 1-45.312 45.312l-288-288a32 32 0 0 1 0-45.312l288-288a32 32 0 1 1 45.312 45.312z"/></svg>
					</button>

					<button
						class="task__calendar-default-button calendar__header-next-button"
						aria-label="Следующий месяц"
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

				<!--
					В правой панели календарь только показывает: день не выбирается,
					ячейка - не кнопка.

					В списке (настройка «Календарь в списке») список передаёт выбранный
					день: ячейка - кнопка, клик выбирает день, выбранный помечен
					--is-focused, как до версии 1.0.1.
				-->
				<main class="calendar__grid-body">
					<component
						:is="isSelectable ? 'button' : 'div'"
						v-for="day in calendarDays"
						:key="day.date"
						:type="isSelectable ? 'button' : undefined"
						:aria-pressed="isSelectable ? day.date === props.selectedDate : undefined"
						:class="[
							isSelectable && 'task__calendar-default-button',
							'week-day',
							isToday(day.date) && '--is-today',
							!day.isCurrentMonth && '--is-other-month',
							isSelectable && day.date === props.selectedDate && '--is-focused',
						]"
						@click="handleClickDay(day)"
					>
						<span class="week-day--number">
							{{ day.number }}
						</span>

						<span
							v-if="daysWithTasks.has(day.date)"
							class="week-day--dot"
						></span>
					</component>
				</main>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, computed } from 'vue';
import type TaskCalendarPlugin from '../TaskCalendarPlugin';
import { moment } from 'obsidian';
import {
	DATE_FORMAT,
	occurrencesInRange,
	parseRepeat,
	showDate,
	Task,
} from '../taskFormat';

interface CalendarDay {
	number: number;
	date: string;
	isCurrentMonth: boolean;
}

const props = defineProps<{
	plugin: TaskCalendarPlugin;
	/**
	 * Выбранный день `ГГГГ-ММ-ДД` - его передаёт список, в котором стоит
	 * календарь. Не передан (правая панель) - день не выбирается.
	 */
	selectedDate?: string;
}>();

const emit = defineEmits<{
	(event: 'select', date: string): void;
}>();

const isSelectable = computed((): boolean => props.selectedDate !== undefined);

const taskMap = props.plugin.taskMap;

const currentDate = shallowRef(moment());
/** Все задачи хранилища из карты. */
const tasks = shallowRef<Task[]>([]);
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
 * Дни с невыполненными задачами: точка в сетке. День точки - день показа
 * задачи, плюс будущие дни повтора внутри видимой сетки: в хранилище лежит
 * только текущий файл повтора, и без расчёта у повторяющейся задачи была бы одна
 * точка. До `Дата и время` повтор не заглядывает - задачи тогда ещё не было.
 */
const daysWithTasks = computed<Set<string>>(() => {
	const days = new Set<string>();
	const grid = calendarDays.value;
	const from = grid[0].date;
	const to = grid[grid.length - 1].date;

	for (const task of tasks.value) {
		if (task.doneDate !== null) continue;

		const day = showDate(task);
		if (day) days.add(day);

		const repeat = parseRepeat(task.repeat);
		if (!repeat || !task.date) continue;

		for (const next of occurrencesInRange(task.date, repeat, from, to)) days.add(next);
	}

	return days;
});

const handleClickPrev = (): void => {
	currentDate.value = currentDate.value.clone().subtract(1, 'month');
};

const handleClickToday = (): void => {
	currentDate.value = moment();
};

const handleClickNext = (): void => {
	currentDate.value = currentDate.value.clone().add(1, 'month');
};

/** Выбрать день - только в списке; какой день выбран, держит сам список. */
const handleClickDay = (day: CalendarDay): void => {
	if (!isSelectable.value) return;

	emit('select', day.date);
};

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
	// Подписка до первого await: панель могли закрыть, пока идёт индексация.
	unsubscribe = taskMap.onChange(() => {
		todayStr.value = moment().format(DATE_FORMAT);
		tasks.value = taskMap.all();
	});

	tasks.value = taskMap.all();

	// Карту обычно поднимает плагин на onLayoutReady. Повторный вызов ничего не
	// делает, но календарь, открытый раньше этого, не останется пустым.
	await taskMap.start();
});

onUnmounted(() => {
	unsubscribe?.();
	unsubscribe = null;
});
</script>
