import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			// Пакет obsidian содержит только .d.ts, рантайма нет - подменяем моком.
			obsidian: `${root}test/mocks/obsidian.ts`,
		},
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./test/setup.ts'],
		include: ['test/**/*.test.ts'],
	},
});
