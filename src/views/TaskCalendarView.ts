import TaskCalendar from '../components/TaskCalendar.vue';
import { VIEW_TYPE_TASK_CALENDAR } from '../types';
import { VueView } from './VueView';

/** Календарь задач: сетка месяца с точками, живёт в правой боковой панели. */
export class TaskCalendarView extends VueView {
	protected readonly component = TaskCalendar;

	getViewType(): string {
		return VIEW_TYPE_TASK_CALENDAR;
	}

	getDisplayText(): string {
		return 'Календарь задач';
	}

	getIcon(): string {
		return 'calendar';
	}
}
