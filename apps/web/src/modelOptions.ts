export interface BenchmarkModelOption {
	value: string;
	label: string;
	owner: "OpenAI" | "Anthropic" | "Google" | "Unknown";
	provider?: string;
	kind?: "latest" | "pinned" | string;
	family?: string | null;
	fallback?: string | null;
	resolvedValue?: string | null;
}

export const BENCHMARK_MODEL_OPTIONS: BenchmarkModelOption[] = [
	{
		value: "openai:gpt:latest",
		label: "GPT 5.5",
		owner: "OpenAI",
		provider: "openai",
		kind: "latest",
		fallback: "gpt-5.5",
	},
	{
		value: "anthropic:opus:latest",
		label: "Claude Opus 4.7",
		owner: "Anthropic",
		provider: "anthropic",
		kind: "latest",
		fallback: "claude-opus-4-7",
	},
	{
		value: "anthropic:sonnet:latest",
		label: "Claude Sonnet 4.6",
		owner: "Anthropic",
		provider: "anthropic",
		kind: "latest",
		fallback: "claude-sonnet-4-6",
	},
	{
		value: "google:flash:latest",
		label: "Gemini 3 Flash Preview",
		owner: "Google",
		provider: "google",
		kind: "latest",
		fallback: "gemini-3-flash-preview",
	},
	{
		value: "gpt-4o-mini",
		label: "GPT-4o mini",
		owner: "OpenAI",
		provider: "openai",
		kind: "pinned",
	},
	{
		value: "gpt-4o",
		label: "GPT-4o",
		owner: "OpenAI",
		provider: "openai",
		kind: "pinned",
	},
	{
		value: "gpt-5.2",
		label: "GPT 5.2",
		owner: "OpenAI",
		provider: "openai",
		kind: "pinned",
	},
	{
		value: "claude-sonnet-4-5-20250929",
		label: "Claude Sonnet 4.5",
		owner: "Anthropic",
		provider: "anthropic",
		kind: "pinned",
	},
	{
		value: "claude-opus-4-5-20251101",
		label: "Claude Opus 4.5",
		owner: "Anthropic",
		provider: "anthropic",
		kind: "pinned",
	},
	{
		value: "gemini-2.5-flash",
		label: "Gemini 2.5 Flash",
		owner: "Google",
		provider: "google",
		kind: "pinned",
	},
];

export const BENCHMARK_MODEL_VALUES = BENCHMARK_MODEL_OPTIONS.map(
	(option) => option.value,
);

const SHOW_LOCAL_CHATGPT_WEB_MODEL =
	import.meta.env.DEV ||
	(typeof window !== "undefined" &&
		(window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1"));

export const PROMPT_LAB_MODEL_OPTIONS: BenchmarkModelOption[] = [
	...BENCHMARK_MODEL_OPTIONS,
	...(SHOW_LOCAL_CHATGPT_WEB_MODEL
		? [
				{
					value: "chatgpt-web",
					label: "ChatGPT Web UI",
					owner: "OpenAI" as const,
				},
			]
		: []),
];

export const PROMPT_LAB_MODEL_VALUES = PROMPT_LAB_MODEL_OPTIONS.map(
	(option) => option.value,
);

export function inferModelOwnerFromModelId(model: string): string {
	const normalized = model.trim().toLowerCase();
	if (!normalized) return "Unknown";
	if (normalized === "chatgpt-web") return "OpenAI";
	if (
		normalized.startsWith("gpt") ||
		normalized.startsWith("o1") ||
		normalized.startsWith("o3") ||
		normalized.startsWith("openai/")
	) {
		return "OpenAI";
	}
	if (normalized.startsWith("claude") || normalized.startsWith("anthropic/")) {
		return "Anthropic";
	}
	if (normalized.startsWith("gemini") || normalized.startsWith("google/")) {
		return "Google";
	}
	return "Unknown";
}

export function dedupeModels(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}
