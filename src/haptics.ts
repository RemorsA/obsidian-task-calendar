import { Platform } from 'obsidian';

/** Модуль тактильной отдачи Capacitor: нужен только удар. */
interface CapacitorHaptics {
	impact(options: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void>;
}

/** Длительность запасной вибрации - как у переключателей самого Obsidian. */
const VIBRATE_MS = 100;

/** Модуль Haptics, если Obsidian на телефоне его подключил. */
const capacitorHaptics = (): CapacitorHaptics | null =>
	(window as unknown as { Capacitor?: { Plugins?: { Haptics?: CapacitorHaptics } } })
		.Capacitor?.Plugins?.Haptics ?? null;

/** Вибрация браузера. На iOS её нет, на компьютере она ничего не делает. */
const fallbackVibrate = (): void => {
	try {
		navigator.vibrate?.(VIBRATE_MS);
	} catch {
		// Вибрации нет - отклик не обязателен.
	}
};

/**
 * Короткий отклик вибрацией на телефоне - на галочку в списке (просьба
 * пользователя 13.11.2026). На компьютере ничего не делает.
 *
 * Сначала нативный модуль Haptics: Obsidian на телефоне построен на Capacitor и
 * подключает его сам (`registerPlugin("Haptics")`, сверено по `app.js` Obsidian
 * 1.15.1). На iOS это единственный путь - `navigator.vibrate` там нет. Модуля нет
 * или удар не прошёл - `navigator.vibrate`, как у переключателей Obsidian.
 *
 * `window.Capacitor` - не публичный API плагинов: нет его - запасной путь.
 */
export const vibrate = (): void => {
	if (!Platform.isMobile) return;

	const haptics = capacitorHaptics();

	if (!haptics) {
		fallbackVibrate();

		return;
	}

	try {
		haptics.impact({ style: 'MEDIUM' }).catch(fallbackVibrate);
	} catch {
		fallbackVibrate();
	}
};
