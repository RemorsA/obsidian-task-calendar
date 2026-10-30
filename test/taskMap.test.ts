import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice, TFile } from './mocks/obsidian';
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
		it('собирает задачи со всего хранилища, папка из настроек скан не ограничивает', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: {
					'корень.md': taskFileText({ date: '2026-08-12' }),
					'Задачи/раз.md': taskFileText({ date: '2026-08-13' }),
					'Задачи/вложенная/два.md': taskFileText({ date: '2026-08-14' }),
					'Другое/три.md': taskFileText({ date: '2026-08-15' }),
				},
			});

			expect(map.all().map((task) => task.key).sort()).toEqual([
				'/Другое/три.md#0',
				'/Задачи/вложенная/два.md#0',
				'/Задачи/раз.md#0',
				'/корень.md#0',
			]);
		});

		it('не заметки Markdown не читаются', async () => {
			await setup({
				files: { 'note.md': taskFileText(), 'note.txt': taskFileText() },
			});

			expect(map.all().map((task) => task.key)).toEqual(['/note.md#0']);
			expect(double.vault.calls.cachedRead).toBe(1);
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
				files: { 'note.md': taskFileText({ date: '2026-08-13', body: ['- [ ] Раз', '\t- [ ] Два'] }) },
			});

			await map.toggleCheckbox('/note.md#0', 0);
			expect(double.vault.contentOf('note.md')).not.toContain('✅');

			await map.toggleCheckbox('/note.md#0', 1);

			expect(double.vault.contentOf('note.md')).toBe([
				'',
				`- [x] Раз 📅 2026-08-13 ✅ ${TODAY}`,
				'\t- [x] Два',
				'',
			].join('\n'));
			expect(map.all()[0].done).toBe(TODAY);
		});

		it('отмечена строка задачи, подзадача нет - задача не выполнена', async () => {
			await setup({
				files: { 'note.md': taskFileText({ date: '2026-08-13', body: ['- [ ] Раз', '\t- [ ] Два'] }) },
			});

			await map.toggleCheckbox('/note.md#0', 0);

			expect(double.vault.contentOf('note.md')).not.toContain('✅');
			expect(map.all()[0].done).toBeNull();
		});

		it('все отмечены -> не все: убирает ✅', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-13',
						done: '2026-08-13',
						body: ['- [x] Раз', '\t- [x] Два'],
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
				'- [ ] Купить молоко 📅 2026-08-14 🔁 Каждый день',
				`- [x] Купить молоко 📅 2026-08-13 ✅ ${TODAY}`,
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

			expect(double.vault.contentOf('note.md')).toContain('📅 2026-09-05');
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

			expect(double.vault.contentOf('note.md')).toContain(`✅ ${TODAY}`);
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

			expect(content).toContain('📅 2026-08-14');
			expect(content).toContain(`✅ ${TODAY}`);
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
					body: ['- [x] Дело', '\t- [ ] Ещё'],
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
					body: ['- [x] Дело', '\t- [x] Ещё'],
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
				taskFileText({ date: '2026-08-13', body: ['- [ ] Дело', '\t- [ ] Ещё'] })
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

		/** 📅 строк задач файла сверху вниз - порядок блоков в файле. */
		const datesInFile = (path: string): string[] => (double.vault.contentOf(path) ?? '')
			.split('\n')
			.map((line) => line.match(/^- .*📅 (\S+)/u)?.[1])
			.filter((date): date is string => date !== undefined);

		it('заводит блок этого дня и закрывает только его', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');

			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- [ ] Дело 📅 2026-08-22 🔁 Каждую неделю в Субботу, Воскресенье',
				`- [x] Дело 📅 2026-08-29 ✅ ${TODAY}`,
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
						body: ['- [x] Раз', '\t- [ ] Два'],
					}),
				},
			});

			await map.toggleCheckbox('/note.md#0', 1, '2026-08-29');

			const day = map.all().find((task) => task.date === '2026-08-29');

			// Отмечена только та подзадача, по которой кликнули.
			expect(day?.body).toBe('- [ ] Раз\n\t- [x] Два');
			expect(day?.done).toBeNull();
		});

		it('новый выполненный уходит в конец, остальные блоки не двигаются', async () => {
			await setup(weekend());

			await map.toggleCheckbox('/note.md#0', 0, '2026-08-29');
			await map.toggleCheckbox(chain()!.key, 0);
			await map.toggleCheckbox(chain()!.key, 0);

			const dates = datesInFile('note.md');

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

			const dates = datesInFile('note.md');

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
			expect(double.vault.contentOf('note.md')).toContain('📅 2026-08-23');
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

		it('повторная: экземпляр уходит вниз с новой 📅, череда шагает дальше', async () => {
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

			// Новая дата - сразу в 📅, ↔️ плагин больше не пишет.
			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- [ ] Полить фикус 📅 2026-08-29 🔁 Каждую неделю в Субботу',
				'- [ ] Полить фикус 📅 2026-08-25',
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

			expect(map.all().find((task) => task.date === '2026-08-25')).toMatchObject({
				move: null,
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
						body: ['- [x] Раз', '\t- [ ] Два'],
					}),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25');

			expect(map.all().find((task) => task.date === '2026-08-25')?.body)
				.toBe('- [x] Раз\n\t- [ ] Два');
			expect(chain()?.body).toBe('- [ ] Раз\n\t- [ ] Два');
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

		it('перенос с расчётного дня заводит экземпляр на новую дату, блок череды на месте', async () => {
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

			// Суббота 29-го осталась блоком цепочки, на четверг 3-е встал свой блок.
			expect(double.vault.contentOf('note.md')).toBe([
				'',
				'- [ ] Полить фикус 📅 2026-08-29 🔁 Каждую неделю в Субботу, Воскресенье',
				'- [ ] Полить фикус 📅 2026-09-03',
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
			expect(map.all().find((task) => task.date === '2026-08-20'))
				.toMatchObject({ move: null, repeat: null });
		});

		it('новую дату перенесённого расчётного дня череда перескакивает, а сам день - нет', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', repeat: 'Каждый день' }),
				},
			});

			// 14-е перенесли на 15-е. Без ↔️ пометить 14-е занятым нечем: череда на
			// него встанет. Занято только 15-е - там теперь блок экземпляра.
			await map.moveTask('/note.md#0', '2026-08-15', '2026-08-14');
			await map.toggleCheckbox('/note.md#0', 0);
			expect(chain()).toMatchObject({ date: '2026-08-14' });

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

		it('перенос блока со старой ↔️ пишет новую 📅 и убирает ↔️', async () => {
			await setup({
				files: {
					'note.md': taskFileText({ date: '2026-08-13', move: '2026-08-20' }),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25');

			expect(map.all()[0]).toMatchObject({ date: '2026-08-25', move: null });
			expect(double.vault.contentOf('note.md')).toBe('\n- [ ] Задача 📅 2026-08-25\n');
		});

		it('перенесённый расчётный день начинает с чистого тела', async () => {
			await setup({
				files: {
					'note.md': taskFileText({
						date: '2026-08-22',
						repeat: 'Каждую неделю в Субботу, Воскресенье',
						body: ['- [x] Раз', '\t- [ ] Два'],
					}),
				},
			});

			await map.moveTask('/note.md#0', '2026-08-25', '2026-08-23');

			// Отметки принадлежат экземпляру блока - он и остаётся с ними на своём дне.
			expect(chain()).toMatchObject({ date: '2026-08-22' });
			expect(chain()?.body).toBe('- [x] Раз\n\t- [ ] Два');
			expect(map.all().find((task) => task.date === '2026-08-25')?.body)
				.toBe('- [ ] Раз\n\t- [ ] Два');
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

	describe('несколько задач в одном месячном файле', () => {
		/** Ежедневная задача сегодня и чужие блоки рядом с ней. */
		const monthFile = (...others: Parameters<typeof taskFileText>) => ({
			'2026-08.md': taskFileText(
				{ date: TODAY, repeat: 'Каждый день', body: ['- [ ] Полить фикус'] },
				...others,
			),
		});

		/** Текущий блок цепочки - тот, у которого остался 🔁. */
		const chainDate = (): string | undefined =>
			map.all().find((task) => task.repeat !== null)?.date;

		it('повтор не перескакивает день чужой задачи', async () => {
			await setup({ files: monthFile({ date: '2026-08-14', body: ['- [ ] Позвонить'] }) });

			await map.toggleCheckbox('/2026-08.md#0', 0);

			expect(chainDate()).toBe('2026-08-14');
		});

		it('свой занятый день перескакивает, чужой - нет', async () => {
			await setup({
				files: monthFile(
					{ date: '2026-08-14', done: TODAY, body: ['- [x] Полить фикус'] },
					{ date: '2026-08-15', body: ['- [ ] Позвонить'] },
				),
			});

			await map.toggleCheckbox('/2026-08.md#0', 0);

			expect(chainDate()).toBe('2026-08-15');
		});

		it('перенос: череда шагает на ближайший день, занятый чужой задачей', async () => {
			await setup({ files: monthFile({ date: '2026-08-14', body: ['- [ ] Позвонить'] }) });

			await map.moveTask('/2026-08.md#0', '2026-08-20');

			expect(chainDate()).toBe('2026-08-14');
		});
	});

	describe('создание задачи', () => {
		it('файла года нет - создаётся YYYY.md с одной задачей', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			const path = await map.createTask('2026-08-20', 'Купить молоко / творог');

			expect(path).toBe('2026.md');
			expect(double.vault.contentOf(path!)).toBe(
				'\n- [ ] Купить молоко / творог 📅 2026-08-20\n'
			);
			expect(map.all()[0]).toMatchObject({ date: '2026-08-20', body: '- [ ] Купить молоко / творог' });
		});

		it('файл года есть - задача любого месяца дописывается под всеми задачами', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			await map.createTask('2026-08-20', 'Раз');
			const second = await map.createTask('2026-11-05', 'Два');

			expect(second).toBe('2026.md');
			expect(double.vault.paths()).toEqual(['2026.md']);
			expect(double.vault.contentOf('2026.md')).toBe([
				'',
				'- [ ] Раз 📅 2026-08-20',
				'- [ ] Два 📅 2026-11-05',
				'',
			].join('\n'));
			expect(map.all().map((task) => [task.key, task.date])).toEqual([
				['/2026.md#0', '2026-08-20'],
				['/2026.md#1', '2026-11-05'],
			]);
		});

		it('год берётся по дате задачи, а не по сегодняшнему дню', async () => {
			await setup({ files: {}, tasksFolderPath: '/' });

			expect(await map.createTask('2027-01-05', 'Зимой')).toBe('2027.md');
			expect(await map.createTask(TODAY, 'Сегодня')).toBe('2026.md');
		});

		it('прежний месячный файл не трогается: новая задача идёт в годовой', async () => {
			const month = taskFileText({ date: '2026-08-14', body: ['- [ ] Старая'] });
			await setup({ files: { '2026-08.md': month }, tasksFolderPath: '/' });

			expect(await map.createTask('2026-08-20', 'Новая')).toBe('2026.md');
			expect(double.vault.contentOf('2026-08.md')).toBe(month);
			expect(map.all()).toHaveLength(2);
		});

		it('лежащие в файле блоки не двигаются и автоматику не будят', async () => {
			const before = taskFileText(
				{ date: '2026-08-14', repeat: 'Каждый день', body: ['- [ ] Полить фикус'] },
				{ date: TODAY, done: TODAY, body: ['- [x] Полить фикус'] },
			);
			await setup({ files: { 'Задачи/2026.md': before }, tasksFolderPath: '/Задачи' });

			await map.createTask('2026-08-20', 'Дело');

			expect(double.vault.contentOf('Задачи/2026.md')).toBe([
				'',
				'- [ ] Полить фикус 📅 2026-08-14 🔁 Каждый день',
				`- [x] Полить фикус 📅 ${TODAY} ✅ ${TODAY}`,
				'- [ ] Дело 📅 2026-08-20',
				'',
			].join('\n'));
			expect(double.vault.calls.process).toBe(1);
			expect(map.all()).toHaveLength(3);
		});

		it('файл года не записался - null и сообщение, карта прежняя', async () => {
			await setup({ files: { '2026.md': taskFileText() }, tasksFolderPath: '/' });
			double.vault.failures.modify = new Set(['2026.md']);
			vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await map.createTask('2026-08-20', 'Дело')).toBeNull();
			expect(Notice.messages).toContain('Не удалось создать задачу');
			expect(map.all()).toHaveLength(1);
		});

		it('папки задач нет - создаётся при первой записи', async () => {
			await setup({ files: {}, tasksFolderPath: '/Календарь задач' });

			const path = await map.createTask('2026-08-20', 'Дело');

			expect(path).toBe('Календарь задач/2026.md');
			expect(map.all()).toHaveLength(1);
		});

		it('папка для новых задач читается в момент создания, без пересбора карты', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: { 'note.md': taskFileText() },
				folders: ['Задачи', 'Другое'],
			});

			double.plugin.settings.tasksFolderPath = '/Другое';
			const path = await map.createTask('2026-08-20', 'Дело');

			expect(path).toBe('Другое/2026.md');
			expect(map.all().map((task) => task.key).sort()).toEqual([
				'/note.md#0',
				'/Другое/2026.md#0',
			]);
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

		it('переехавшая задача остаётся в карте одна, по новому пути', async () => {
			await setup({
				tasksFolderPath: '/Задачи',
				files: { 'Задачи/note.md': taskFileText() },
				folders: ['Задачи', 'Другое'],
			});

			await double.vault.rename(fileOf('Задачи/note.md'), 'Другое/note.md');
			await settle();

			expect(map.all().map((task) => task.key)).toEqual(['/Другое/note.md#0']);
		});

		it('файл, переименованный не в .md, уходит из карты', async () => {
			await setup({ files: { 'note.md': taskFileText() } });

			await double.vault.rename(fileOf('note.md'), 'note.txt');
			await settle();

			expect(map.all()).toHaveLength(0);
		});

		it('удалённая папка уносит с собой все свои задачи', async () => {
			await setup({
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

		it('переехавшая папка переезжает в карте целиком', async () => {
			await setup({
				folders: ['Задачи', 'Черновики'],
				files: { 'Черновики/раз.md': taskFileText(), 'Черновики/два.md': taskFileText() },
			});

			expect(map.all()).toHaveLength(2);

			// Obsidian шлёт одно событие на папку, а не на каждый файл внутри.
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

	});

	describe('строки блока для подсветки', () => {
		it('блок в середине файла - от строки задачи до последней строки тела', async () => {
			await setup({
				files: {
					'note.md': taskFileText(
						{ date: '2026-08-14', repeat: 'Каждый день' },
						{
							date: '2026-08-13',
							done: '2026-08-13',
							body: ['- [x] Задача', '\t- [x] Подзадача'],
						},
						{ date: '2026-08-12', done: '2026-08-12', body: ['- [x] Задача'] },
					),
				},
			});

			// Строка 0 - пустая, первый блок занимает строку 1, второй - 2 и 3.
			expect(await map.locate('/note.md#1')).toEqual({
				start: { line: 2, col: 0 },
				end: { line: 3, col: '\t- [x] Подзадача'.length },
			});
		});

		it('номер блока считает и невалидные блоки', async () => {
			await setup({
				files: {
					'note.md': [
						'',
						'- [ ] Черновик 🔁 Каждый день',
						'\tпросто текст, даты нет',
						'- [ ] Задача 📅 2026-08-14',
						'\t- [ ] Подзадача',
						'',
					].join('\n'),
				},
			});

			const [task] = map.all();

			expect(task.key).toBe('/note.md#1');
			expect(await map.locate(task.key)).toEqual({
				start: { line: 3, col: 0 },
				end: { line: 4, col: '\t- [ ] Подзадача'.length },
			});
		});

		it('подсветка кончается на теле задачи, заголовок и список ниже не захватывает', async () => {
			await setup({
				files: {
					'note.md': [
						'# Тромбофилия',
						'',
						'- [ ] Записаться на сдачу 📅 2026-10-19',
						'\t- [ ] Взять направление',
						'',
						'# Кожа',
						'- [ ] Сходить к дерматологу',
						'\t- [ ] Акне',
						'',
					].join('\n'),
				},
			});

			expect(await map.locate('/note.md#0')).toEqual({
				start: { line: 2, col: 0 },
				end: { line: 3, col: '\t- [ ] Взять направление'.length },
			});
		});

		it('неизвестная задача - null', async () => {
			await setup({ files: { 'note.md': taskFileText() } });

			expect(await map.locate('/нет.md#0')).toBeNull();
		});

		it('файл не прочитался - null, без исключения', async () => {
			await setup({ files: { 'note.md': taskFileText() } });
			double.vault.failures.read = new Set(['note.md']);
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await map.locate('/note.md#0')).toBeNull();
			expect(consoleError).toHaveBeenCalled();
		});

		it('поиск строк файл не правит', async () => {
			await setup({ files: { 'note.md': taskFileText() } });

			await map.locate('/note.md#0');

			expect(double.vault.calls.process).toBe(0);
			expect(double.vault.calls.modify).toBe(0);
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
