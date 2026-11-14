import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import TaskCalendarPlugin from '../src/TaskCalendarPlugin';
import { DEFAULT_SETTINGS } from '../src/types';
import { App, Platform, Setting, Vault, WorkspaceLeaf } from './mocks/obsidian';
import { taskFileText, useFixedClock } from './helpers';

const VIEW_TYPE = 'task-calendar';
const LIST_TYPE = 'task-calendar-list';

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
			// Свёрнутые группы - настройка, которой не стало вместе с группами.
			collapsedGroups: ['done'],
			мусор: 1,
		});

		await plugin.loadSettings();

		const expected = { tasksFolderPath: 'Задачи', calendarInList: false, doneCollapsed: false };
		expect(plugin.settings).toEqual(expected);
		// И обратно в файл они уже не уезжают.
		expect(mock.savedData).toEqual(expected);
	});

	it('значение чужого типа заменяется умолчанием', async () => {
		const { plugin } = createPlugin({ tasksFolderPath: 42 });

		await plugin.loadSettings();

		expect(plugin.settings.tasksFolderPath).toBe(DEFAULT_SETTINGS.tasksFolderPath);
	});

	it('календарь в списке по умолчанию выключен, сохранённое важнее, не булево - умолчание', async () => {
		const fresh = createPlugin(null);
		await fresh.plugin.loadSettings();
		expect(fresh.plugin.settings.calendarInList).toBe(false);

		const saved = createPlugin({ calendarInList: true });
		await saved.plugin.loadSettings();
		expect(saved.plugin.settings.calendarInList).toBe(true);

		const text = createPlugin({ calendarInList: 'да' });
		await text.plugin.loadSettings();
		expect(text.plugin.settings.calendarInList).toBe(false);
	});

	it('«Выполнено» по умолчанию развёрнута, сохранённое важнее, не булево - умолчание', async () => {
		const fresh = createPlugin(null);
		await fresh.plugin.loadSettings();
		expect(fresh.plugin.settings.doneCollapsed).toBe(false);

		const saved = createPlugin({ doneCollapsed: true });
		await saved.plugin.loadSettings();
		expect(saved.plugin.settings.doneCollapsed).toBe(true);

		// Прежняя настройка свёрнутых групп - чужой ключ, на группу не влияет.
		const old = createPlugin({ collapsedGroups: ['done'] });
		await old.plugin.loadSettings();
		expect(old.plugin.settings.doneCollapsed).toBe(false);
	});

	it('saveSettings сообщает подписчикам о смене настроек, после отписки - нет', async () => {
		const { plugin } = createPlugin(null);
		await plugin.loadSettings();
		const listener = vi.fn();

		const unsubscribe = plugin.onSettingsChange(listener);
		await plugin.saveSettings();
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		await plugin.saveSettings();
		expect(listener).toHaveBeenCalledTimes(1);
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

describe('onload', () => {
	it('регистрирует оба вида, одну команду, одну иконку и вкладку настроек', async () => {
		const { plugin, mock } = createPlugin(null);

		await plugin.onload();

		expect([...mock.registeredViews.keys()]).toEqual([VIEW_TYPE, LIST_TYPE]);
		expect(mock.commands.map((command) => [command.id, command.name])).toEqual([
			['open-task-list', 'Открыть список задач'],
		]);
		expect(mock.ribbonIcons.map((icon) => [icon.icon, icon.title])).toEqual([
			['calendar-check-2', 'Открыть список задач'],
		]);
		expect(mock.settingTabs).toHaveLength(1);
	});

	it('регистрирует источник предпросмотра ссылок', async () => {
		const { plugin, mock } = createPlugin(null);

		await plugin.onload();

		// Без этой регистрации core-плагин «Предпросмотр страницы» нас не слушает.
		expect(mock.hoverLinkSources).toEqual([
			{ id: 'task-calendar', display: 'Task calendar', defaultMod: true },
		]);
	});

	it('фабрики отдают представления нужного типа', async () => {
		const { plugin, mock } = createPlugin(null);
		await plugin.onload();

		const describeView = (type: string) => {
			const view = mock.registeredViews.get(type)?.(new WorkspaceLeaf()) as {
				getViewType(): string;
				getDisplayText(): string;
				getIcon(): string;
			};

			return [view.getViewType(), view.getDisplayText(), view.getIcon()];
		};

		expect(describeView(VIEW_TYPE)).toEqual([VIEW_TYPE, 'Календарь задач', 'calendar']);
		expect(describeView(LIST_TYPE)).toEqual([LIST_TYPE, 'Список задач', 'list-checks']);
	});

	it('команда и иконка открывают список', async () => {
		const { plugin, mock } = createPlugin(null);
		await plugin.onload();
		const openList = vi.spyOn(plugin, 'openList').mockResolvedValue();

		await mock.commands[0].callback?.();
		await mock.ribbonIcons[0].callback();
		await flushPromises();

		expect(openList).toHaveBeenCalledTimes(2);
	});
});

describe('открытие списка', () => {
	it('список открывается вкладкой в основной области', async () => {
		const { app, plugin } = createPlugin(null);
		await plugin.loadSettings();

		await plugin.openList();

		expect(app.workspace.getLeafCalls).toEqual([true]);
		expect(app.workspace.getRightLeafCalls).toHaveLength(0);
		expect(app.workspace.leaves[0].viewState).toEqual({ type: LIST_TYPE, active: true });
		expect(app.workspace.activeLeaf).toBe(app.workspace.leaves[0]);
	});

	it('уже открытый список переиспользуется', async () => {
		const { app, plugin } = createPlugin(null);
		await plugin.loadSettings();
		const list = new WorkspaceLeaf();
		app.workspace.leavesByType.set(LIST_TYPE, [list]);

		await plugin.openList();

		expect(app.workspace.activeLeaf).toBe(list);
		expect(app.workspace.getLeafCalls).toHaveLength(0);
		expect(list.viewState).toBeNull();
	});
});

describe('отдельный календарь', () => {
	it('вкладка, вернувшаяся с раскладкой, закрывается при любом свитче, список остаётся', async () => {
		for (const settings of [null, { calendarInList: true }]) {
			const { app, plugin } = createPlugin(settings);
			await plugin.onload();
			const restored = new WorkspaceLeaf();
			const list = new WorkspaceLeaf();
			app.workspace.leavesByType.set(VIEW_TYPE, [restored]);
			app.workspace.leavesByType.set(LIST_TYPE, [list]);

			app.workspace.triggerLayoutReady();

			expect(restored.detached).toBe(true);
			expect(list.detached).toBe(false);
		}
	});

	it('команда открывает список, правая панель не трогается', async () => {
		const { app, plugin, mock } = createPlugin(null);
		await plugin.onload();

		await mock.commands[0].callback?.();
		await flushPromises();

		expect(app.workspace.getRightLeafCalls).toHaveLength(0);
		expect(app.workspace.leaves[0].viewState).toEqual({ type: LIST_TYPE, active: true });
	});
});

describe.each([
	['календарь', VIEW_TYPE, '.task__calendar-container'],
	['список', LIST_TYPE, '.task__calendar-list'],
])('жизненный цикл: %s', (_name, type, root) => {
	const createView = async () => {
		const { app, plugin, mock } = createPlugin(null);
		await plugin.onload();
		const factory = mock.registeredViews.get(type);
		const view = factory?.(new WorkspaceLeaf()) as {
			containerEl: HTMLElement;
			onOpen(): Promise<void>;
			onClose(): Promise<void>;
		};

		return { app, view };
	};

	it('монтируется в тело вида и чистит его при закрытии', async () => {
		const { view } = await createView();
		const body = view.containerEl.children[1];
		const leftover = document.createElement('div');
		leftover.className = 'мусор-от-прошлого-view';
		body.appendChild(leftover);

		await view.onOpen();
		await flushPromises();

		expect(body.querySelector(root)).not.toBeNull();
		expect(body.querySelector('.мусор-от-прошлого-view')).toBeNull();

		await view.onClose();

		expect(body.querySelector(root)).toBeNull();
	});

	it('повторное открытие не оставляет второй экземпляр', async () => {
		const { view } = await createView();
		const body = view.containerEl.children[1];

		await view.onOpen();
		await flushPromises();
		await view.onClose();
		await view.onOpen();
		await flushPromises();

		expect(body.querySelectorAll(root)).toHaveLength(1);
	});

	it('закрытие вида подписки карты не снимает', async () => {
		const { app, view } = await createView();

		app.workspace.triggerLayoutReady();
		await flushPromises();

		await view.onOpen();
		await flushPromises();
		await view.onClose();

		// Карта живёт в плагине: автоматика должна работать и при закрытом виде -
		// галку ставят и руками в панели свойств.
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
		'Задачи/дело.md': taskFileText({ text: 'Дело' }),
		'Другое/чужое.md': taskFileText({ text: 'Чужое' }),
	});

	it('до готовности интерфейса хранилище не читается', async () => {
		const { app, plugin } = createPlugin(null, withTasks());

		await plugin.onload();

		expect(app.vault.handlerCount('modify')).toBe(0);
		expect(plugin.taskMap.all()).toHaveLength(0);
	});

	it('onLayoutReady поднимает карту по всему хранилищу и подписки', async () => {
		const { app, plugin } = createPlugin({ tasksFolderPath: '/Задачи' }, withTasks());
		await plugin.onload();

		app.workspace.triggerLayoutReady();
		await flushPromises();

		expect(plugin.taskMap.all().map((task) => task.path).sort())
			.toEqual(['Другое/чужое.md', 'Задачи/дело.md']);
		expect(app.vault.handlerCount('modify')).toBe(1);
		expect(app.vault.handlerCount('create')).toBe(1);
		expect(app.vault.handlerCount('delete')).toBe(1);
		expect(app.vault.handlerCount('rename')).toBe(1);
	});

	it('onLayoutReady назначает типы свойств: все три даты - датой со временем, галочка - флажком', async () => {
		const { app, plugin } = createPlugin(null, withTasks());
		await plugin.onload();

		app.workspace.triggerLayoutReady();
		await flushPromises();

		expect(app.metadataTypeManager?.setTypeCalls).toEqual([
			['Выполнено', 'checkbox'],
			['Дата и время', 'datetime'],
			['Дата выполнения', 'datetime'],
			['Дата переноса', 'datetime'],
		]);
	});

	it('уже верный тип не перезаписывается, неверный исправляется', async () => {
		const { app, plugin } = createPlugin(null);
		const manager = app.metadataTypeManager!;
		manager.assignedWidgets['дата и время'] = { name: 'Дата и время', widget: 'datetime' };
		manager.assignedWidgets['выполнено'] = { name: 'Выполнено', widget: 'checkbox' };
		manager.assignedWidgets['дата переноса'] = { name: 'Дата переноса', widget: 'text' };

		await plugin.assignPropertyTypes();

		expect(manager.setTypeCalls).toEqual([
			['Дата выполнения', 'datetime'],
			['Дата переноса', 'datetime'],
		]);
	});

	it('без реестра типов плагин работает дальше', async () => {
		const { app, plugin } = createPlugin(null);
		app.metadataTypeManager = undefined;

		await expect(plugin.assignPropertyTypes()).resolves.toBeUndefined();
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

		expect(app.metadataCache.handlerCount('changed')).toBe(1);

		plugin.onunload();

		expect(app.vault.handlerCount('modify')).toBe(0);
		expect(app.vault.handlerCount('rename')).toBe(0);
		expect(app.metadataCache.handlerCount('changed')).toBe(0);
	});

	it('смена папки в настройках карту не пересобирает', async () => {
		const { app, plugin } = createPlugin({ tasksFolderPath: '/Задачи' }, withTasks());
		await plugin.onload();
		app.workspace.triggerLayoutReady();
		await flushPromises();
		const reads = app.vault.calls.cachedRead;

		plugin.settings.tasksFolderPath = '/Другое';
		await plugin.saveSettings();
		await vi.advanceTimersByTimeAsync(300);

		expect(app.vault.calls.cachedRead).toBe(reads);
		expect(plugin.taskMap.all()).toHaveLength(2);
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

	it('показывает текущую папку для новых задач', async () => {
		const { tab } = await openTab();

		expect(Setting.instances).toHaveLength(2);
		expect(Setting.instances[0].name).toBe('Папка для новых задач');
		expect(Setting.instances[0].desc).toContain('по всему хранилищу');
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

	it('свитч «Календарь в списке»: выключен, переключение сохраняется и доходит до подписчиков', async () => {
		const { plugin } = await openTab();
		const setting = Setting.instances[1];
		const listener = vi.fn(() => plugin.settings.calendarInList);
		plugin.onSettingsChange(listener);

		expect(setting.name).toBe('Календарь в списке');
		expect(setting.desc).toContain('задачи этого дня');
		expect(setting.desc).toContain('100 ближайших невыполненных задач');
		expect(setting.toggleComponents[0].getValue()).toBe(false);

		await setting.toggleComponents[0].toggle();

		expect(plugin.settings.calendarInList).toBe(true);
		expect((plugin as unknown as { savedData: unknown }).savedData)
			.toEqual({ ...DEFAULT_SETTINGS, calendarInList: true });
		expect(listener).toHaveReturnedWith(true);
	});

	it('перерисовка не дублирует контролы', async () => {
		const { tab } = await openTab();

		tab.display();

		expect(Setting.instances).toHaveLength(4);
		expect(Setting.instances[2].containerEl).toBe(tab.containerEl);
	});
});
