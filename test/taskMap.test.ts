import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from './mocks/obsidian';
import { createPluginDouble, PluginDouble, taskFileText, TODAY, useFixedClock } from './helpers';
import { TaskMap } from '../src/taskMap';
import { showDate } from '../src/taskFormat';

/**
 * Тесты карты задач: индексация, автоматика чекбокса, запись в файл.
 *
 * Автоматика срабатывает только на **переключение**: состояние чекбоксов блока
 * сравнивается с тем, что запомнила прошлая индексация. Поэтому почти каждый тест
 * сначала поднимает карту (`start`), а уже потом что-то отмечает.
 */

/** Дождаться debounce событий хранилища. */
const settle = async (): Promise<void> => {
	await vi.advanceTimersByTimeAsync(300);
};

describe('карта задач', () => {
	let double: PluginDouble;
	let map: TaskMap;

	const setup = async (options: Parameters<typeof createPluginDouble>[0]): Promise<void> => {
		double = createPluginDouble(options);
		map = double.taskMap;
		await map.start();
	};

	const fileOf = (path: string): TFile => new TFile(path);

	beforeEach(() => {
		useFixedClock();
	});

	afterEach(() => {
		map?.stop();
		vi.useRealTimers();
	});

	describe('индексация', () => {
		it('собирает задачи из файлов папки, включая вложенные', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: {
					'Задачи/раз.md': taskFileText({ date: '2026-08-13' }),
					'Задачи/вложенная/два.md': taskFileText({ date: '2026-08-14' }),
					'Другое/три.md': taskFileText({ date: '2026-08-15' }),
				},
			});

			expect(map.all().map((task) => task.key).sort()).toEqual([
				'/Задачи/вложенная/два.md#0',
				'/Задачи/раз.md#0',
			]);
		});

		it('пустая настройка - всё хранилище', async () => {
			await setup({
				tasksFolderPath: '/',
				files: { 'note.md': taskFileText(), 'папка/другая.md': taskFileText() },
			});

			expect(map.all()).toHaveLength(2);
		});

		it('папка сравнивается по границе пути', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: {
					'Задачи/своя.md': taskFileText(),
					'Старые Задачи/чужая.md': taskFileText(),
					'Задачи.md': taskFileText(),
				},
			});

			expect(map.all().map((task) => task.key)).toEqual(['/Задачи/своя.md#0']);
		});

		it('в файле несколько блоков - несколько задач', async () => {
			await setup({
				files: {
					'note.md': taskFileText(
						{ date: '2026-08-13', repeat: 'Каждый день' },
						{ date: '2026-08-12', done: '2026-08-12', body: ['- [x] Задача'] },
					),
				},
			});

			expect(map.all().map((task) => task.blockIndex)).toEqual([0, 1]);
		});

		it('на старте хранилище не сканируется на запись', async () => {
			await setup({
				files: {
					// Все чекбоксы отмечены, ✅ нет - плагин не вмешивается.
					'note.md': taskFileText({ body: ['- [x] Задача'] }),
				},
			});

			expect(double.vault.calls.process).toBe(0);
			expect(double.vault.calls.modify).toBe(0);
			expect(map.all()[0].done).toBeNull();
		});
	});

	describe('автоматика чекбокса', () => {
		it('не все отмечены -> все отмечены: ставит ✅ сегодня', async () => {
			await setup({
				files: { 'note.md': taskFileText({ date: '2026-08-13', body: ['- [ ] Раз', '- [ ] Два'] }) },
			});

			await map.toggleCheckbox('/note.md#0', 0);
			expect(double.vault.contentOf('note.md')).not.toContain('✅');

			await map.toggleCheckbox('/note.md#0', 1);

			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- 📅 2026-08-13',
				`- ✅ ${TODAY}`,
				'\t- [x] Раз',
				'\t- [x] Два',
				'',
			].join('\n'));
			expect(map.all()[0].done).toBe(TODAY);
		});

		it('все отмечены -> не все: убирает ✅', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						done: '2026-08-13',
						body: ['- [x] Раз', '- [x] Два'],
					}),
				},
			});

			await map.toggleCheckbox('/note.md#0', 1);

			expect(double.vault.contentOf('note.md')).not.toContain('✅');
			expect(map.all()[0].done).toBeNull();
		});

		it('повтор: новый блок встаёт над закрытым, 🔁 уходит из него', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						repeat: 'Каждый день',
						body: ['- [ ] Купить молоко'],
					}),
				},
			});

			await map.toggleCheckbox('/note.md#0', 0);

			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- 📅 2026-08-14',
				'- 🔁 Каждый день',
				'\t- [ ] Купить молоко',
				'- 📅 2026-08-13',
				`- ✅ ${TODAY}`,
				'\t- [x] Купить молоко',
				'',
			].join('\n'));
		});

		it('следующий повтор считается от 📅 закрытого блока', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-29',
						repeat: 'Каждую неделю в Субботу',
					}),
				},
			});

			await map.toggleCheckbox('/note.md#0', 0);

			expect(double.vault.contentOf('note.md')).toContain('- 📅 2026-09-05');
		});

		it('задача без 🔁 просто закрывается, новый блок не появляется', async () => {
			await setup({ files: { 'note.md': taskFileText({ date: '2026-08-13' }) } });

			await map.toggleCheckbox('/note.md#0', 0);

			expect(map.all()).toHaveLength(1);
			expect(map.all()[0].done).toBe(TODAY);
		});

		it('в закрытом блоке галка снимается и ставится обратно, генерации нет', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						done: '2026-08-13',
						body: ['- [x] Дело'],
					}),
				},
			});

			await map.toggleCheckbox('/note.md#0', 0);
			expect(double.vault.contentOf('note.md')).not.toContain('✅');

			await map.toggleCheckbox('/note.md#0', 0);

			expect(double.vault.contentOf('note.md')).toContain(`- ✅ ${TODAY}`);
			expect(map.all()).toHaveLength(1);
		});

		it('галка руками в файле запускает ту же автоматику', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({ date: '2026-08-13', repeat: 'Каждый день', body: ['- [x] Задача'] })
			);
			await settle();

			const content = double.vault.contentOf('note.md') ?? '';

			expect(content).toContain('- 📅 2026-08-14');
			expect(content).toContain(`- ✅ ${TODAY}`);
		});

		it('своя же запись нового круга автоматики не запускает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			await map.toggleCheckbox('/note.md#0', 0);

			const after = double.vault.calls.process;
			const content = double.vault.contentOf('note.md');

			await settle();
			await settle();

			expect(double.vault.calls.process).toBe(after);
			expect(double.vault.contentOf('note.md')).toBe(content);
		});

		it('правка текста без смены итога файл не правит', async () => {
			await setup({
				files: { 'note.md': taskFileText({ date: '2026-08-13', body: ['- [ ] Дело'] }) },
			});

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({ date: '2026-08-13', body: ['- [ ] Другое дело'] })
			);
			await settle();

			expect(double.vault.calls.process).toBe(0);
			expect(map.all()[0].body).toBe('- [ ] Другое дело');
		});

		it('дописанная в файле подзадача снимает ✅', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						done: '2026-08-13',
						body: ['- [x] Дело'],
					}),
				},
			});

			// Блок перестал быть отмеченным целиком - значит, снова невыполненный.
			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({
					date: '2026-08-13',
					done: '2026-08-13',
					body: ['- [x] Дело', '- [ ] Ещё'],
				})
			);
			await settle();

			expect(double.vault.contentOf('note.md')).not.toContain('✅');
			expect(map.all()[0].done).toBeNull();
		});

		it('дописанная отмеченная подзадача ✅ не трогает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						done: '2026-08-13',
						body: ['- [x] Дело'],
					}),
				},
			});

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({
					date: '2026-08-13',
					done: '2026-08-13',
					body: ['- [x] Дело', '- [x] Ещё'],
				})
			);
			await settle();

			expect(double.vault.calls.process).toBe(0);
			expect(map.all()[0].done).toBe('2026-08-13');
		});

		it('дописанная подзадача в незакрытом блоке ничего не пишет', async () => {
			await setup({
				files: { 'note.md': taskFileText({ date: '2026-08-13', body: ['- [ ] Дело'] }) },
			});

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({ date: '2026-08-13', body: ['- [ ] Дело', '- [ ] Ещё'] })
			);
			await settle();

			expect(double.vault.calls.process).toBe(0);
		});

		it('все чекбоксы удалены - блок невалиден, ✅ остаётся как написано', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						done: '2026-08-13',
						body: ['- [x] Дело'],
					}),
				},
			});

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({ date: '2026-08-13', done: '2026-08-13', body: ['- Просто пункт'] })
			);
			await settle();

			expect(double.vault.calls.process).toBe(0);
			expect(double.vault.contentOf('note.md')).toContain('✅');
			expect(map.all()).toHaveLength(0);
		});

		it('блок, съехавший на чужой номер, автоматику не запускает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', body: ['- [ ] Дело'] }),
				},
			});

			// Сверху руками появился отмеченный блок: под номером 0 теперь другая
			// задача, и её галочек мы раньше не видели.
			await double.vault.modify(
				fileOf('note.md'),
				taskFileText(
					{ date: '2026-08-20', body: ['- [x] Новая'] },
					{ date: '2026-08-13', body: ['- [ ] Дело'] },
				)
			);
			await settle();

			expect(double.vault.calls.process).toBe(0);
			expect(double.vault.contentOf('note.md')).not.toContain('✅');
		});

		it('ручная правка параметров не вызывает ни перезаписи, ни переименования', async () => {
			await setup({
				files: { 'note.md': taskFileText({ date: '2026-08-13' }) },
			});

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({ date: '2026-08-20', repeat: 'Каждый день', done: '2026-08-20' })
			);
			await settle();

			expect(double.vault.calls.process).toBe(0);
			expect(double.vault.paths()).toEqual(['note.md']);
			expect(map.all()[0]).toMatchObject({
				date: '2026-08-20',
				repeat: 'Каждый день',
				done: '2026-08-20',
			});
		});

		it('✅ руками при снятых чекбоксах сохраняется', async () => {
			await setup({ files: { 'note.md': taskFileText({ date: '2026-08-13' }) } });

			await double.vault.modify(
				fileOf('note.md'),
				taskFileText({ date: '2026-08-13', done: '2026-08-13', body: ['- [ ] Задача'] })
			);
			await settle();

			expect(double.vault.contentOf('note.md')).toContain('✅');
			expect(map.all()[0]).toMatchObject({ done: '2026-08-13', checked: false });
		});
	});

	describe('отметка расчётного дня череды', () => {
		const weekend = () => ({
			files: {
				'note.md': taskFileText({
					date: '2026-08-22',
					repeat: 'Каждую неделю в Субботу, Воскресенье',
					body: ['- [ ] Дело'],
				}),
			},
		});

		/** Блок, который сейчас ведёт цепочку. */
		const chain = () => map.all().find((task) => task.repeat !== null);

		it('заводит блок этого дня и закрывает только его', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');

			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- 📅 2026-08-22',
				'- 🔁 Каждую неделю в Субботу, Воскресенье',
				'\t- [ ] Дело',
				'- 📅 2026-08-29',
				`- ✅ ${TODAY}`,
				'\t- [x] Дело',
				'',
			].join('\n'));
		});

		it('текущий блок остаётся на своём дне и с повтором', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');

			expect(chain()).toMatchObject({
				date: '2026-08-22',
				done: null,
				repeat: 'Каждую неделю в Субботу, Воскресенье',
			});
		});

		it('у блока дня нет 🔁 - свою череду он не ведёт', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');

			expect(map.all().find((task) => task.date === '2026-08-29')).toMatchObject({
				repeat: null,
				done: TODAY,
			});
		});

		it('тело блока дня - чистая копия, а не чужие отметки', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-22',
						repeat: 'Каждый день',
						body: ['- [x] Раз', '- [ ] Два'],
					}),
				},
			});

			await map.toggleCheckbox('/note.md#0', 1, '2026-08-29');

			const day = map.all().find((task) => task.date === '2026-08-29');

			// Отмечена только та подзадача, по которой кликнули.
			expect(day?.body).toBe('- [ ] Раз\n- [x] Два');
			expect(day?.done).toBeNull();
		});

		it('новый выполненный уходит в конец, остальные блоки не двигаются', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');
			await map.toggleCheckbox(chain()!.key, 0);
			await map.toggleCheckbox(chain()!.key, 0);

			const dates = (double.vault.contentOf('note.md') ?? '')
				.split('\n')
				.filter((line) => line.startsWith('- 📅'))
				.map((line) => line.slice('- 📅 '.length));

			// Череда осталась наверху, отмеченный наперёд - в хвосте, куда его и
			// дописали. Ничего не переставлялось.
			expect(dates).toEqual(['2026-08-30', '2026-08-23', '2026-08-22', '2026-08-29']);
		});

		it('лежащие сверху выполненные остаются на месте', async () => {
			// Файл, сложившийся раньше: выполненные сверху, актуальный внизу.
			await setup({
				files: {
					'note.md': taskFileText(
						{ date: '2026-08-23', done: '2026-08-22', body: ['- [x] Дело'] },
						{ date: '2026-08-29', done: '2026-08-22', body: ['- [x] Дело'] },
						{
							date: '2026-08-30',
							repeat: 'Каждую неделю в Субботу, Воскресенье',
							body: ['- [ ] Дело'],
						},
					),
				},
			});

			await map.toggleCheckbox(chain()!.key, 0);

			const dates = (double.vault.contentOf('note.md') ?? '')
				.split('\n')
				.filter((line) => line.startsWith('- 📅'))
				.map((line) => line.slice('- 📅 '.length));

			// Новый блок встал над закрытым, верх файла не тронут.
			expect(dates).toEqual(['2026-08-23', '2026-08-29', '2026-09-05', '2026-08-30']);
		});

		it('череда перескакивает день, у которого уже есть блок', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');

			// Закрываем текущий: 23-е свободно.
			await map.toggleCheckbox(chain()!.key, 0);
			expect(chain()).toMatchObject({ date: '2026-08-23' });

			// Закрываем 23-е: 29-е занято отмеченным наперёд блоком, идём на 30-е.
			await map.toggleCheckbox(chain()!.key, 0);
			expect(chain()).toMatchObject({ date: '2026-08-30' });
		});

		it('день карточки совпал с датой показа - новый блок не заводится', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-22');

			expect(map.all().filter((task) => task.repeat !== null)).toHaveLength(1);
			expect(double.vault.contentOf('note.md')).toContain('- 📅 2026-08-23');
		});

		it('мусорный день блока не заводит', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, 'суббота');

			// Отметка ушла в текущий блок, как обычная.
			expect(map.all()).toHaveLength(2);
			expect(chain()).toMatchObject({ date: '2026-08-23' });
		});
	});

	describe('перенос задачи', () => {
		const chain = () => map.all().find((task) => task.repeat !== null);

		it('разовая задача просто получает другую 📅', async () => {
			await setup({ files: { 'note.md': taskFileText({ date: '2026-08-13' }) } });

			await map.moveTask('/note.md#0', '2026-08-20');

			expect(map.all()).toHaveLength(1);
			expect(map.all()[0]).toMatchObject({ date: '2026-08-20' });
			expect(double.vault.contentOf('note.md')).not.toContain('2026-08-13');
		});

		it('повторная: экземпляр уходит вниз с ↔️, череда шагает дальше', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-22',
						repeat: 'Каждую неделю в Субботу',
						body: ['- [ ] Полить фикус'],
					}),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25');

			// 📅 остаётся днём череды - он занят, и череда его перескочит.
			// ↔️ - день показа: точка в календаре переезжает на него.
			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- 📅 2026-08-29',
				'- 🔁 Каждую неделю в Субботу',
				'\t- [ ] Полить фикус',
				'- 📅 2026-08-22',
				'- ↔️ 2026-08-25',
				'\t- [ ] Полить фикус',
				'',
			].join('\n'));
		});

		it('перенесённый блок повтора не ведёт', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-22', repeat: 'Каждую неделю в Субботу' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25');

			expect(map.all().find((task) => task.move === '2026-08-25')).toMatchObject({
				date: '2026-08-22',
				repeat: null,
				done: null,
			});
		});

		it('перенос назад череду не возвращает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-22', repeat: 'Каждую неделю в Субботу' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-21');

			expect(chain()).toMatchObject({ date: '2026-08-29' });
			expect(map.all().map(showDate).sort()).toEqual(['2026-08-21', '2026-08-29']);
		});

		it('перенос на занятый чередой день её через него перешагивает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-22',
						repeat: 'Каждую неделю в Субботу, Воскресенье',
					}),
				},
			});

			// Переносим ровно на следующий день череды - он занят перенесённым.
			await map.moveTask('/note.md#0', '2026-08-23');

			expect(chain()).toMatchObject({ date: '2026-08-29' });
		});

		it('отметки переезжают с экземпляром, череда начинает с чистого тела', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-22',
						repeat: 'Каждую неделю в Субботу',
						body: ['- [x] Раз', '- [ ] Два'],
					}),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25');

			expect(map.all().find((task) => task.move === '2026-08-25')?.body)
				.toBe('- [x] Раз\n- [ ] Два');
			expect(chain()?.body).toBe('- [ ] Раз\n- [ ] Два');
		});

		it('имя файла при переносе не меняется', async () => {
			await setup({
				files: { 'Задачи/2026-08-13 - Дело.md': taskFileText({ date: '2026-08-13' }) },
				tasksFolderPath: '/Задачи',
			});

			await map.moveTask('/Задачи/2026-08-13 - Дело.md#0', '2026-08-20');

			expect(double.vault.paths()).toEqual(['Задачи/2026-08-13 - Дело.md']);
		});

		it('мусорную дату не пишет', async () => {
			await setup({ files: { 'note.md': taskFileText({ date: '2026-08-13' }) } });

			await map.moveTask('/note.md#0', 'завтра');

			expect(double.vault.calls.process).toBe(0);
		});

		it('перенос на тот же день ничего не пишет', async () => {
			await setup({ files: { 'note.md': taskFileText({ date: '2026-08-13' }) } });

			await map.moveTask('/note.md#0', '2026-08-13');

			expect(double.vault.calls.process).toBe(0);
		});

		it('перенос с расчётного дня череды уносит его, а день блока остаётся', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-29',
						repeat: 'Каждую неделю в Субботу, Воскресенье',
						body: ['- [ ] Полить фикус'],
					}),
				},
			});

			// 30 августа - воскресенье, расчётный день череды: своего блока у него нет.
			await map.moveTask('/note.md#0', '2026-09-03', '2026-08-30');

			// Суббота 29-го осталась блоком цепочки, воскресенье уехало своим блоком.
			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- 📅 2026-08-29',
				'- 🔁 Каждую неделю в Субботу, Воскресенье',
				'\t- [ ] Полить фикус',
				'- 📅 2026-08-30',
				'- ↔️ 2026-09-03',
				'\t- [ ] Полить фикус',
				'',
			].join('\n'));
		});

		it('перенос расчётного дня череду не двигает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-20', '2026-08-16');

			expect(chain()).toMatchObject({ date: '2026-08-13', move: null });
			expect(map.all().find((task) => task.move === '2026-08-20'))
				.toMatchObject({ date: '2026-08-16', repeat: null });
		});

		it('уехавший день череда перескакивает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			// 14-е уехало на 20-е: череда не встанет ни на 14-е, ни на 20-е.
			await map.moveTask('/note.md#0', '2026-08-20', '2026-08-14');
			// Закрываем текущий блок - следующий встаёт на первый свободный день.
			await map.toggleCheckbox('/note.md#0', 0);

			expect(chain()).toMatchObject({ date: '2026-08-15' });
		});

		it('день показа перенесённого череда тоже перескакивает', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			// 14-е уехало на 15-е: заняты оба дня, череде остаётся 16-е.
			await map.moveTask('/note.md#0', '2026-08-15', '2026-08-14');
			await map.toggleCheckbox('/note.md#0', 0);

			expect(chain()).toMatchObject({ date: '2026-08-16' });
		});

		it('отметка перенесённого блока просто закрывает его', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', move: '2026-08-20' }),
				},
			});

			// День карточки - день показа: свой блок дня заводить не надо, блок уже есть.
			await map.toggleCheckbox('/note.md#0', 0, '2026-08-20');

			expect(map.all()).toHaveLength(1);
			expect(map.all()[0]).toMatchObject({ date: '2026-08-13', move: '2026-08-20', done: TODAY });
		});

		it('перенос уже перенесённого меняет ↔️, а не 📅', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', move: '2026-08-20' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25');

			expect(map.all()[0]).toMatchObject({ date: '2026-08-13', move: '2026-08-25' });
			expect(double.vault.contentOf('note.md')).not.toContain('2026-08-20');
		});

		it('перенесённый расчётный день начинает с чистого тела', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-22',
						repeat: 'Каждую неделю в Субботу, Воскресенье',
						body: ['- [x] Раз', '- [ ] Два'],
					}),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25', '2026-08-23');

			// Отметки принадлежат экземпляру блока - он и остаётся с ними на своём дне.
			expect(chain()).toMatchObject({ date: '2026-08-22' });
			expect(chain()?.body).toBe('- [x] Раз\n- [ ] Два');
			expect(map.all().find((task) => task.move === '2026-08-25')?.body)
				.toBe('- [ ] Раз\n- [ ] Два');
		});

		it('перенос перенесённого на день его показа ничего не пишет', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', move: '2026-08-20' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-20');

			expect(double.vault.calls.process).toBe(0);
		});

		it('перенос расчётного дня на него же ничего не пишет', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-16', '2026-08-16');

			expect(double.vault.calls.process).toBe(0);
		});
	});

	describe('создание задачи', () => {
		it('имя файла из даты и текста, тело - один снятый чекбокс', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			const path = await map.createTask('2026-08-20', 'Купить молоко / творог');

			expect(path).toBe('2026-08-20 - Купить молоко творог.md');
			expect(double.vault.contentOf(path!)).toBe(
				'\n- 📅 2026-08-20\n\t- [ ] Купить молоко / творог\n'
			);
			expect(map.all()[0]).toMatchObject({ date: '2026-08-20', body: '- [ ] Купить молоко / творог' });
		});

		it('второй задаче с тем же именем дописывается номер', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			await map.createTask('2026-08-20', 'Дело');
			const second = await map.createTask('2026-08-20', 'Дело');

			expect(second).toBe('2026-08-20 - Дело 2.md');
			expect(double.vault.paths().sort()).toEqual([
				'2026-08-20 - Дело 2.md',
				'2026-08-20 - Дело.md',
			]);
		});

		it('папки задач нет - создаётся при первой записи', async () => {
			await setup({ files: {}, tasksFolderPath: '/Календарь задач' });

			const path = await map.createTask('2026-08-20', 'Дело');

			expect(path).toBe('Календарь задач/2026-08-20 - Дело.md');
			expect(map.all()).toHaveLength(1);
		});

		it('пустой текст задачу не создаёт', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			expect(await map.createTask('2026-08-20', '   ')).toBeNull();
			expect(double.vault.paths()).toHaveLength(0);
		});
	});

	describe('события хранилища', () => {
		it('созданный файл попадает в карту', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			await double.vault.create('новая.md', taskFileText({ date: '2026-08-13' }));
			await settle();

			expect(map.all()).toHaveLength(1);
		});

		it('удалённый файл уходит из карты', async () => {
			await setup({ files: { 'note.md': taskFileText() } });

			await double.vault.delete(fileOf('note.md'));
			await settle();

			expect(map.all()).toHaveLength(0);
		});

		it('унесённая из папки задача уходит из карты по старому пути', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: { 'Задачи/note.md': taskFileText() },
				folders: ['Задачи', 'Другое'],
			});

			await double.vault.rename(fileOf('Задачи/note.md'), 'Другое/note.md');
			await settle();

			expect(map.all()).toHaveLength(0);
		});

		it('удалённая папка уносит с собой все свои задачи', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: {
					'Задачи/вложенная/раз.md': taskFileText(),
					'Задачи/вложенная/два.md': taskFileText(),
					'Задачи/своя.md': taskFileText(),
				},
			});

			// Obsidian шлёт одно событие на папку, а не на каждый файл внутри.
			await double.vault.deleteFolder('Задачи/вложенная');
			await settle();

			expect(map.all().map((task) => task.key)).toEqual(['/Задачи/своя.md#0']);
		});

		it('папка, принесённая в папку задач, разбирается целиком', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				folders: ['Задачи', 'Черновики'],
				files: { 'Черновики/раз.md': taskFileText(), 'Черновики/два.md': taskFileText() },
			});

			expect(map.all()).toHaveLength(0);

			await double.vault.renameFolder('Черновики', 'Задачи/Черновики');
			await settle();

			expect(map.all().map((task) => task.key).sort()).toEqual([
				'/Задачи/Черновики/два.md#0',
				'/Задачи/Черновики/раз.md#0',
			]);
		});

		it('после stop события не обрабатываются', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			map.stop();
			await double.vault.create('новая.md', taskFileText());
			await settle();

			expect(map.all()).toHaveLength(0);
		});

		it('смена папки в настройках пересобирает карту', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: {
					'Задачи/своя.md': taskFileText(),
					'Другое/чужая.md': taskFileText(),
				},
			});

			expect(map.all()).toHaveLength(1);

			double.plugin.settings.tasksFolderPath = '/Другое';
			await map.refresh();

			expect(map.all().map((task) => task.key)).toEqual(['/Другое/чужая.md#0']);
		});
	});

	describe('подписчики', () => {
		it('получают уведомление об изменении и отписываются', async () => {
			await setup({ files: { 'note.md': taskFileText() } });

			const listener = vi.fn();
			const unsubscribe = map.onChange(listener);

			await map.toggleCheckbox('/note.md#0', 0);
			expect(listener).toHaveBeenCalled();

			unsubscribe();
			listener.mockClear();

			await map.toggleCheckbox('/note.md#0', 0);
			expect(listener).not.toHaveBeenCalled();
		});
	});
});
