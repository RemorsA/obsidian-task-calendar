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
			</div>

			<div class="tasks-calendar__tasks">
				<div class="tasks-calendar__actions">
					<div class="action-date__recur">
						<input
							class="action-date"
							type="date"
							v-model="actionDate"
						>

						<input
							class="action-recur"
							type="text"
							placeholder="🔁"
							v-model="actionRecur"
							:class="{ '--is-invalid': actionRecur.trim() && !isValidRecur }"
						>
					</div>

					<div class="action-text__and__create">
						<input
							class="action-input"
							type="text"
							placeholder="..."
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

			<h4>{{ loadingText }}</h4>
		</div>
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
const isLoading = ref(false);
const selectedDate = ref<string>('');
const actionDate = ref<string>(moment().format('YYYY-MM-DD'));
const actionRecur = ref<string>('');
const actionText = ref<string>('');

const getLang = computed(() =>
	window.localStorage.getItem('language') as Language || 'en'
);

const weekDays = computed(() => [
	t(getLang.value, 'weekDayMon'),
	t(getLang.value, 'weekDayTue'),
	t(getLang.value, 'weekDayWed'),
	t(getLang.value, 'weekDayThu'),
	t(getLang.value, 'weekDayFri'),
	t(getLang.value, 'weekDaySat'),
	t(getLang.value, 'weekDaySun'),
]);

const monthYearLabel = computed(() => {
	const monthKeys = [
		'monthJanuary',
		'monthFebruary',
		'monthMarch',
		'monthApril',
		'monthMay',
		'monthJune',
		'monthJuly',
		'monthAugust',
		'monthSeptember',
		'monthOctober',
		'monthNovember',
		'monthDecember',
	];
	const month = t(getLang.value, monthKeys[currentDate.value.month()]);
	const year = currentDate.value.year();
	const separator = t(getLang.value, 'dateSeparator');

	return `${month}${separator}${year}`;
});

const loadingText = computed(() =>
	t(getLang.value, 'loading')
);

const isCurrentMonth = computed(() =>
	currentDate.value.month() === moment().month() && currentDate.value.year() === moment().year()
);

const isValidRecur = computed((): boolean => {
	const val = actionRecur.value.trim();
	if (!val) return true;
	return /^every\s+(\d+\s+)?(day|days|week|weeks|month|months|year|years|weekday|weekdays|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)(\s+.*)?$/i.test(val);
});

const isCreateButtonDisabled = computed((): boolean => {
	return !actionDate.value || !actionText.value.trim() || !isValidRecur.value;
});

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

const flatCalendarDays = computed(() =>
	calendarDays.value.flat()
);

const getSettingTasksFolderPath = computed(() =>
	props.plugin.settings.tasksFolderPath.replace('/', '')
);

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

const getTasksPlugin = (): any => {
	const plugins = (props.plugin.app as any).plugins;
	return plugins?.plugins?.['obsidian-tasks-plugin'];
};

