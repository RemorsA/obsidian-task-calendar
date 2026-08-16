/**
 * Мок модуля obsidian.
 *
 * Настоящий пакет obsidian - это только .d.ts, рантайма у него нет: код плагина
 * исполняется внутри приложения. Здесь воспроизведён минимум API, который
 * использует плагин, с поведением, близким к настоящему (события хранилища,
 * ошибки создания и чтения файлов, debounce с resetTimer).
 */

/** Obsidian реэкспортирует настоящий moment - отдаём его же. */
export { default as moment } from 'moment';

export class TAbstractFile {
	path: string;
	name: string;
	parent: TFolder | null = null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

export class TFile extends TAbstractFile {
	basename: string;
	extension: string;

	constructor(path: string) {
		super(path);
		const dot = this.name.lastIndexOf('.');
		this.basename = dot === -1 ? this.name : this.name.slice(0, dot);
		this.extension = dot === -1 ? '' : this.name.slice(dot + 1);
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Notice {
	/** Все показанные уведомления за тест. Чистится в test/setup.ts. */
	static messages: string[] = [];

	message: string;

	constructor(message: string, _timeout?: number) {
		this.message = message;
		Notice.messages.push(message);
	}

	hide(): void {}
}

type VaultEvent = 'modify' | 'create' | 'delete' | 'rename';
/** У 'rename' вторым аргументом приходит старый путь - как в настоящем API. */
type VaultHandler = (file: TAbstractFile, oldPath?: string) => void;

export interface EventRef {
	event: string;
	handler: (...args: unknown[]) => void;
}

/** Ошибки чтения/создания, которые тест может подсунуть по пути файла. */
export interface VaultFailures {
	read?: Set<string>;
	create?: Set<string>;
	modify?: Set<string>;
}

export class Vault {
	private files = new Map<string, string>();
	private folders = new Set<string>();
	private handlers = new Map<string, Set<VaultHandler>>();

	/** Счётчики вызовов - тестам удобнее, чем оборачивать методы шпионами. */
	readonly calls = { read: 0, cachedRead: 0, create: 0, modify: 0 };
	readonly failures: VaultFailures = {};

	constructor(files: Record<string, string> = {}, folders: string[] = []) {
		for (const [path, content] of Object.entries(files)) {
			this.files.set(path, content);
			const dir = path.split('/').slice(0, -1).join('/');
			if (dir) this.folders.add(dir);
		}
		for (const folder of folders) this.folders.add(folder);
	}

	getMarkdownFiles(): TFile[] {
		return [...this.files.keys()]
			.filter((path) => path.endsWith('.md'))
			.map((path) => new TFile(path));
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		if (this.files.has(path)) return new TFile(path);
		if (this.folders.has(path)) return new TFolder(path);

		return null;
	}

	async read(file: TFile): Promise<string> {
		this.calls.read++;
		if (this.failures.read?.has(file.path)) {
			throw new Error(`read failed: ${file.path}`);
		}
		const content = this.files.get(file.path);
		if (content === undefined) throw new Error(`ENOENT: ${file.path}`);

		return content;
	}

	async cachedRead(file: TFile): Promise<string> {
		this.calls.cachedRead++;
		if (this.failures.read?.has(file.path)) {
			throw new Error(`read failed: ${file.path}`);
		}
		const content = this.files.get(file.path);
		if (content === undefined) throw new Error(`ENOENT: ${file.path}`);

		return content;
	}

	async create(path: string, data: string): Promise<TFile> {
		this.calls.create++;
		if (this.failures.create?.has(path)) {
			throw new Error(`create failed: ${path}`);
		}
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);

		const dir = path.split('/').slice(0, -1).join('/');
		if (dir && !this.folders.has(dir)) throw new Error(`Folder does not exist: ${dir}`);

		this.files.set(path, data);
		this.trigger('create', new TFile(path));

		return new TFile(path);
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.calls.modify++;
		if (this.failures.modify?.has(file.path)) {
			throw new Error(`modify failed: ${file.path}`);
		}
		this.files.set(file.path, data);
		this.trigger('modify', file);
	}

	/** Содержимое файла - для проверок в тестах. */
	contentOf(path: string): string | undefined {
		return this.files.get(path);
	}

	/** Перемещение и переименование - в Obsidian это одна операция. */
	async rename(file: TFile, newPath: string): Promise<void> {
		const content = this.files.get(file.path);
		if (content === undefined) throw new Error(`ENOENT: ${file.path}`);

		const dir = newPath.split('/').slice(0, -1).join('/');
		if (dir && !this.folders.has(dir)) throw new Error(`Folder does not exist: ${dir}`);

		this.files.delete(file.path);
		this.files.set(newPath, content);
		this.trigger('rename', new TFile(newPath), file.path);
	}

	/** Удаление файла с событием. */
	async delete(file: TFile): Promise<void> {
		this.files.delete(file.path);
		this.trigger('delete', file);
	}

	on(event: VaultEvent, handler: VaultHandler): EventRef {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)?.add(handler);

		return { event, handler: handler as (...args: unknown[]) => void };
	}

