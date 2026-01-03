<template>
	<div class="tasks-calendar__container">
		<div class="tasks-calendar__calendar">
			<header
				v-show="!isLoading"
				class="tasks-calendar__inner-header"
			>
				<div class="tasks-calendar__inner-header__nav">
					<button
						class="tasks-calendar__button tasks-calendar__inner-nav-prev-button"
						@click="handleClickPrev"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M224 480h640a32 32 0 1 1 0 64H224a32 32 0 0 1 0-64"/><path fill="currentColor" d="m237.248 512l265.408 265.344a32 32 0 0 1-45.312 45.312l-288-288a32 32 0 0 1 0-45.312l288-288a32 32 0 1 1 45.312 45.312z"/></svg>
					</button>

					<button
						class="tasks-calendar__button tasks-calendar__inner-nav-title"
						:class="{
							'--is-current-month': isCurrentMonth,
						}"
						@click="handleClickToday"
					>
						{{ monthYearLabel }}
					</button>

					<button
						class="tasks-calendar__button tasks-calendar__inner-nav-next-button"
						@click="handleClickNext"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M754.752 480H160a32 32 0 1 0 0 64h594.752L521.344 777.344a32 32 0 0 0 45.312 45.312l288-288a32 32 0 0 0 0-45.312l-288-288a32 32 0 1 0-45.312 45.312z"/></svg>
					</button>
				</div>

				<button
					class="tasks-calendar__button tasks-calendar__inner-create-button"
					@click="handleClickCreateTask"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1024 1024"><!-- Icon from Element Plus by Element Plus - https://github.com/element-plus/element-plus-icons/blob/main/packages/svg/package.json --><path fill="currentColor" d="M832 512a32 32 0 1 1 64 0v352a32 32 0 0 1-32 32H160a32 32 0 0 1-32-32V160a32 32 0 0 1 32-32h352a32 32 0 0 1 0 64H192v640h640z"/><path fill="currentColor" d="m469.952 554.24l52.8-7.552L847.104 222.4a32 32 0 1 0-45.248-45.248L477.44 501.44l-7.552 52.8zm422.4-422.4a96 96 0 0 1 0 135.808l-331.84 331.84a32 32 0 0 1-18.112 9.088L436.8 623.68a32 32 0 0 1-36.224-36.224l15.104-105.6a32 32 0 0 1 9.024-18.112l331.904-331.84a96 96 0 0 1 135.744 0z"/></svg>
				</button>
			</header>

			<div
				v-show="isLoading"
				class="tasks-calendar__loading-skeleton --skeleton-calendar-header"
			></div>

			<div
				v-show="!isLoading"
				class="tasks-calendar__inner-calendar"
			>
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
							v-for="day in flatCalendarDays"
							:key="day.date"
							class="tasks-calendar__button tasks-calendar__grid-week-day"
							:class="{
								'--is-today': isToday(day.date),
								'--is-other-month': !day.isCurrentMonth,
								'--is-focused': day.date === selectedDate
							}"
							@click="handleClickDayNumber(day, $event)"
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

			<div
				v-show="isLoading"
				class="tasks-calendar__loading-skeleton --skeleton-calendar-calendar"
			></div>
		</div>

		<div
			v-show="!isLoading"
			class="tasks-calendar__tasks"
		>
			<header
				class="tasks-calendar__tasks-header"
				:class="{
					'--is-today': isSelectedToday
				}"
			>
				{{ getTasksHeaderCurrentDate }}
			</header>

			<div
				ref="tasksRef"
				class="tasks-calendar__tasks-tasks"
			></div>
		</div>

		<div
			v-show="isLoading"
			class="tasks-calendar__loading-skeleton --skeleton-tasks"
		></div>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import TasksCalendarPlugin from 'main';
import { Notice, MarkdownRenderer, TFile } from 'obsidian';
import { t } from '../locales';

const props = defineProps<{
	plugin: TasksCalendarPlugin;
}>();

const tasksRef = ref<HTMLElement | null>(null);
const currentDate = ref(moment());
const tasksByDate = ref<Record<string, boolean>>({});
const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const isLoading = ref(false);
const selectedDate = ref<string>('');

const monthYearLabel = computed(() => {
	const monthNames = [
		'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
		'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
	];
	const month = monthNames[currentDate.value.month()];
	const year = currentDate.value.year();
	return `${month} / ${year}`;
});

const isCurrentMonth = computed(() =>
	currentDate.value.month() === moment().month() && currentDate.value.year() === moment().year()
);

