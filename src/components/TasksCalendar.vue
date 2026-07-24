<template>
	<div class="tasks-calendar__wrapper">
		<div
			v-show="!isLoading"
			class="tasks-calendar__container"
		>
			<div class="tasks-calendar__calendar">
				<header class="tasks-calendar__inner-header">
					<button
						class="tasks-calendar__button tasks-calendar__inner-nav-title"
						:class="{
							'--is-current-month': isCurrentMonth,
						}"
						@click="handleClickToday"
					>
						{{ monthYearLabel }}
					</button>

					<div class="tasks-calendar__inner-nav-buttons-group">
						<button
							class="tasks-calendar__button tasks-calendar__inner-nav-prev-button"
							@click="handleClickPrev"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M224 480h640a32 32 0 1 1 0 64H224a32 32 0 0 1 0-64"/><path fill="currentColor" d="m237.248 512l265.408 265.344a32 32 0 0 1-45.312 45.312l-288-288a32 32 0 0 1 0-45.312l288-288a32 32 0 1 1 45.312 45.312z"/></svg>
						</button>

						<button
							class="tasks-calendar__button tasks-calendar__inner-nav-next-button"
							@click="handleClickNext"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M754.752 480H160a32 32 0 1 0 0 64h594.752L521.344 777.344a32 32 0 0 0 45.312 45.312l288-288a32 32 0 0 0 0-45.312l-288-288a32 32 0 1 0-45.312 45.312z"/></svg>
						</button>
					</div>
				</header>

				<div class="tasks-calendar__inner-calendar">
					<div class="tasks-calendar__inner-grid">
						<header	class="tasks-calendar__grid-header">
							<div
								v-for="dayName in weekDays"
								:key="dayName"
								class="tasks-calendar__grid-week-name"
							>
								{{ dayName }}
							</div>
						</header>

						<main class="tasks-calendar__grid-week-numbers">
							<button
								v-for="day in calendarDays"
								:key="day.date"
								class="tasks-calendar__button tasks-calendar__grid-week-day"
								:class="{
									'--is-today': isToday(day.date),
									'--is-other-month': !day.isCurrentMonth,
									'--is-focused': day.date === selectedDate
								}"
								@click="handleClickDayNumber(day)"
							>
								<span class="tasks-calendar__grid-week-day--number">
									{{ day.number }}
								</span>

								<span
									v-if="hasTasks(day.date)"
									class="tasks-calendar__grid-week-day--dot"
								></span>
							</button>
						</main>
					</div>
				</div>
			</div>

			<div class="tasks-calendar__tasks">
				<div class="tasks-calendar__actions">
					<input
						class="action-input"
						type="text"
						v-model="actionText"
						@keydown.enter="handleClickActionCreate"
					>

					<button
						class="tasks-calendar__button action-create"
						:disabled="isCreateButtonDisabled"
						@click="handleClickActionCreate"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M832 512a32 32 0 1 1 64 0v352a32 32 0 0 1-32 32H160a32 32 0 0 1-32-32V160a32 32 0 0 1 32-32h352a32 32 0 0 1 0 64H192v640h640z"/><path fill="currentColor" d="m469.952 554.24l52.8-7.552L847.104 222.4a32 32 0 1 0-45.248-45.248L477.44 501.44l-7.552 52.8zm422.4-422.4a96 96 0 0 1 0 135.808l-331.84 331.84a32 32 0 0 1-18.112 9.088L436.8 623.68a32 32 0 0 1-36.224-36.224l15.104-105.6a32 32 0 0 1 9.024-18.112l331.904-331.84a96 96 0 0 1 135.744 0z"/></svg>
					</button>
				</div>

				<div
					ref="tasksRef"
					class="tasks-calendar__tasks-tasks"
				></div>
			</div>
		</div>

		<div
			v-show="isLoading"
			class="tasks-calendar__loading"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Material Line Icons by Vjacheslav Trushkin - https://github.com/cyberalien/line-md/blob/master/license.txt --><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="16" stroke-dashoffset="16" d="M12 3c4.97 0 9 4.03 9 9"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="16;0"/><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/></path><path stroke-dasharray="64" stroke-dashoffset="64" stroke-opacity=".3" d="M12 3c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9c-4.97 0 -9 -4.03 -9 -9c0 -4.97 4.03 -9 9 -9Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="1.2s" values="64;0"/></path></g></svg>
			<h4>Идет загрузка</h4>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import TasksCalendarPlugin from 'main';
import { Notice, MarkdownRenderer, TFile, debounce } from 'obsidian';

interface CalendarDay {
	number: number;
	date: string;
	isCurrentMonth: boolean;
}

const props = defineProps<{
	plugin: TasksCalendarPlugin;
}>();

const tasksRef = ref<HTMLElement | null>(null);
const currentDate = ref(moment());
const tasksByDate = ref<Record<string, boolean>>({});
const isLoading = ref(false);
const selectedDate = ref<string>('');
const actionDate = ref<string>(moment().format('YYYY-MM-DD'));
const actionText = ref<string>('');
const todayStr = moment().format('YYYY-MM-DD');

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

const isCurrentMonth = computed(() => currentDate.value.month() === moment().month() && currentDate.value.year() === moment().year());

const isCreateButtonDisabled = computed((): boolean => !actionDate.value || !actionText.value.trim());

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
			date: date.format('YYYY-MM-DD'),
			isCurrentMonth: date.month() === currentMonth,
		});
	}

	return days;
});

