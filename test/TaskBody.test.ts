import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TaskBody from '../src/components/TaskBody.vue';
import { App, Component, MarkdownRenderer, Notice } from './mocks/obsidian';
import { useFixedClock } from './helpers';

const BODY = '- [ ] Подзадача 1\n- [ ] Подзадача 2\n\t- [ ] Подзадача 2.1';

const mountBody = async (markdown = BODY, sourcePath = 'Дела/Уборка.md') => {
	const app = new App();
	const wrapper = mount(TaskBody, { props: { app, markdown, sourcePath } });
	await flushPromises();

	return { wrapper, app };
};

beforeEach(() => {
	useFixedClock();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('TaskBody', () => {
	it('отдаёт тело задачи markdown-рендеру Obsidian', async () => {
		const { wrapper } = await mountBody();

		expect(MarkdownRenderer.calls).toHaveLength(1);
		expect(MarkdownRenderer.calls[0].markdown).toBe(BODY);
		// Путь нужен рендеру, чтобы разрешать относительные ссылки заметки.
		expect(MarkdownRenderer.calls[0].sourcePath).toBe('Дела/Уборка.md');
		expect(wrapper.find('.tasks__item-body').text()).toContain('Подзадача 2.1');
	});

	it('контейнер помечен классом режима чтения', async () => {
		const { wrapper } = await mountBody();

		// Без markdown-rendered стили Obsidian до отрисованной разметки не доходят.
		expect(wrapper.find('.tasks__item-body').classes()).toContain('markdown-rendered');
	});

	it('клик по чекбоксу отдаёт его номер', async () => {
		const { wrapper } = await mountBody();

		await wrapper.findAll('input.task-list-item-checkbox')[2].trigger('click');

		expect(wrapper.emitted('toggle-checkbox')).toEqual([[2]]);
	});

	it('сам чекбокс компонент не переключает - состояние задаёт текст заметки', async () => {
		const { wrapper } = await mountBody();
		const box = wrapper.findAll('input.task-list-item-checkbox')[0];

		expect((box.element as HTMLInputElement).checked).toBe(false);

		await box.trigger('click');

		// Дай браузеру переключить галочку сам - и разметка разъедется с файлом:
		// перерисовки при том же markdown не будет, и галочка останется стоять.
		expect((box.element as HTMLInputElement).checked).toBe(false);
	});

	it('клик мимо чекбокса ничего не отдаёт', async () => {
		const { wrapper } = await mountBody();

		await wrapper.find('.tasks__item-body').trigger('click');

		expect(wrapper.emitted('toggle-checkbox')).toBeUndefined();
	});

	it('пустое тело не рендерится', async () => {
		await mountBody('');

		expect(MarkdownRenderer.calls).toHaveLength(0);
	});

	it('смена текста перерисовывает тело с нуля', async () => {
		const { wrapper } = await mountBody();

		await wrapper.setProps({ markdown: 'новое тело' });
		await flushPromises();

		expect(MarkdownRenderer.calls).toHaveLength(2);
		expect(MarkdownRenderer.calls[1].markdown).toBe('новое тело');
		// Прошлая отрисовка убрана, а не дописана рядом.
		expect(wrapper.find('.tasks__item-body').text()).toBe('новое тело');
	});

	it('смена заметки перерисовывает тело', async () => {
		const { wrapper } = await mountBody();

		await wrapper.setProps({ sourcePath: 'Дела/Другая.md' });
		await flushPromises();

		expect(MarkdownRenderer.calls).toHaveLength(2);
		expect(MarkdownRenderer.calls[1].sourcePath).toBe('Дела/Другая.md');
	});

	it('дочерние компоненты рендера снимаются при перерисовке и закрытии', async () => {
		const created: Component[] = [];
		const original = Component.prototype.load;
		vi.spyOn(Component.prototype, 'load').mockImplementation(function (this: Component) {
			created.push(this);
			original.call(this);
		});

		const { wrapper } = await mountBody();
		await wrapper.setProps({ markdown: 'новое тело' });
		await flushPromises();

		expect(created).toHaveLength(2);
		// Первый выгружен перед второй отрисовкой, второй - при закрытии.
		expect(created[0].unloaded).toBe(true);
		expect(created[1].unloaded).toBe(false);

		wrapper.unmount();

		expect(created[1].unloaded).toBe(true);
	});

	it('ошибка рендера не роняет компонент', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(MarkdownRenderer, 'render').mockRejectedValue(new Error('render failed'));

		const { wrapper } = await mountBody();

		expect(consoleError).toHaveBeenCalled();
		expect(wrapper.find('.tasks__item-body').exists()).toBe(true);
	});
});

describe('ссылки в теле задачи', () => {
	const openCalls = (app: App) => app.workspace.openLinkCalls;

	it('клик по вики-ссылке открывает заметку', async () => {
		const { wrapper, app } = await mountBody('- [ ] Купить [[Молоко]]');

		await wrapper.find('a.internal-link').trigger('click');
		await flushPromises();

		expect(openCalls(app)).toHaveLength(1);
		expect(openCalls(app)[0].linktext).toBe('Молоко');
		// Путь заметки нужен, чтобы разрешить относительную ссылку.
		expect(openCalls(app)[0].sourcePath).toBe('Дела/Уборка.md');
		expect(openCalls(app)[0].newLeaf).toBe(false);
	});

	it('подпись ссылку не подменяет', async () => {
		const { wrapper, app } = await mountBody('[[Молоко|купить молока]]');

		expect(wrapper.find('a.internal-link').text()).toBe('купить молока');

		await wrapper.find('a.internal-link').trigger('click');
		await flushPromises();

		expect(openCalls(app)[0].linktext).toBe('Молоко');
	});

	it('якорь заголовка и блока сохраняется', async () => {
		const { wrapper, app } = await mountBody('[[Заметка#Раздел]] и [[Заметка#^блок]]');

		const links = wrapper.findAll('a.internal-link');
		await links[0].trigger('click');
		await links[1].trigger('click');
		await flushPromises();

		expect(openCalls(app).map((call) => call.linktext))
			.toEqual(['Заметка#Раздел', 'Заметка#^блок']);
	});

	it('markdown-ссылка на файл тоже открывает заметку', async () => {
		const { wrapper, app } = await mountBody('[текст](Дела/Другая.md)');

		await wrapper.find('a.internal-link').trigger('click');
		await flushPromises();

		expect(openCalls(app)[0].linktext).toBe('Дела/Другая.md');
	});

	it('Ctrl и Cmd открывают в новой вкладке', async () => {
		const { wrapper, app } = await mountBody('[[Молоко]]');

		await wrapper.find('a.internal-link').trigger('click', { ctrlKey: true });
		await wrapper.find('a.internal-link').trigger('click', { metaKey: true });
		await flushPromises();

		expect(openCalls(app).map((call) => call.newLeaf)).toEqual(['tab', 'tab']);
	});

	it('средний клик открывает в новой вкладке', async () => {
		const { wrapper, app } = await mountBody('[[Молоко]]');

		// Средний клик приходит auxclick'ом, обычный click на него не срабатывает.
		await wrapper.find('a.internal-link').trigger('auxclick', { button: 1 });
		await flushPromises();

		expect(openCalls(app)).toHaveLength(1);
		expect(openCalls(app)[0].newLeaf).toBe('tab');
	});

	it('клик по вложенной разметке внутри ссылки тоже открывает заметку', async () => {
		const { wrapper, app } = await mountBody('[[Молоко]]');
		const inner = document.createElement('strong');
		wrapper.find('a.internal-link').element.appendChild(inner);

		await wrapper.find('a.internal-link strong').trigger('click');
		await flushPromises();

		expect(openCalls(app)).toHaveLength(1);
	});

	it('внешняя ссылка уходит наружу, а не в хранилище', async () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const { wrapper, app } = await mountBody('[сайт](https://example.com/a?b=1)');

		await wrapper.find('a.external-link').trigger('click');
		await flushPromises();

		expect(open).toHaveBeenCalledWith('https://example.com/a?b=1', '_blank');
		expect(openCalls(app)).toHaveLength(0);
	});

	it('клик по обычному тексту ничего не открывает', async () => {
		const { wrapper, app } = await mountBody('просто текст');

		await wrapper.find('.tasks__item-body').trigger('click');
		await flushPromises();

		expect(openCalls(app)).toHaveLength(0);
	});

	it('клик по ссылке в строке подзадачи не отмечает чекбокс', async () => {
		const { wrapper } = await mountBody('- [ ] Купить [[Молоко]]');

		await wrapper.find('a.internal-link').trigger('click');
		await flushPromises();

		expect(wrapper.emitted('toggle-checkbox')).toBeUndefined();
	});

	it('средний клик по чекбоксу отметкой не считается', async () => {
		const { wrapper } = await mountBody('- [ ] Подзадача 1');

		await wrapper.find('input.task-list-item-checkbox').trigger('auxclick', { button: 1 });

		expect(wrapper.emitted('toggle-checkbox')).toBeUndefined();
	});

	it('ошибка открытия не роняет тело задачи', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { wrapper, app } = await mountBody('[[Молоко]]');
		app.workspace.openLinkFails = true;

		await wrapper.find('a.internal-link').trigger('click');
		await flushPromises();

		expect(Notice.messages).toContain('Не удалось открыть ссылку');
		expect(wrapper.find('a.internal-link').exists()).toBe(true);
	});

	it('ссылка без цели ничего не открывает', async () => {
		const { wrapper, app } = await mountBody('[[Молоко]]');
		const link = wrapper.find('a.internal-link').element as HTMLAnchorElement;
		// Так выглядит битая ссылка: класс есть, цели нет.
		delete link.dataset.href;
		link.removeAttribute('href');

		await wrapper.find('a.internal-link').trigger('click');
		await wrapper.find('a.internal-link').trigger('mouseover');
		await flushPromises();

		expect(app.workspace.openLinkCalls).toHaveLength(0);
		expect(app.workspace.triggered).toHaveLength(0);
	});

	it('наведение на ссылку просит предпросмотр', async () => {
		const { wrapper, app } = await mountBody('[[Молоко]]');

		await wrapper.find('a.internal-link').trigger('mouseover');

		const hover = app.workspace.triggered.filter((call) => call.name === 'hover-link');
		expect(hover).toHaveLength(1);
		expect(hover[0].data[0]).toMatchObject({
			source: 'task-calendar',
			linktext: 'Молоко',
			sourcePath: 'Дела/Уборка.md',
		});
	});

	it('наведение на обычный текст предпросмотр не просит', async () => {
		const { wrapper, app } = await mountBody('просто текст');

		await wrapper.find('.tasks__item-body').trigger('mouseover');

		expect(app.workspace.triggered).toHaveLength(0);
	});
});
