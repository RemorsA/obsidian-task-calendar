import TaskList from '../components/TaskList.vue';
import { VIEW_TYPE_TASK_LIST } from '../types';
import { VueView } from './VueView';

/** Список задач по группам с полем создания: вкладка в основной области. */
export class TaskListView extends VueView {
	protected readonly component = TaskList;

	getViewType(): string {
		return VIEW_TYPE_TASK_LIST;
	}

	getDisplayText(): string {
		return 'Список задач';
	}

	getIcon(): string {
		return 'list-checks';
	}
}
