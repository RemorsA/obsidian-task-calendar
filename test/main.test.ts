import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import TaskCalendarPlugin from '../src/TaskCalendarPlugin';
import { DEFAULT_SETTINGS } from '../src/types';
import { App, Platform, Setting, Vault, WorkspaceLeaf } from './mocks/obsidian';
import { taskFileText, TODAY, useFixedClock } from './helpers';

const VIEW_TYPE = 'task-calendar';

const createPlugin = (savedData: unknown = null, vault = new Vault()) => {
	const app = new App(vault);
	const plugin = new TaskCalendarPlugin(app as never, {} as never);
	(plugin as unknown as { savedData: unknown }).savedData = savedData;

	return { app, plugin, mock: plugin as unknown as InstanceType<typeof import('./mocks/obsidian').Plugin> };
};

beforeEach(() => {
	useFixedClock();
	Setting.instances.length = 0;
	Platform.isMobile = false;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('настройки', () => {
	it('подставляет значения по умолчанию, когда data.json пуст', async () => {
		const { plugin } = createPlugin(null);

		await plugin.loadSettings();

		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('сохранённое значение важнее умолчания', async () => {
		const { plugin } = createPlugin({ tasksFolderPath: 'Задачи' });

		await plugin.loadSettings();

		expect(plugin.settings.tasksFolderPath).toBe('Задачи');
	});

	it('дополняет частично заполненный data.json умолчаниями', async () => {
		const { plugin } = createPlugin({});

		await plugin.loadSettings();

		expect(plugin.settings.tasksFolderPath).toBe(DEFAULT_SETTINGS.tasksFolderPath);
	});

	it('чужие ключи из data.json не подхватываются', async () => {
		const { plugin, mock } = createPlugin({
			tasksFolderPath: 'Задачи',
			openInRightSidebarOnMobile: true,
			мусор: 1,
		});

		await plugin.loadSettings();

		expect(plugin.settings).toEqual({ tasksFolderPath: 'Задачи' });
		// И обратно в файл они уже не уезжают.
		expect(mock.savedData).toEqual({ tasksFolderPath: 'Задачи' });
	});

	it('значение чужого типа заменяется умолчанием', async () => {
		const { plugin } = createPlugin({ tasksFolderPath: 42 });

		await plugin.loadSettings();

		expect(plugin.settings.tasksFolderPath).toBe(DEFAULT_SETTINGS.tasksFolderPath);
	});

	it('не мутирует объект умолчаний', async () => {
		const { plugin } = createPlugin({ tasksFolderPath: 'Задачи' });

		await plugin.loadSettings();

		expect(DEFAULT_SETTINGS.tasksFolderPath).toBe('/');
	});

	it('saveSettings пишет текущие настройки в data.json', async () => {
		const { plugin, mock } = createPlugin(null);

		await plugin.loadSettings();
		plugin.settings.tasksFolderPath = 'Новая';
		await plugin.saveSettings();

		expect(mock.savedData).toEqual({ ...DEFAULT_SETTINGS, tasksFolderPath: 'Новая' });
	});

	// Текущее поведение: loadSettings сразу пишет файл, даже если ничего не менялось.
	it('loadSettings записывает настройки обратно на диск', async () => {
		const { plugin, mock } = createPlugin(null);

		await plugin.loadSettings();

		expect(mock.saveDataCalls).toBe(1);
		expect(mock.savedData).toEqual(DEFAULT_SETTINGS);
	});
});

describe('подписка на настройки', () => {
	it('saveSettings уведомляет подписчиков', async () => {
		const { plugin } = createPlugin(null);
		await plugin.loadSettings();
		const calls: string[] = [];
		plugin.onSettingsChange(() => calls.push(plugin.settings.tasksFolderPath));

		plugin.settings.tasksFolderPath = 'Задачи';
		await plugin.saveSettings();

		expect(calls).toEqual(['Задачи']);
	});

	it('отписка перестаёт получать уведомления', async () => {
		const { plugin } = createPlugin(null);
		await plugin.loadSettings();
		let calls = 0;
		const unsubscribe = plugin.onSettingsChange(() => { calls++; });

		await plugin.saveSettings();
		unsubscribe();
		await plugin.saveSettings();

		expect(calls).toBe(1);
	});

	it('несколько открытых календарей получают уведомление каждый', async () => {
		const { plugin } = createPlugin(null);
		await plugin.loadSettings();
		let first = 0;
		let second = 0;
		plugin.onSettingsChange(() => { first++; });
		plugin.onSettingsChange(() => { second++; });

		await plugin.saveSettings();

		expect([first, second]).toEqual([1, 1]);
	});
});

describe('onload', () => {
	it('регистрирует view, команду, иконку и вкладку настроек', async () => {
		const { plugin, mock } = createPlugin(null);

		await plugin.onload();

		expect(mock.registeredViews.has(VIEW_TYPE)).toBe(true);
		expect(mock.commands.map((command) => command.id)).toEqual(['open-task-calendar']);
		expect(mock.ribbonIcons).toHaveLength(1);
		expect(mock.settingTabs).toHaveLength(1);
	});

	it('регистрирует источник предпросмотра ссылок', async () => {
		const { plugin, mock } = createPlugin(null);

		await plugin.onload();

		// Без этой регистрации core-плагин «Предпросмотр страницы» нас не слушает.
		expect(mock.hoverLinkSources).toEqual([
			{ id: VIEW_TYPE, display: 'Task calendar', defaultMod: true },
		]);
	});

	it('фабрика view отдаёт представление нужного типа', async () => {
		const { plugin, mock } = createPlugin(null);
		await plugin.onload();

		const factory = mock.registeredViews.get(VIEW_TYPE);
		const view = factory?.(new WorkspaceLeaf()) as {
			getViewType(): string;
			getDisplayText(): string;
			getIcon(): string;
		};

		expect(view.getViewType()).toBe(VIEW_TYPE);
		expect(view.getDisplayText()).toBe('Task calendar');
		expect(view.getIcon()).toBe('calendar');
	});

	it('команда и иконка открывают календарь', async () => {
		const { plugin, mock } = createPlugin(null);
		await plugin.onload();
		const openCalendar = vi.spyOn(plugin, 'openCalendar').mockResolvedValue();

		await mock.commands[0].callback?.();
		await mock.ribbonIcons[0].callback();
		await flushPromises();

		expect(openCalendar).toHaveBeenCalledTimes(2);
	});
});

describe('openCalendar', () => {
	it('открывает новую вкладку, когда календарь ещё не открыт', async () => {
		const { app, plugin } = createPlugin(null);
		await plugin.loadSettings();

		await plugin.openCalendar();

		expect(app.workspace.leaves).toHaveLength(1);
		expect(app.workspace.leaves[0].viewState).toEqual({ type: VIEW_TYPE, active: true });
		expect(app.workspace.activeLeaf).toBe(app.workspace.leaves[0]);
	});

	it('переиспользует уже открытую вкладку', async () => {
		const { app, plugin } = createPlugin(null);
		await plugin.loadSettings();
		const existing = new WorkspaceLeaf();
		app.workspace.leavesByType.set(VIEW_TYPE, [existing]);

		await plugin.openCalendar();

		expect(app.workspace.getLeafCalls).toHaveLength(0);
		expect(app.workspace.activeLeaf).toBe(existing);
		expect(existing.viewState).toBeNull();
	});
});

describe('жизненный цикл view', () => {
	const createView = async () => {
		const { app, plugin, mock } = createPlugin(null);
		await plugin.onload();
		const factory = mock.registeredViews.get(VIEW_TYPE);
		const view = factory?.(new WorkspaceLeaf()) as {
			containerEl: HTMLElement;
			onOpen(): Promise<void>;
			onClose(): Promise<void>;
		};

		return { app, view };
	};

	it('монтирует календарь в тело view и чистит его при закрытии', async () => {
		const { view } = await createView();
		const body = view.containerEl.children[1];
		const leftover = document.createElement('div');
		leftover.className = 'мусор-от-прошлого-view';
		body.appendChild(leftover);

		await view.onOpen();
		await flushPromises();

		expect(body.querySelector('.task__calendar-container')).not.toBeNull();
		expect(body.querySelector('.мусор-от-прошлого-view')).toBeNull();

		await view.onClose();

		expect(body.querySelector('.task__calendar-container')).toBeNull();
	});

	it('повторное открытие не оставляет второй календарь', async () => {
		const { view } = await createView();
		const body = view.containerEl.children[1];

		await view.onOpen();
		await flushPromises();
		await view.onClose();
		await view.onOpen();
		await flushPromises();

		expect(body.querySelectorAll('.task__calendar-container')).toHaveLength(1);
	});

	it('закрытие вкладки подписки карты не снимает', async () => {
		const { app, view } = await createView();

		app.workspace.triggerLayoutReady();
		await flushPromises();

		await view.onOpen();
		await flushPromises();
		await view.onClose();

		// Карта живёт в плагине: автоматика чекбокса должна работать и при
		// закрытом календаре - галку ставят и руками в заметке.
		expect(app.vault.handlerCount('modify')).toBe(1);
	});

	it('повторное закрытие безопасно', async () => {
		const { view } = await createView();

		await view.onOpen();
		await flushPromises();
		await view.onClose();

		await expect(view.onClose()).resolves.toBeUndefined();
	});
});

describe('карта задач', () => {
	const withTasks = () => new Vault({
		'Задачи/дело.md': taskFileText({ date: TODAY }),
		'Другое/чужое.md': taskFileText({ date: TODAY }),
	});

	it('до готовности интерфейса хранилище не читается', async () => {
		const { app, plugin } = createPlugin(null, withTasks());

		await plugin.onload();

		expect(app.vault.handlerCount('modify')).toBe(0);
		expect(plugin.taskMap.all()).toHaveLength(0);
	});

	it('onLayoutReady поднимает карту и подписки', async () => {
		const { app, plugin } = createPlugin({ tasksFolderPath: '/Задачи' }, withTasks());
		await plugin.onload();

		app.workspace.triggerLayoutReady();
		await flushPromises();

		expect(plugin.taskMap.all().map((task) => task.key)).toEqual(['/Задачи/дело.md#0']);
		expect(app.vault.handlerCount('modify')).toBe(1);
		expect(app.vault.handlerCount('create')).toBe(1);
		expect(app.vault.handlerCount('delete')).toBe(1);
		expect(app.vault.handlerCount('rename')).toBe(1);
	});

	it('индексация ничего не пишет в хранилище', async () => {
		const { app, plugin } = createPlugin({ tasksFolderPath: '/Задачи' }, withTasks());
		await plugin.onload();

		app.workspace.triggerLayoutReady();
		await flushPromises();

		expect(app.vault.calls.process).toBe(0);
		expect(app.vault.calls.modify).toBe(0);
	});

	it('onunload снимает подписки', async () => {
		const { app, plugin } = createPlugin(null, withTasks());
		await plugin.onload();
		app.workspace.triggerLayoutReady();
		await flushPromises();

		plugin.onunload();

		expect(app.vault.handlerCount('modify')).toBe(0);
		expect(app.vault.handlerCount('rename')).toBe(0);
	});

	it('смена папки в настройках пересобирает карту', async () => {
		const { app, plugin } = createPlugin({ tasksFolderPath: '/Задачи' }, withTasks());
		await plugin.onload();
		app.workspace.triggerLayoutReady();
		await flushPromises();

		plugin.settings.tasksFolderPath = '/Другое';
		await plugin.saveSettings();
		await vi.advanceTimersByTimeAsync(300);

		expect(plugin.taskMap.all().map((task) => task.key)).toEqual(['/Другое/чужое.md#0']);
	});
});

describe('вкладка настроек', () => {
	const openTab = async () => {
		const { plugin, mock } = createPlugin(null);
		await plugin.onload();
		const tab = mock.settingTabs[0];
		tab.display();

		return { plugin, tab };
	};

	it('показывает текущий путь к папке задач', async () => {
		const { tab } = await openTab();

		expect(Setting.instances).toHaveLength(1);
		expect(Setting.instances[0].name).toBe('Путь к папке с задачами');
		expect(Setting.instances[0].textComponents[0].getValue()).toBe('/');
		expect(tab.containerEl.children).toHaveLength(0);
	});

	it('сохраняет введённый путь', async () => {
		const { plugin } = await openTab();

		await Setting.instances[0].textComponents[0].type('Задачи/Личные');

		expect(plugin.settings.tasksFolderPath).toBe('Задачи/Личные');
		expect((plugin as unknown as { savedData: unknown }).savedData)
			.toEqual({ ...DEFAULT_SETTINGS, tasksFolderPath: 'Задачи/Личные' });
	});

	it('перерисовка не дублирует контролы', async () => {
		const { tab } = await openTab();

		tab.display();

		expect(Setting.instances).toHaveLength(2);
		expect(Setting.instances[1].containerEl).toBe(tab.containerEl);
	});
});
