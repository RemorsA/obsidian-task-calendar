declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component: DefineComponent<Record<string, never>, Record<string, never>, Record<string, unknown>>;
	export default component;
}

declare function moment(inp?: unknown, strict?: boolean): moment.Moment;
declare function moment(inp?: unknown, format?: unknown, strict?: boolean): moment.Moment;
declare namespace moment {
	interface Moment {
		clone(): Moment;
		month(): number;
		month(month: number | string): Moment;
		year(): number;
		year(year: number): Moment;
		date(): number;
		date(date: number): Moment;
		day(): number;
		startOf(unit: string): Moment;
		endOf(unit: string): Moment;
		subtract(amount: number, unit: string): Moment;
		add(amount: number, unit: string): Moment;
		isSame(other: Moment, unit?: string): boolean;
		isBefore(other: Moment, unit?: string): boolean;
		format(format?: string): string;
	}
}

