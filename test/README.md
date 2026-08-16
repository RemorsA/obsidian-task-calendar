# Тесты

```bash
npm test           # разовый прогон
npm run test:watch # watch
npm run typecheck  # tsc -noEmit (только .ts, .vue он не проверяет)
```

Раннер - vitest 2 + jsdom + @vue/test-utils. Версии подобраны под Node 18:
vite 5 и vitest 2, выше требуют Node 20+. Установка делалась с
`--legacy-peer-deps` из-за `@types/node@16` в проекте.

## Что где

| Файл | Назначение |
|---|---|
| `mocks/obsidian.ts` | Мок API Obsidian: Vault с файлами и событиями, Plugin, ItemView, Setting, Notice, debounce |
| `helpers.ts` | Фиксированные часы (13.08.2026) и плагин-двойник для монтирования компонента |
| `setup.ts` | Глобальный `moment` и полифил `Element.empty()` - в Obsidian их даёт приложение |
| `TaskCalendar.test.ts` | Сетка, навигация, разбор задач, создание, подписки, загрузка |
| `main.test.ts` | Настройки, onload, openCalendar, жизненный цикл view, вкладка настроек |

Пакет `obsidian` содержит только `.d.ts`, рантайма у него нет - поэтому в
`vitest.config.mts` он и bare-импорт `main` подменяются алиасами.

## Соглашения

- Время фиксировано: `useFixedClock()` подменяет только `Date`, `setTimeout` и
  `clearTimeout`. `setImmediate` должен остаться настоящим, иначе `flushPromises`
  из @vue/test-utils зависает.
- Сегодня в тестах - четверг 13.08.2026, сетка августа стартует с 27 июля.
- `v-show` проверяется через инлайновый `style.display` (`isShown`), а не через
  `isVisible()`: jsdom нестабильно считает `getComputedStyle` для элементов,
  которым display выставили после монтирования.
- Тесты с префиксом **ЗАФИКСИРОВАН ДЕФЕКТ** закрепляют текущее *неверное*
  поведение, чтобы починка была заметна: такой тест упадёт, когда баг исправят,
  и его надо будет переписать на ожидаемое поведение.