const handleClickCreateTask = async (): Promise<void> => {
	try {
		const tasksPlugin = getTasksPlugin();

		if (!tasksPlugin?.apiV1) {
			new Notice(t(getLang.value, 'tasksPluginNotFound'));
			return;
		}

		const tasksApi = tasksPlugin.apiV1;		
		let taskLine: string | null = null;

		try {
			if (typeof tasksApi.createTaskLineModal === 'function') {
				taskLine = await tasksApi.createTaskLineModal();
			} else {
				new Notice(t(getLang.value, 'tasksApiMethodNotAvailable'));
				return;
			}
		} catch (error) {
			console.error('Error opening task modal:', error);
			new Notice(t(getLang.value, 'failedToOpenTaskModal'));
			return;
		}

		if (!taskLine) {
			return;
		}

		const dateMatch = taskLine.match(/📅[\s]+(\d{4}-\d{2}-\d{2})/);

		if (!dateMatch) {
			new Notice(t(getLang.value, 'taskMustContainDate'));
			return;
		}

		const dateStr = dateMatch[1];
		const taskDate = moment(dateStr);
		const filenameFormat = props.plugin.settings.filenameFormat;
		const filename = taskDate.format(filenameFormat) + '.md';		
		const folderPath = getSettingTasksFolderPath.value.replace(/^\/+|\/+$/g, '');
		const filePath = folderPath ? `${folderPath}/${filename}` : filename;
		let targetFile = props.plugin.app.vault.getAbstractFileByPath(filePath) as TFile;
		
		if (!targetFile) {
			try {
				targetFile = await props.plugin.app.vault.create(filePath, '');
			} catch (error) {
				console.error('Error creating file:', error);
				new Notice(t(getLang.value, 'failedToCreateFile'));
				return;
			}
		}

		let content = '';

		try {
			content = await props.plugin.app.vault.read(targetFile);
		} catch (error) {
			console.error('Error reading file:', error);
			new Notice(t(getLang.value, 'failedToReadFile'));
			return;
		}

		const trimmedContent = content.trimEnd();
		const taskText = taskLine.trim();
		const separator = trimmedContent.length > 0 ? '\n' : '';
		const newContent = trimmedContent + separator + taskText + '\n';

		try {
			await props.plugin.app.vault.modify(targetFile, newContent);
			new Notice(t(getLang.value, 'taskAddedSuccessfully'));
			
			await updateTasks();
		} catch (error) {
			console.error('Error writing to file:', error);
			new Notice(t(getLang.value, 'failedToAddTask'));
		}
	} catch (error) {
		console.error('Error creating task:', error);
		new Notice(t(getLang.value, 'failedToAddTask'));
	}
};

const handleClickActionCreate = async (): Promise<void> => {
	if (isCreateButtonDisabled.value) return;

	try {
		const dateStr = actionDate.value;
		const recur = actionRecur.value.trim();
		const text = actionText.value.trim();

		let taskLine = `- [ ] ${text}`;
		if (recur) {
			taskLine += ` 🔁 ${recur}`;
		}
		taskLine += ` 📅 ${dateStr}`;

		const taskDate = moment(dateStr);
		const filenameFormat = props.plugin.settings.filenameFormat;
		const filename = taskDate.format(filenameFormat) + '.md';
		const folderPath = getSettingTasksFolderPath.value.replace(/^\/+|\/+$/g, '');
		const filePath = folderPath ? `${folderPath}/${filename}` : filename;
		let targetFile = props.plugin.app.vault.getAbstractFileByPath(filePath) as TFile;

		if (!targetFile) {
			try {
				targetFile = await props.plugin.app.vault.create(filePath, '');
			} catch (error) {
				console.error('Error creating file:', error);
				new Notice(t(getLang.value, 'failedToCreateFile'));
				return;
			}
		}

		let content = '';
		try {
			content = await props.plugin.app.vault.read(targetFile);
		} catch (error) {
			console.error('Error reading file:', error);
			new Notice(t(getLang.value, 'failedToReadFile'));
			return;
		}

		const trimmedContent = content.trimEnd();
		const taskText = taskLine.trim();
		const separator = trimmedContent.length > 0 ? '\n' : '';
		const newContent = trimmedContent + separator + taskText + '\n';

		try {
			await props.plugin.app.vault.modify(targetFile, newContent);
			new Notice(t(getLang.value, 'taskAddedSuccessfully'));
			actionDate.value = '';
			actionRecur.value = '';
			actionText.value = '';
			await updateTasks();
		} catch (error) {
			console.error('Error writing to file:', error);
			new Notice(t(getLang.value, 'failedToAddTask'));
		}
	} catch (error) {
		console.error('Error creating task:', error);
		new Notice(t(getLang.value, 'failedToAddTask'));
	}
};

const handleClickDayNumber = (day: { number: number, date: string, isCurrentMonth: boolean }, event: any): void => {
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
	const files = props.plugin.app.vault.getMarkdownFiles();
	const taskPattern = /^[\s]*[-*][\s]+\[\s+\][\s]+.*?📅[\s]+(\d{4}-\d{2}-\d{2})/;
	tasksByDate.value = {};

	for (const file of files) {
		if (file.path.includes(getSettingTasksFolderPath.value)) {
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
		if (file.path.includes(getSettingTasksFolderPath.value)) {
			updateTasks();
		}
	};

	const handleMetadataChange = (file: TFile) => {
		if (file.path.includes(getSettingTasksFolderPath.value)) {
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