const getSettingTasksFolderPath = computed(() =>
	props.plugin.settings.tasksFolderPath.replace('/', '')
);

const isToday = (date: string): boolean => date === todayStr;

const hasTasks = (date: string): boolean => tasksByDate.value[date] || false;

const handleClickPrev = (): void => {
	currentDate.value = currentDate.value.clone().subtract(1, 'month');
};

const handleClickToday = (): void => {
	currentDate.value = moment();
};

const handleClickNext = (): void => {
	currentDate.value = currentDate.value.clone().add(1, 'month');
};

const getTasksPlugin = (): any => {
	const plugins = (props.plugin.app as any).plugins;
	return plugins?.plugins?.['obsidian-tasks-plugin'];
};

const appendTaskToFile = async (taskLine: string, dateStr: string): Promise<boolean> => {
	const { vault } = props.plugin.app;
	const filename = moment(dateStr).format(props.plugin.settings.filenameFormat) + '.md';
	const folderPath = getSettingTasksFolderPath.value.replace(/^\/+|\/+$/g, '');
	const filePath = folderPath ? `${folderPath}/${filename}` : filename;

	let targetFile = vault.getAbstractFileByPath(filePath) as TFile;

	if (!targetFile) {
		try {
			targetFile = await vault.create(filePath, '');
		} catch (error) {
			console.error('Error creating file:', error);
			new Notice('Не удалось создать файл');
			return false;
		}
	}

	let content = '';
	try {
		content = await vault.read(targetFile);
	} catch (error) {
		console.error('Error reading file:', error);
		new Notice('Не удалось прочитать файл');
		return false;
	}

	const trimmedContent = content.trimEnd();
	const separator = trimmedContent.length > 0 ? '\n' : '';
	const newContent = trimmedContent + separator + taskLine.trim() + '\n';

	try {
		await vault.modify(targetFile, newContent);
		new Notice('Задача успешно добавлена');
		await updateTasks();
		return true;
	} catch (error) {
		console.error('Error writing to file:', error);
		new Notice('Не удалось добавить задачу в файл');
		return false;
	}
};

const handleClickActionCreate = async (): Promise<void> => {
	if (isCreateButtonDisabled.value) return;

	const dateStr = actionDate.value;
	const taskLine = `- [ ] ${actionText.value.trim()} 📅 ${dateStr}`;

	if (await appendTaskToFile(taskLine, dateStr)) {
		actionText.value = '';
	}
};

const handleClickDayNumber = (day: CalendarDay): void => {
	actionDate.value = day.date;
	if (day.date !== selectedDate.value) {
		updateTasksQueryInContainer(day.date);
	}
};

const updateTasksQueryInContainer = async (date: string): Promise<void> => {
	if (tasksRef.value && getTasksPlugin()?.apiV1) {
		selectedDate.value = date;
		tasksRef.value.innerHTML = '';

		const query = `\`\`\`tasks
${getSettingTasksFolderPath.value ? 'path includes ' + getSettingTasksFolderPath.value : ''}
filter by function \\
	const today = task.due.moment?.isSame(moment("${date}"), 'day') || false; \\
	const overdue = task.due.moment?.isBefore(moment(), 'day') || false; \\
	const isDone = task.isDone; \\
	return overdue && !isDone || today && !isDone || today && isDone;
sort by due AND done
short
show tree
hide toolbar
hide due date
hide recurrence rule
hide task count
hide done date
hide postpone button
\`\`\``;

		await MarkdownRenderer.renderMarkdown(
			query,
			tasksRef.value,
			'',
			props.plugin,
		);
	}
};

const updateTasks = async () => {
	const { vault } = props.plugin.app;
	const folder = getSettingTasksFolderPath.value;
	const taskPattern = /^\s*[-*]\s+\[\s+\]\s+.*?📅\s+(\d{4}-\d{2}-\d{2})/;
	const files = vault.getMarkdownFiles().filter((file) => file.path.includes(folder));
	const result: Record<string, boolean> = {};

	await Promise.all(files.map(async (file) => {
		try {
			const content = await vault.cachedRead(file);

			for (const line of content.split('\n')) {
				if (line.includes('✅')) continue;

				const match = line.match(taskPattern);

				if (match) {
					result[match[1]] = true;
				}
			}
		} catch (error) {
			console.error(`${file.path}:`, error);
		}
	}));

	tasksByDate.value = result;
};

const scheduleTasksUpdate = debounce(() => { updateTasks(); }, 300, true);

const handleFileChange = (file: TFile) => {
	if (file.path.includes(getSettingTasksFolderPath.value)) {
		scheduleTasksUpdate();
	}
};

let unregisterEvents: (() => void) | null = null;

onMounted(async () => {
	isLoading.value = true;
	await updateTasks();

	const { vault, metadataCache } = props.plugin.app;

	vault.on('modify', handleFileChange);
	vault.on('create', handleFileChange);
	vault.on('delete', handleFileChange);
	metadataCache.on('changed', handleFileChange);

	unregisterEvents = () => {
		vault.off('modify', handleFileChange);
		vault.off('create', handleFileChange);
		vault.off('delete', handleFileChange);
		metadataCache.off('changed', handleFileChange);
	};

	await updateTasksQueryInContainer(todayStr);
	isLoading.value = false;
});

onUnmounted(() => {
	unregisterEvents?.();
	unregisterEvents = null;
});
</script>
