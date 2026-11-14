import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { vibrate } from '../src/haptics';
import { Platform } from './mocks/obsidian';

type CapacitorWindow = Window & { Capacitor?: unknown };

const vibrateSpy = vi.fn();

/** Модуль Haptics, как его подключает Obsidian на телефоне. */
const installHaptics = (impact: () => Promise<void>) => {
	const haptics = { impact: vi.fn(impact) };
	(window as CapacitorWindow).Capacitor = { Plugins: { Haptics: haptics } };

	return haptics;
};

beforeEach(() => {
	Platform.isMobile = true;
	vibrateSpy.mockReset();
	Object.defineProperty(navigator, 'vibrate', { value: vibrateSpy, configurable: true });
});

afterEach(() => {
	Platform.isMobile = false;
	delete (window as CapacitorWindow).Capacitor;
	Reflect.deleteProperty(navigator, 'vibrate');
});

describe('вибрация', () => {
	it('на компьютере ничего не делает', () => {
		Platform.isMobile = false;
		const haptics = installHaptics(async () => undefined);

		vibrate();

		expect(haptics.impact).not.toHaveBeenCalled();
		expect(vibrateSpy).not.toHaveBeenCalled();
	});

	it('на телефоне - нативный удар Haptics, без запасной вибрации', async () => {
		const haptics = installHaptics(async () => undefined);

		vibrate();
		await flushPromises();

		expect(haptics.impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
		expect(vibrateSpy).not.toHaveBeenCalled();
	});

	it('модуля Haptics нет - вибрация браузера, как у переключателей Obsidian', () => {
		vibrate();

		expect(vibrateSpy).toHaveBeenCalledWith(100);
	});

	it('удар Haptics не прошёл - вибрация браузера', async () => {
		installHaptics(async () => { throw new Error('нет вибромотора'); });

		vibrate();
		await flushPromises();

		expect(vibrateSpy).toHaveBeenCalledWith(100);
	});

	it('вибрации нет совсем (iOS без модуля) - тихо, без ошибки', () => {
		Reflect.deleteProperty(navigator, 'vibrate');

		expect(() => vibrate()).not.toThrow();
	});
});