const calendarDays = computed(() => {
	const days: Array<{ number: number; date: string; isCurrentMonth: boolean }> = [];
	
	const startOfMonth = currentDate.value.clone().startOf('month');
	const endOfMonth = currentDate.value.clone().endOf('month');
	const daysInMonth = endOfMonth.date();
	
	let firstDayOfWeek = startOfMonth.day();
	firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
	
	if (firstDayOfWeek > 0) {
		const prevMonth = startOfMonth.clone().subtract(1, 'month');
		const daysInPrevMonth = prevMonth.clone().endOf('month').date();
		for (let i = firstDayOfWeek - 1; i >= 0; i--) {
			const dayNumber = daysInPrevMonth - i;
			const date = prevMonth.clone().date(dayNumber);
			days.push({
				number: dayNumber,
				date: date.format('YYYY-MM-DD'),
				isCurrentMonth: false
			});
		}
	}

	for (let i = 1; i <= daysInMonth; i++) {
		const date = startOfMonth.clone().date(i);
		days.push({ 
			number: i,
			date: date.format('YYYY-MM-DD'),
			isCurrentMonth: true
		});
	}

	const totalDays = days.length;
	const targetDays = 42;
	const daysToAdd = targetDays - totalDays;

	if (daysToAdd > 0) {
		const nextMonth = startOfMonth.clone().add(1, 'month');

		for (let i = 1; i <= daysToAdd; i++) {
			const date = nextMonth.clone().date(i);
			days.push({
				number: i,
				date: date.format('YYYY-MM-DD'),
				isCurrentMonth: false
			});
		}
	}

	const weeks: Array<Array<{ number: number; date: string; isCurrentMonth: boolean }>> = [];

	for (let i = 0; i < days.length; i += 7) {
		weeks.push(days.slice(i, i + 7));
	}

	return weeks;
});

const flatCalendarDays = computed(() => calendarDays.value.flat());

const getSettingTasksFolderPath = computed(() => props.plugin.settings.tasksFolderPath.replace('/', ''));

const isSelectedToday = computed(() => selectedDate.value ? isToday(selectedDate.value) : false);

const getTasksHeaderCurrentDate = computed(() => moment(selectedDate.value).format('dddd / D MMMM'));

const isToday = (date: string): boolean => {
	const today = moment();
	const dayDate = moment(date);
	return dayDate.isSame(today, 'day');
};

const hasTasks = (date: string): boolean => {
	return tasksByDate.value[date] || false;
};

const handleClickPrev = (): void => {
	currentDate.value = currentDate.value.clone().subtract(1, 'month');
};

const handleClickToday = (): void => {
	currentDate.value = moment();
};

const handleClickNext = (): void => {
	currentDate.value = currentDate.value.clone().add(1, 'month');
};

const handleClickCreateTask = async (): Promise<void> => {
	const lang = props.plugin.settings.language || 'en';
	
	try {
		const plugins = (props.plugin.app as any).plugins;
		const tasksPlugin = plugins?.plugins?.['obsidian-tasks-plugin'];
		
		if (!tasksPlugin?.apiV1) {
			new Notice(t(lang, 'tasksPluginNotFound'));
			return;
		}

		const tasksApi = tasksPlugin.apiV1;		
		let taskLine: string | null = null;
		
		try {
			if (typeof tasksApi.createTaskLineModal === 'function') {
				taskLine = await tasksApi.createTaskLineModal();
			} else {
				new Notice(t(lang, 'tasksApiMethodNotAvailable'));
				return;
			}
		} catch (error) {
			console.error('Error opening task modal:', error);
			new Notice(t(lang, 'failedToOpenTaskModal'));
			return;
		}

		if (!taskLine) {
			return;
		}

		const dateMatch = taskLine.match(/📅[\s]+(\d{4}-\d{2}-\d{2})/);

		if (!dateMatch) {
			new Notice(t(lang, 'taskMustContainDate'));
			return;
		}

		const dateStr = dateMatch[1];
		const taskDate = moment(dateStr);
		const filenameFormat = props.plugin.settings.filenameFormat || 'YYYY-MM';
		const filename = taskDate.format(filenameFormat) + '.md';		
		const tasksCreateFolderPath = props.plugin.settings.tasksCreateFolderPath || props.plugin.settings.tasksFolderPath || '/';
		const folderPath = tasksCreateFolderPath.replace(/^\/+|\/+$/g, '');
		const filePath = folderPath ? `${folderPath}/${filename}` : filename;
		let targetFile = props.plugin.app.vault.getAbstractFileByPath(filePath) as TFile;
		
		if (!targetFile) {
			try {
				targetFile = await props.plugin.app.vault.create(filePath, '');
			} catch (error) {
				console.error('Error creating file:', error);
				new Notice(t(lang, 'failedToCreateFile'));
				return;
			}
		}

		let content = '';

		try {
			content = await props.plugin.app.vault.read(targetFile);
		} catch (error) {
			console.error('Error reading file:', error);
			new Notice(t(lang, 'failedToReadFile'));
			return;
		}

		const trimmedContent = content.trimEnd();
		const taskText = taskLine.trim();
		const separator = trimmedContent.length > 0 ? '\n' : '';
		const newContent = trimmedContent + separator + taskText + '\n';

		try {
			await props.plugin.app.vault.modify(targetFile, newContent);
			new Notice(t(lang, 'taskAddedSuccessfully'));
			
			await updateTasks();
		} catch (error) {
			console.error('Error writing to file:', error);
			new Notice(t(lang, 'failedToAddTask'));
		}
	} catch (error) {
		console.error('Error creating task:', error);
		new Notice(t(lang, 'failedToAddTask'));
	}
};