	off(event: VaultEvent, handler: VaultHandler): void {
		this.handlers.get(event)?.delete(handler);
	}

	trigger(event: VaultEvent, file: TAbstractFile, oldPath?: string): void {
		for (const handler of this.handlers.get(event) ?? []) handler(file, oldPath);
	}

	handlerCount(event: VaultEvent): number {
		return this.handlers.get(event)?.size ?? 0;
	}
}

/**
 * Разбор блока свойств заметки: подмножество YAML, которого хватает формату
 * задач. Поддержаны `ключ: значение`, пустой `ключ:` и списки из `  - элемент`.
 * Значения остаются строками - как их отдаёт Obsidian для свойств-дат.
 */
export const parseFrontmatter = (content: string): Record<string, unknown> | null => {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;

	const frontmatter: Record<string, unknown> = {};
	let lastKey: string | null = null;

	for (const line of match[1].split(/\r?\n/)) {
		const listItem = line.match(/^\s+-\s+(.*)$/);

		if (listItem && lastKey) {
			const list = Array.isArray(frontmatter[lastKey]) ? frontmatter[lastKey] as unknown[] : [];
			list.push(listItem[1].trim());
			frontmatter[lastKey] = list;
			continue;
		}

		const pair = line.match(/^([^\s:][^:]*):\s*(.*)$/);

		if (pair) {
			const [, key, value] = pair;
			lastKey = key.trim();
			frontmatter[lastKey] = value.trim() === '' ? null : value.trim();
		}
	}

	return frontmatter;
};

/** Собрать блок свойств обратно в текст. Обратная операция к parseFrontmatter. */
export const stringifyFrontmatter = (frontmatter: Record<string, unknown>): string => {
	const lines: string[] = ['---'];

	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${String(item)}`);
			continue;
		}

		lines.push(value === null || value === undefined ? `${key}:` : `${key}: ${String(value)}`);
	}

	lines.push('---');

	return lines.join('\n');
};

export interface CachedMetadata {
	frontmatter?: Record<string, unknown>;
}

/**
 * Мок FileManager. Настоящий processFrontMatter правит только блок свойств,
 * тело заметки не трогает - здесь так же.
 */
export class FileManager {
	readonly calls: { path: string; frontmatter: Record<string, unknown> }[] = [];

	constructor(private vault: Vault) {}

	async processFrontMatter(
		file: TFile,
		fn: (frontmatter: Record<string, unknown>) => void
	): Promise<void> {
		const content = this.vault.contentOf(file.path);
		if (content === undefined) throw new Error(`ENOENT: ${file.path}`);

		const frontmatter = parseFrontmatter(content) ?? {};
		fn(frontmatter);

		const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
		this.calls.push({ path: file.path, frontmatter: { ...frontmatter } });

		await this.vault.modify(file, stringifyFrontmatter(frontmatter) + body);
	}
}

export class MetadataCache {
	private handlers = new Map<string, Set<VaultHandler>>();

	readonly calls = { getFileCache: 0 };

	constructor(private vault: Vault | null = null) {}

	getFileCache(file: TFile): CachedMetadata | null {
		this.calls.getFileCache++;

		const content = this.vault?.contentOf(file.path);
		if (content === undefined) return null;

		const frontmatter = parseFrontmatter(content);

		return frontmatter ? { frontmatter } : {};
	}

	on(event: string, handler: VaultHandler): EventRef {
		if (!this.handlers.has(event)) this.handlers.set(event, new Set());
		this.handlers.get(event)?.add(handler);

		return { event, handler: handler as (...args: unknown[]) => void };
	}

	off(event: string, handler: VaultHandler): void {
		this.handlers.get(event)?.delete(handler);
	}

	trigger(event: string, file: TAbstractFile): void {
		for (const handler of this.handlers.get(event) ?? []) handler(file);
	}

	handlerCount(event: string): number {
		return this.handlers.get(event)?.size ?? 0;
	}
}

/**
 * Мок Component: рендер markdown заводит дочерние компоненты и снимает их через
 * него же. Тестам важно только, что load/unload вызваны парой.
 */
export class Component {
	loaded = false;
	unloaded = false;

	load(): void {
		this.loaded = true;
	}

	unload(): void {
		this.unloaded = true;
	}

	onload(): void {}
	onunload(): void {}
}

/** Строка-подзадача: из неё настоящий рендер делает чекбокс. */
const BODY_TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]\s?(.*)$/;

/** Ссылки в строке: `[[вики|подпись]]` и `[текст](цель)`. */
const INLINE_LINK = /\[\[([^\]]+)\]\]|\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Разложить текст строки на текстовые куски и ссылки - как это делает настоящий
 * рендер: внутренним он ставит класс internal-link и кладёт цель в data-href,
 * внешним - external-link с адресом в href.
 */
const appendInline = (parent: HTMLElement, text: string): void => {
	let last = 0;

	for (const match of text.matchAll(INLINE_LINK)) {
		const at = match.index ?? 0;
		if (at > last) parent.appendChild(document.createTextNode(text.slice(last, at)));
		last = at + match[0].length;

		const link = document.createElement('a');

		if (match[1] !== undefined) {
			const [target, alias] = match[1].split('|');
			link.className = 'internal-link';
			link.dataset.href = target;
			link.setAttribute('href', target);
			link.textContent = alias ?? target;
		} else {
			const target = match[3];
			const external = /^[a-z][\w+.-]*:/i.test(target);
			link.className = external ? 'external-link' : 'internal-link';
			if (!external) link.dataset.href = target;
			link.setAttribute('href', target);
			link.textContent = match[2];
		}

		parent.appendChild(link);
	}

	if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
};

/**
 * Мок markdown-рендера. Настоящий строит DOM заметки; здесь текст кладётся в
 * элемент как есть, а строки-подзадачи превращаются в чекбоксы - на них
 * держится отметка подзадач, и тестам важны их порядок и состояние.
 */
export class MarkdownRenderer {
	static calls: { markdown: string; sourcePath: string; element: HTMLElement }[] = [];

	static async render(
		_app: App,
		markdown: string,
		element: HTMLElement,
		sourcePath: string,
		_component: Component
	): Promise<void> {
		MarkdownRenderer.calls.push({ markdown, sourcePath, element });

		const rendered = document.createElement('div');
		rendered.className = 'markdown-rendered';

		for (const line of markdown.split('\n')) {
			const task = line.match(BODY_TASK_LINE);

			if (task) {
				const item = document.createElement('li');
				item.className = 'task-list-item';

				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.className = 'task-list-item-checkbox';
				checkbox.checked = task[1].toLowerCase() === 'x';

				item.appendChild(checkbox);
				appendInline(item, task[2]);
				rendered.appendChild(item);
				continue;
			}

			const paragraph = document.createElement('div');
			appendInline(paragraph, line);
			rendered.appendChild(paragraph);
		}

		element.appendChild(rendered);
	}
}

export class WorkspaceLeaf {
	viewState: unknown = null;
	view: unknown = null;
	detached = false;
	/** Корень листа: основная область или правая панель - как в getRoot(). */
	root: unknown = null;

	async setViewState(state: unknown): Promise<void> {
		this.viewState = state;
	}

	getRoot(): unknown {
		return this.root;
	}

	detach(): void {
		this.detached = true;
	}
}

export interface OpenLinkCall {
	linktext: string;
	sourcePath: string;
	newLeaf?: unknown;
	openViewState?: { state?: { mode?: string } };
}

/** Мок Keymap: настоящий разбирает модификаторы события. */
export const Keymap = {
	isModEvent(event?: { ctrlKey?: boolean; metaKey?: boolean; button?: number } | null) {
		if (!event) return false;
		if (event.button === 1) return 'tab';

		return event.ctrlKey || event.metaKey ? 'tab' : false;
	},
};

export class Workspace {
	leaves: WorkspaceLeaf[] = [];
	activeLeaf: WorkspaceLeaf | null = null;
	/** Тип листа, который вернёт getLeavesOfType. */
	leavesByType = new Map<string, WorkspaceLeaf[]>();
	getLeafCalls: boolean[] = [];
	/** Открытия заметок - для проверки кнопок в списке задач. */
	readonly openLinkCalls: OpenLinkCall[] = [];
	/** Подставная ошибка открытия. */
	openLinkFails = false;

	async openLinkText(
		linktext: string,
		sourcePath: string,
		newLeaf?: unknown,
		openViewState?: { state?: { mode?: string } }
	): Promise<void> {
		if (this.openLinkFails) throw new Error(`open failed: ${linktext}`);

		this.openLinkCalls.push({ linktext, sourcePath, newLeaf, openViewState });
	}

	/** События workspace.trigger - тестам важен hover-link. */
	readonly triggered: { name: string; data: unknown[] }[] = [];

	trigger(name: string, ...data: unknown[]): void {
		this.triggered.push({ name, data });
	}

	getLeavesOfType(type: string): WorkspaceLeaf[] {
		return this.leavesByType.get(type) ?? [];
	}

	getLeaf(newLeaf?: boolean): WorkspaceLeaf {
		this.getLeafCalls.push(Boolean(newLeaf));
		const leaf = new WorkspaceLeaf();
		this.leaves.push(leaf);

		return leaf;
	}

	/** Правая выдвижная панель - по ней узнаётся, где живёт лист. */
	readonly rightSplit = { collapsed: true };
	getRightLeafCalls: boolean[] = [];
	/** Настоящий getRightLeaf умеет вернуть null - тест это воспроизводит. */
	rightLeafMissing = false;
	readonly revealedLeaves: WorkspaceLeaf[] = [];
	private layoutReadyCallbacks: (() => void)[] = [];

	getRightLeaf(split: boolean): WorkspaceLeaf | null {
		this.getRightLeafCalls.push(split);
		if (this.rightLeafMissing) return null;

		const leaf = new WorkspaceLeaf();
		leaf.root = this.rightSplit;
		this.leaves.push(leaf);

		return leaf;
	}

	async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
		this.revealedLeaves.push(leaf);
		this.activeLeaf = leaf;
	}

	onLayoutReady(callback: () => void): void {
		this.layoutReadyCallbacks.push(callback);
	}

	/** Обстановка «Obsidian достроил интерфейс» - вызывается тестом. */
	triggerLayoutReady(): void {
		for (const callback of this.layoutReadyCallbacks) callback();
	}

	setActiveLeaf(leaf: WorkspaceLeaf): void {
		this.activeLeaf = leaf;
	}
}

/**
 * Платформа. В настоящем obsidian это константа, вычисленная при загрузке;
 * здесь обычный объект, чтобы тест мог переключить телефон и десктоп.
 */
export const Platform = {
	isMobile: false,
	isDesktop: true,
};

export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	fileManager: FileManager;
	workspace = new Workspace();

	constructor(vault: Vault = new Vault()) {
		this.vault = vault;
		this.metadataCache = new MetadataCache(this.vault);
		this.fileManager = new FileManager(this.vault);
	}
}

export interface Command {
	id: string;
	name: string;
	callback?: () => unknown;
}

export class Plugin {
	app: App;
	manifest: Record<string, unknown>;

	/** Регистрации - тесты проверяют, что onload действительно их сделал. */
	readonly registeredViews = new Map<string, (leaf: WorkspaceLeaf) => unknown>();
	readonly commands: Command[] = [];
	readonly ribbonIcons: { icon: string; title: string; callback: () => unknown }[] = [];
	readonly settingTabs: PluginSettingTab[] = [];
	readonly eventRefs: EventRef[] = [];
	readonly hoverLinkSources: { id: string; display: string; defaultMod: boolean }[] = [];

	/** Содержимое data.json. */
	savedData: unknown = null;
	saveDataCalls = 0;

	constructor(app: App, manifest: Record<string, unknown> = {}) {
		this.app = app;
		this.manifest = manifest;
	}

	async loadData(): Promise<unknown> {
		return this.savedData;
	}

	async saveData(data: unknown): Promise<void> {
		this.saveDataCalls++;
		this.savedData = JSON.parse(JSON.stringify(data));
	}

	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}

	registerView(type: string, factory: (leaf: WorkspaceLeaf) => unknown): void {
		this.registeredViews.set(type, factory);
	}

	registerHoverLinkSource(id: string, info: { display: string; defaultMod: boolean }): void {
		this.hoverLinkSources.push({ id, ...info });
	}

	addRibbonIcon(icon: string, title: string, callback: () => unknown): HTMLElement {
		this.ribbonIcons.push({ icon, title, callback });

		return document.createElement('div');
	}

	addCommand(command: Command): Command {
		this.commands.push(command);

		return command;
	}

	registerEvent(ref: EventRef): void {
		this.eventRefs.push(ref);
	}

	onload(): void {}
	onunload(): void {}
}

export class View {
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		this.leaf = leaf;
		// Obsidian отдаёт контейнер, у которого children[1] - тело view.
		this.containerEl = document.createElement('div');
		this.containerEl.appendChild(document.createElement('div'));
		this.containerEl.appendChild(document.createElement('div'));
	}

	getViewType(): string {
		return '';
	}

	getDisplayText(): string {
		return '';
	}
}

export class ItemView extends View {
	getIcon(): string {
		return 'document';
	}
}

export class TextComponent {
	value = '';
	placeholder = '';
	private changeHandler: ((value: string) => unknown) | null = null;

	setPlaceholder(placeholder: string): this {
		this.placeholder = placeholder;

		return this;
	}

	setValue(value: string): this {
		this.value = value;

		return this;
	}

	getValue(): string {
		return this.value;
	}

	onChange(handler: (value: string) => unknown): this {
		this.changeHandler = handler;

		return this;
	}

	/** Ввод пользователя - для тестов вкладки настроек. */
	async type(value: string): Promise<void> {
		this.value = value;
		await this.changeHandler?.(value);
	}
}

export class ToggleComponent {
	value = false;
	private changeHandler: ((value: boolean) => unknown) | null = null;

	setValue(value: boolean): this {
		this.value = value;

		return this;
	}

	getValue(): boolean {
		return this.value;
	}

	onChange(handler: (value: boolean) => unknown): this {
		this.changeHandler = handler;

		return this;
	}

	/** Переключение пользователем - для тестов вкладки настроек. */
	async toggle(): Promise<void> {
		this.value = !this.value;
		await this.changeHandler?.(this.value);
	}
}

export class Setting {
	name = '';
	desc = '';
	readonly textComponents: TextComponent[] = [];
	readonly toggleComponents: ToggleComponent[] = [];

	constructor(public containerEl: HTMLElement) {
		Setting.instances.push(this);
	}

	/** Все созданные Setting за тест - чтобы дотянуться до контролов. */
	static instances: Setting[] = [];

	setName(name: string): this {
		this.name = name;

		return this;
	}

	setDesc(desc: string): this {
		this.desc = desc;

		return this;
	}

	addText(build: (text: TextComponent) => unknown): this {
		const component = new TextComponent();
		this.textComponents.push(component);
		build(component);

		return this;
	}

	addToggle(build: (toggle: ToggleComponent) => unknown): this {
		const component = new ToggleComponent();
		this.toggleComponents.push(component);
		build(component);

		return this;
	}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement('div');
	}

	display(): void {}
}

export interface Debouncer<T extends unknown[], V> {
	(...args: T): Debouncer<T, V>;
	cancel(): this;
	run(): V | void;
}

/**
 * Поведение как у obsidian: resetTimer=true перезапускает таймер на каждом
 * вызове, false - оставляет первый заведённый.
 */
export function debounce<T extends unknown[], V>(
	callback: (...args: T) => V,
	timeout = 0,
	resetTimer = false
): Debouncer<T, V> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: T | null = null;

	const fire = (): V | void => {
		timer = null;
		if (!lastArgs) return;
		const args = lastArgs;
		lastArgs = null;

		return callback(...args);
	};

	const debounced = ((...args: T) => {
		lastArgs = args;
		if (timer !== null) {
			if (!resetTimer) return debounced;
			clearTimeout(timer);
		}
		timer = setTimeout(fire, timeout);

		return debounced;
	}) as Debouncer<T, V>;

	debounced.cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		lastArgs = null;

		return debounced;
	};

	debounced.run = () => {
		if (timer !== null) clearTimeout(timer);

		return fire();
	};

	return debounced;
}
