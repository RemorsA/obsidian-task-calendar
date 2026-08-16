<template>
	<!--
		Оба класса обязательны: рендер отдаёт голую разметку, а вид ей придают
		стили режима чтения Obsidian.

		markdown-rendered - основной набор: без него цитаты остаются без полосы,
		таблицы без рамок, а заголовки без отбивок.
		markdown-preview-view - стили самой страницы чтения поверх: типографика,
		поля и отбивки блоков ровно те же, что в открытой заметке. Плата за это -
		отступы страницы в узкой карточке, они гасятся в styles.css.
	-->
	<div
		ref="containerEl"
		class="tasks__item-body markdown-preview-view markdown-rendered"
		@click="handleClick"
		@auxclick="handleClick"
		@mouseover="handleMouseOver"
	></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { App, Component, Keymap, MarkdownRenderer, Notice } from 'obsidian';

/**
 * Тело задачи, отрисованное штатным markdown-рендером Obsidian: чекбоксы,
 * вложенные списки, ссылки и всё остальное выглядят как в самой заметке.
 */
const props = defineProps<{
	app: App;
	/** Текст после блока свойств. */
	markdown: string;
	/** Путь заметки - по нему рендер разрешает относительные ссылки. */
	sourcePath: string;
}>();

const emit = defineEmits<{
	/** Отметили подзадачу: порядковый номер чекбокса сверху вниз. */
	(event: 'toggle-checkbox', index: number): void;
}>();

const containerEl = ref<HTMLElement | null>(null);

const CHECKBOX_SELECTOR = 'input.task-list-item-checkbox';
/** Ссылка на заметку: и `[[вики]]`, и `[текст](Заметка.md)`. */
const INTERNAL_LINK_SELECTOR = 'a.internal-link';
const EXTERNAL_LINK_SELECTOR = 'a.external-link';
/** Источник события hover-link - им же плагин представлен в «Предпросмотре». */
const HOVER_SOURCE = 'task-calendar';

/**
 * Куда ведёт ссылка. У внутренних настоящая цель лежит в data-href: в href
 * Obsidian кладёт то же самое, но у неразрешённых ссылок он пустой.
 */
const linkTarget = (link: HTMLAnchorElement): string =>
	link.dataset.href ?? link.getAttribute('href') ?? '';

/**
 * Переход по ссылке на заметку. Модификаторы разбирает Keymap: Ctrl или Cmd -
 * новая вкладка, Ctrl+Alt - разделение, средний клик - тоже новая вкладка.
 */
const openInternalLink = async (link: HTMLAnchorElement, event: MouseEvent): Promise<void> => {
	const href = linkTarget(link);
	if (!href) return;

	try {
		await props.app.workspace.openLinkText(href, props.sourcePath, Keymap.isModEvent(event));
	} catch (error) {
		console.error(`${props.sourcePath}: ${href}`, error);
		new Notice('Не удалось открыть ссылку');
	}
};

/**
 * Клик по отрисованному телу: ссылки и чекбоксы.
 *
 * Рендер отдаёт готовую разметку, но ни с файлом, ни с хранилищем её не
 * связывает: в режиме чтения переходы и галочки обрабатывает сама заметка, а
 * здесь этим заниматься некому - оттого ссылки и выглядели мёртвыми.
 *
 * Номер чекбокса считается по порядку в разметке - в том же порядке идут
 * строки-подзадачи в файле. Саму запись делает владелец заметки, компонент
 * только сообщает номер.
 *
 * Тот же обработчик висит на auxclick: средним кликом открывают в новой вкладке,
 * а обычный click на него не приходит.
 */
const handleClick = (event: MouseEvent): void => {
	const element = containerEl.value;
	const target = event.target as HTMLElement | null;
	if (!element || !target) return;

	const internal = target.closest<HTMLAnchorElement>(INTERNAL_LINK_SELECTOR);

	if (internal) {
		// Без этого клик уйдёт по href и утащит за собой всю вкладку Obsidian.
		event.preventDefault();
		void openInternalLink(internal, event);

		return;
	}

	const external = target.closest<HTMLAnchorElement>(EXTERNAL_LINK_SELECTOR);

	if (external) {
		event.preventDefault();
		const href = linkTarget(external);
		if (href) window.open(href, '_blank');

		return;
	}

	// Средний клик по чекбоксу отметкой не считается.
	if (event.type !== 'click' || !target.matches(CHECKBOX_SELECTOR)) return;

	const index = [...element.querySelectorAll(CHECKBOX_SELECTOR)].indexOf(target);

	if (index !== -1) emit('toggle-checkbox', index);
};

/**
 * Предпросмотр заметки по наведению. Само окошко рисует core-плагин «Предпросмотр
 * страницы», от нас нужно только событие с целью ссылки и родителем, к которому
 * окошко привяжется.
 */
const handleMouseOver = (event: MouseEvent): void => {
	const target = event.target as HTMLElement | null;
	const link = target?.closest<HTMLAnchorElement>(INTERNAL_LINK_SELECTOR);
	const href = link ? linkTarget(link) : '';
	if (!link || !href) return;

	props.app.workspace.trigger('hover-link', {
		event,
		source: HOVER_SOURCE,
		hoverParent: { hoverPopover: null },
		targetEl: link,
		linktext: href,
		sourcePath: props.sourcePath,
	});
};

/**
 * Рендер заводит дочерние компоненты (например встроенные заметки), и снимать их
 * должен тот, кто их создал. Держим для этого отдельный Component на каждую
 * отрисовку и выгружаем его перед следующей.
 */
let renderer: Component | null = null;

const unloadRenderer = (): void => {
	renderer?.unload();
	renderer = null;
};

const render = async (): Promise<void> => {
	const element = containerEl.value;
	if (!element) return;

	unloadRenderer();
	element.empty();

	if (!props.markdown) return;

	renderer = new Component();
	renderer.load();

	try {
		await MarkdownRenderer.render(
			props.app,
			props.markdown,
			element,
			props.sourcePath,
			renderer
		);
	} catch (error) {
		console.error(`${props.sourcePath}:`, error);
	}
};

onMounted(render);

watch(() => [props.markdown, props.sourcePath], render);

onUnmounted(unloadRenderer);
</script>