const handleClickDayNumber = (day: { number: number, date: string, isCurrentMonth: boolean }, event: any): void => {
	if (day.date !== selectedDate.value) {
		updateTasksQueryInContainer(day.date);
	}
};

const updateTasksQueryInContainer = async (date: string): Promise<void> => {
	if (tasksRef.value) {
		selectedDate.value = date;
		tasksRef.value.innerHTML = '';

		const query = `\`\`\`tasks
path includes ${getSettingTasksFolderPath.value}
filter by function \\
	const today = task.due.moment?.isSame(moment("${date}"), 'day') || false; \\
	const overdue = task.due.moment?.isBefore(moment(), 'day') || false; \\
	const isDone = task.isDone; \\
	return overdue && !isDone || today && !isDone || today && isDone;
sort by due AND done
short
show tree
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
	const files = props.plugin.app.vault.getMarkdownFiles();
	const tasksFolderPath = props.plugin.settings.tasksFolderPath.replace('/', '');	
	const taskPattern = /^[\s]*[-*][\s]+\[\s+\][\s]+.*?📅[\s]+(\d{4}-\d{2}-\d{2})/;
	tasksByDate.value = {};

	for (const file of files) {
		const path = file.path.split('/')[0];
		if (path === tasksFolderPath) {
			try {
				const content = await props.plugin.app.vault.read(file);
				const lines = content.split('\n');
				
				for (const line of lines) {
					if (line.includes('✅')) continue;

					const match = line.match(taskPattern);

					if (match) {
						const date = match[1];
						tasksByDate.value[date] = true;
					}
				}
			} catch (error) {
				console.error(`${file.path}:`, error);
			}
		}
	}
};

let vaultHandlers: {
	modify: (file: TFile) => void;
	create: (file: TFile) => void;
	delete: (file: TFile) => void;
	metadataChanged: (file: TFile) => void;
} | null = null;

onMounted(async () => {
	isLoading.value = true;
	await updateTasks();

	const vault = props.plugin.app.vault;
	const metadataCache = props.plugin.app.metadataCache;

	const handleFileChange = (file: TFile) => {
		const path = file.path.split('/')[0];
		if (path === getSettingTasksFolderPath.value) {
			updateTasks();
		}
	};

	const handleMetadataChange = (file: TFile) => {
		const path = file.path.split('/')[0];
		if (path === getSettingTasksFolderPath.value) {
			updateTasks();
		}
	};

	vault.on('modify', handleFileChange);
	vault.on('create', handleFileChange);
	vault.on('delete', handleFileChange);

	metadataCache.on('changed', handleMetadataChange);

	vaultHandlers = {
		modify: handleFileChange,
		create: handleFileChange,
		delete: handleFileChange,
		metadataChanged: handleMetadataChange,
	};

	await updateTasksQueryInContainer(moment().format('YYYY-MM-DD'));
	isLoading.value = false;
});

onUnmounted(() => {
	if (vaultHandlers) {
		const vault = props.plugin.app.vault;
		const metadataCache = props.plugin.app.metadataCache;

		vault.off('modify', vaultHandlers.modify);
		vault.off('create', vaultHandlers.create);
		vault.off('delete', vaultHandlers.delete);
		metadataCache.off('changed', vaultHandlers.metadataChanged);

		vaultHandlers = null;
	}
});
</script>
