// @ts-nocheck

import { existsSync, promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import { parse } from "csv-parse/sync";
import express from "express";
import { z } from "zod";
import {
	CHATGPT_WEB_MODEL,
	runChatGptWebPromptLabQuery,
} from "./lib/chatgptWeb.js";

type CsvRow = Record<string, string>;

type BenchmarkConfig = {
	queries: string[];
	queryTags: Record<string, string[]>;
	competitors: string[];
	aliases: Record<string, string[]>;
	competitorCitationDomains?: Record<string, string[]>;
	pausedQueries: string[];
};

type UnderTheHoodRange = "1d" | "7d" | "30d" | "all";

type MvRunSummaryRow = {
	run_id: string;
	run_month: string | null;
	model: string | null;
	run_kind?: "full" | "cohort" | null;
	cohort_tag?: string | null;
	models?: string[] | string | null;
	models_csv?: string | null;
	model_owners?: string[] | string | null;
	model_owners_csv?: string | null;
	model_owner_map?: string | null;
	web_search_enabled: boolean | null;
	overall_score: number | null;
	created_at: string | null;
	started_at: string | null;
	ended_at: string | null;
	response_count: number | null;
	query_count: number | null;
	competitor_count: number | null;
	input_tokens: number | null;
	output_tokens: number | null;
	total_tokens: number | null;
	total_duration_ms: number | null;
	avg_duration_ms: number | null;
};

type MvModelPerformanceRow = {
	run_id: string;
	model: string;
	owner: string;
	response_count: number | null;
	success_count: number | null;
	failure_count: number | null;
	web_search_enabled_count: number | null;
	total_duration_ms: number | null;
	avg_duration_ms: number | null;
	p95_duration_ms: number | null;
	total_input_tokens: number | null;
	total_output_tokens: number | null;
	total_tokens: number | null;
	avg_input_tokens: number | null;
	avg_output_tokens: number | null;
	avg_total_tokens: number | null;
};

type MvCompetitorMentionRateRow = {
	run_id: string;
	query_id: string | null;
	query_key: string;
	query_text: string;
	competitor_id: string;
	entity: string;
	entity_key: string;
	is_highcharts: boolean;
	is_overall_row: boolean;
	response_count: number | null;
	input_tokens?: number | null;
	output_tokens?: number | null;
	total_tokens?: number | null;
	total_duration_ms?: number | null;
	mentions_count: number | null;
	mentions_rate_pct: number | null;
	share_of_voice_rate_pct: number | null;
};

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serverDir, "..", "..", "..");
const configPath = path.join(repoRoot, "config", "benchmark", "config.json");
const outputDir = path.join(repoRoot, "artifacts");
const fixtureDir = path.join(repoRoot, "tests", "fixtures");
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_CLAUSE_CHUNK_SIZE = 500;
const DASHBOARD_RECENT_RUN_SCAN_LIMIT = 25;
const localEnvPaths = [
	path.join(repoRoot, ".env.monthly"),
	path.join(repoRoot, ".env"),
	path.join(repoRoot, "apps", "web", ".env.local"),
];

function loadLocalEnvFile(filePath: string): void {
	if (!existsSync(filePath)) {
		return;
	}

	const raw = readFileSync(filePath, "utf8");
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const withoutExport = trimmed.startsWith("export ")
			? trimmed.slice("export ".length).trim()
			: trimmed;
		const separatorIndex = withoutExport.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}

		const key = withoutExport.slice(0, separatorIndex).trim();
		if (!key || process.env[key]) {
			continue;
		}

		let value = withoutExport.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

for (const envPath of localEnvPaths) {
	loadLocalEnvFile(envPath);
}

const DASHBOARD_SOURCE = String(process.env.DASHBOARD_SOURCE ?? "csv")
	.trim()
	.toLowerCase();
const SUPABASE_URL = String(
	process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
).trim();
const SUPABASE_KEY = String(
	process.env.SUPABASE_SERVICE_ROLE_KEY ??
		process.env.SUPABASE_ANON_KEY ??
		process.env.VITE_SUPABASE_ANON_KEY ??
		process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
		"",
).trim();
const supabase =
	SUPABASE_URL && SUPABASE_KEY
		? createClient(SUPABASE_URL, SUPABASE_KEY, {
				auth: { persistSession: false, autoRefreshToken: false },
			})
		: null;

const dashboardFiles = {
	comparison: path.join(outputDir, "comparison_table.csv"),
	competitorChart: path.join(outputDir, "looker_competitor_chart.csv"),
	kpi: path.join(outputDir, "looker_kpi.csv"),
	jsonl: path.join(outputDir, "llm_outputs.jsonl"),
};
const COMPETITOR_CITATION_DOMAINS_SETTING_KEY = "competitor_citation_domains";

const configSchema = z.object({
	queries: z.array(z.string().min(1)).min(1),
	queryTags: z
		.record(z.string(), z.array(z.string().min(1)))
		.optional()
		.default({}),
	competitors: z.array(z.string().min(1)).min(1),
	aliases: z.record(z.string(), z.array(z.string().min(1))).default({}),
	competitorCitationDomains: z
		.record(z.string(), z.array(z.string().min(1)))
		.optional(),
	pausedQueries: z.array(z.string()).optional().default([]),
});

const toggleSchema = z.object({
	query: z.string().min(1),
	active: z.boolean(),
});

const PROMPT_LAB_DEFAULT_MODEL = "gpt-4o-mini";
const PROMPT_LAB_DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL = "claude-opus-4-5-20251101";
const PROMPT_LAB_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const PROMPT_LAB_MODEL_ALIASES: Record<string, string> = {
	"claude-3-5-sonnet-latest": PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
	"claude-4-6-sonnet-latest": PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
	"claude-sonnet-4-6": PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
	"claude-4-6-opus-latest": PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL,
	"claude-opus-4-6": PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL,
	"gemini-3.0-flash": PROMPT_LAB_DEFAULT_GEMINI_MODEL,
	"gemini-3-flash-preview": PROMPT_LAB_DEFAULT_GEMINI_MODEL,
};
const PROMPT_LAB_FALLBACK_MODELS = [
	PROMPT_LAB_DEFAULT_MODEL,
	"gpt-4o",
	"gpt-5.2",
	PROMPT_LAB_DEFAULT_CLAUDE_MODEL,
	PROMPT_LAB_DEFAULT_CLAUDE_OPUS_MODEL,
	PROMPT_LAB_DEFAULT_GEMINI_MODEL,
	CHATGPT_WEB_MODEL,
];
const PROMPT_LAB_SYSTEM_PROMPT =
	"You are a research assistant for software and tooling questions. Produce clear markdown with short section headers, ranked options, concise rationale, and practical trade-offs. If web search is enabled, you must use it before answering and cite the sources you relied on in the response.";
const PROMPT_LAB_OPENAI_SYSTEM_PROMPT = [
	"Do not reproduce song lyrics or any other copyrighted material, even if asked.",
	"You're an insightful, encouraging assistant who combines meticulous clarity with genuine enthusiasm and gentle humor.\nSupportive thoroughness: Patiently explain complex topics clearly and comprehensively.\nLighthearted interactions: Maintain friendly tone with subtle humor and warmth.\nAdaptive teaching: Flexibly adjust explanations based on perceived user proficiency.\nConfidence-building: Foster intellectual curiosity and self-assurance.",
	"Do not end with opt-in questions or hedging closers. Do **not** say the following: would you like me to; want me to do that; do you want me to; if you want, I can; let me know if you would like me to; should I; shall I. Ask at most one necessary clarifying question at the start, not the end. If the next step is obvious, do it. Example of bad: I can write playful examples. would you like me to? Example of good: Here are three playful examples:..",
	"Address your message `to=bio` and write **just plain text**. Do **not** write JSON, under any circumstances. The plain text can be either:",
	"1. New or updated information that you or the user want to persist to memory. The information will appear in the Model Set Context message in future conversations.\n2. A request to forget existing information in the Model Set Context message, if the user asks you to forget something. The request should stay as close as possible to the user's ask.",
	'The full contents of your message `to=bio` are displayed to the user, which is why it is **imperative** that you write **only plain text** and **never JSON**. Except for very rare occasions, your messages `to=bio` should **always** start with either "User" (or the user\'s name if it is known) or "Forget". Follow the style of these examples and, again, **never write JSON**:',
	'// Tool for browsing and opening files uploaded by the user. To use this tool, set the recipient of your message as `to=file_search.msearch` (to use the msearch function) or `to=file_search.mclick` (to use the mclick function).\n// Parts of the documents uploaded by users will be automatically included in the conversation. Only use this tool when the relevant parts don\'t contain the necessary information to fulfill the user\'s request.\n// Please provide citations for your answers.\n// When citing the results of msearch, please render them in the following format: `{message idx}:{search idx}†{source}†{line range}` .\n// The message idx is provided at the beginning of the message from the tool in the following format `[message idx]`, e.g. [3].\n// The search index should be extracted from the search results, e.g. #   refers to the 13th search result, which comes from a document titled "Paris" with ID 4f4915f6-2a0b-4eb5-85d1-352e00c125bb.\n// The line range should be in the format "L{start line}-L{end line}", e.g., "L1-L5".\n// All 4 parts of the citation are REQUIRED when citing the results of msearch.\n// When citing the results of mclick, please render them in the following format: `{message idx}†{source}†{line range}`. All 3 parts are REQUIRED when citing the results of mclick.',
	"// Guidelines:\n// - Directly generate the image without reconfirmation or clarification, UNLESS the user asks for an image that will include a rendition of them.\n// - Do NOT mention anything related to downloading the image.\n// - Default to using this tool for image editing unless the user explicitly requests otherwise.\n// - After generating the image, do not summarize the image. Respond with an empty message.",
	"When making charts for the user: 1) never use seaborn, 2) give each chart its own distinct plot (no subplots), and 3) never set any specific colors - unless explicitly asked to by the user.\nI REPEAT: when making charts for the user: 1) use matplotlib over seaborn, 2) give each chart its own distinct plot (no subplots), and 3) never, ever, specify colors or matplotlib styles - unless explicitly asked to by the user",
	"**Policy reminder**: When using web results for sensitive or high-stakes topics (e.g., financial advice, health information, legal matters), always carefully check multiple reputable sources and present information with clear sourcing and caveats.",
	"If web search is enabled for this run, you must use it before answering and cite the sources you relied on in the response.",
	"# Closing Instructions",
	"You must follow all personality, tone, and formatting requirements stated above in every interaction.",
	"- **Personality**: Maintain the friendly, encouraging, and clear style described at the top of this prompt. Where appropriate, include gentle humor and warmth without detracting from clarity or accuracy.\n- **Clarity**: Explanations should be thorough but easy to follow. Use headings, lists, and formatting when it improves readability.\n- **Boundaries**: Do not produce disallowed content. This includes copyrighted song lyrics or any other material explicitly restricted in these instructions.\n- **Tool usage**: Only use the tools provided and strictly adhere to their usage guidelines. If the criteria for a tool are not met, do not invoke it.\n- **Accuracy and trust**: For high-stakes topics (e.g., medical, legal, financial), ensure that information is accurate, cite credible sources, and provide appropriate disclaimers.\n- **Freshness**: When the user asks for time-sensitive information, prefer the `web` tool with the correct QDF rating to ensure the information is recent and reliable.",
	"When uncertain, follow these priorities:\n1. **User safety and policy compliance** come first.\n2. **Accuracy and clarity** come next.\n3. **Tone and helpfulness** should be preserved throughout.",
].join("\n\n");
const PROMPT_LAB_USER_PROMPT_TEMPLATE = [
	"Query: {query}",
	"Answer with this structure:",
	"1) Top options (ranked)",
	"2) Why each option fits",
	"3) Trade-offs or caveats",
	"Keep bullets concise and name concrete libraries/tools.",
].join("\n");
const PROMPT_LAB_DEFAULT_SEARCH_CONTEXT_LOCATION = "United States";
const PROMPT_LAB_DEFAULT_SEARCH_CONTEXT_LANGUAGE = "en";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_MESSAGES_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_GENERATE_CONTENT_API_ROOT =
	"https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_API_VERSION = "2023-06-01";

const promptLabRunSchema = z.object({
	query: z.string().min(1).max(600),
	model: z.string().min(1).max(100).optional(),
	models: z
		.union([z.array(z.string().min(1).max(100)).max(32), z.string().max(2000)])
		.optional(),
	selectAllModels: z.boolean().optional(),
	webSearch: z.boolean().optional(),
	includeRawHtml: z.boolean().optional(),
	searchContext: z
		.object({
			enabled: z.boolean().optional(),
			location: z.string().min(1).max(120).optional(),
			language: z.string().min(1).max(24).optional(),
		})
		.optional(),
});

const promptLabChatGptWebSchema = z.object({
	query: z.string().min(1).max(600),
	includeRawHtml: z.boolean().optional(),
});

type PromptLabCitationRef = {
	id: string;
	url: string;
	title: string;
	host: string;
	snippet?: string;
	startIndex?: number | null;
	endIndex?: number | null;
	anchorText?: string | null;
	provider: PromptLabProvider;
};

type HttpError = Error & {
	statusCode?: number;
	exposeMessage?: boolean;
};

type PromptLabProvider = "openai" | "anthropic" | "google" | "chatgpt-web";

const app = express();
app.disable("x-powered-by");
const isProduction = process.env.NODE_ENV === "production";
const configuredCorsOrigins = String(process.env.UI_API_ALLOWED_ORIGINS ?? "")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);
const allowedCorsOrigins =
	configuredCorsOrigins.length > 0
		? configuredCorsOrigins
		: [
				"http://localhost:5173",
				"http://127.0.0.1:5173",
				"http://localhost:4173",
				"http://127.0.0.1:4173",
			];
const writeToken = String(
	process.env.UI_API_WRITE_TOKEN ?? process.env.BENCHMARK_TRIGGER_TOKEN ?? "",
).trim();
const cjsRequire = createRequire(import.meta.url);
const benchmarkTriggerHandler = cjsRequire("./handlers/benchmark/trigger.js");
const benchmarkRunsHandler = cjsRequire("./handlers/benchmark/runs.js");
const benchmarkStopHandler = cjsRequire("./handlers/benchmark/stop.js");
const promptLabRunHandler = cjsRequire("./handlers/prompt-lab/run.js");
const researchCompetitorRunHandler = cjsRequire(
	"./handlers/research/competitors/run.js",
);
const researchSitemapSyncHandler = cjsRequire(
	"./handlers/research/sitemap/sync.js",
);
const researchGapRefreshHandler = cjsRequire(
	"./handlers/research/gaps/refresh.js",
);
const researchGapListHandler = cjsRequire("./handlers/research/gaps.js");
const researchGapStatusHandler = cjsRequire(
	"./handlers/research/gaps/[id]/status.js",
);
const researchBriefGenerateHandler = cjsRequire(
	"./handlers/research/briefs/generate.js",
);
const researchPromptCohortsHandler = cjsRequire(
	"./handlers/research/prompt-cohorts.js",
);
const researchPromptCohortProgressHandler = cjsRequire(
	"./handlers/research/prompt-cohorts/[id]/progress.js",
);

app.use(
	cors({
		origin(origin, callback) {
			if (!origin) {
				callback(null, true);
				return;
			}
			callback(null, allowedCorsOrigins.includes(origin));
		},
		methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "X-UI-Token"],
	}),
);
app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("X-Frame-Options", "DENY");
	res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'self'; frame-ancestors 'none';",
	);
	next();
});

function getRequestToken(req: express.Request): string {
	const auth = req.headers.authorization ?? req.headers.Authorization;
	if (typeof auth === "string" && auth.startsWith("Bearer ")) {
		return auth.slice("Bearer ".length).trim();
	}
	const headerToken = req.headers["x-ui-token"] ?? req.headers["X-UI-Token"];
	if (typeof headerToken === "string") {
		return headerToken.trim();
	}
	return "";
}

function isLocalhostRequest(req: express.Request): boolean {
	const remote = req.socket.remoteAddress;
	return (
		remote === "127.0.0.1" ||
		remote === "::1" ||
		remote === "::ffff:127.0.0.1" ||
		remote === "localhost"
	);
}

function requireWriteAccess(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction,
) {
	if (writeToken) {
		const provided = getRequestToken(req);
		if (!provided || provided !== writeToken) {
			res.status(401).json({ error: "Unauthorized." });
			return;
		}
		next();
		return;
	}

	if (isProduction) {
		res.status(500).json({ error: "Internal server error." });
		return;
	}

	if (!isLocalhostRequest(req)) {
		res.status(401).json({ error: "Unauthorized." });
		return;
	}

	next();
}

function ensureServerlessTriggerToken(req: express.Request) {
	let configured = String(process.env.BENCHMARK_TRIGGER_TOKEN ?? "").trim();
	if (!configured) {
		const fallback =
			getRequestToken(req) || writeToken || "local-dev-trigger-token";
		configured = fallback.trim();
		process.env.BENCHMARK_TRIGGER_TOKEN = configured;
	}

	const existingAuth = req.headers.authorization ?? req.headers.Authorization;
	if (typeof existingAuth !== "string" || !existingAuth.trim()) {
		req.headers.authorization = `Bearer ${configured}`;
	}
}

function invokeServerlessHandler(
	handler: (
		req: express.Request,
		res: express.Response,
	) => Promise<void> | void,
	options: {
		requireTriggerToken?: boolean;
		paramIdToQuery?: boolean;
	} = {},
) {
	return async (req: express.Request, res: express.Response) => {
		if (options.paramIdToQuery && req.params.id) {
			(req.query as Record<string, unknown>).id = req.params.id;
		}
		if (options.requireTriggerToken) {
			ensureServerlessTriggerToken(req);
		}
		await handler(req, res);
	};
}

function sendApiError(
	res: express.Response,
	statusCode: number,
	message: string,
	error: unknown,
) {
	console.error(`[ui-api] ${message}`, error);
	const payload: Record<string, unknown> = { error: message };
	if (!isProduction) {
		payload.details = String(error);
	}
	res.status(statusCode).json(payload);
}

function uniqueNonEmpty(values: string[]): string[] {
	const normalized = values.map((value) => value.trim()).filter(Boolean);
	return [...new Set(normalized)];
}

const DELETED_PROMPT_TAG = "__deleted__";

function inferPromptTags(query: string): string[] {
	const normalized = query.toLowerCase();
	const tags: string[] = [];

	if (normalized.includes("react")) {
		tags.push("react");
	}
	if (normalized.includes("javascript") || /\bjs\b/.test(normalized)) {
		tags.push("javascript");
	}
	if (tags.length === 0) {
		tags.push("general");
	}

	return tags;
}

function parsePromptTagList(rawTags: unknown): string[] {
	const candidates =
		typeof rawTags === "string"
			? rawTags.split(",")
			: Array.isArray(rawTags)
				? rawTags.map((value) => String(value))
				: [];

	return uniqueNonEmpty(
		candidates.map((value) => {
			const normalizedTag = value.trim().toLowerCase();
			return normalizedTag === "generic" ? "general" : normalizedTag;
		}),
	);
}

function hasDeletedPromptTag(rawTags: unknown): boolean {
	return parsePromptTagList(rawTags).includes(DELETED_PROMPT_TAG);
}

function withDeletedPromptTag(rawTags: unknown, query: string): string[] {
	const baseTags = normalizePromptTags(rawTags, query);
	return uniqueNonEmpty([
		...baseTags.filter((tag) => tag !== DELETED_PROMPT_TAG),
		DELETED_PROMPT_TAG,
	]);
}

function normalizePromptTags(rawTags: unknown, query: string): string[] {
	const normalized = parsePromptTagList(rawTags).filter(
		(tag) => tag !== DELETED_PROMPT_TAG,
	);
	return normalized.length > 0 ? normalized : inferPromptTags(query);
}

function normalizeQueryTagsMap(
	queries: string[],
	rawQueryTags: Record<string, string[]> | undefined,
): Record<string, string[]> {
	const lookup = new Map<string, unknown>();
	for (const [query, tags] of Object.entries(rawQueryTags ?? {})) {
		lookup.set(query.trim().toLowerCase(), tags);
	}

	return Object.fromEntries(
		queries.map((query) => [
			query,
			normalizePromptTags(lookup.get(query.trim().toLowerCase()), query),
		]),
	);
}

function normalizeSelectedTags(rawTags: unknown): string[] {
	if (typeof rawTags !== "string") {
		return [];
	}
	return uniqueNonEmpty(
		rawTags
			.split(",")
			.map((tag) => tag.trim().toLowerCase())
			.filter(Boolean),
	);
}

function promptMatchesTagFilter(
	promptTags: string[],
	selectedTagSet: Set<string>,
	mode: "any" | "all",
): boolean {
	if (selectedTagSet.size === 0) {
		return true;
	}

	const promptTagSet = new Set(promptTags.map((tag) => tag.toLowerCase()));
	if (mode === "all") {
		for (const tag of selectedTagSet) {
			if (!promptTagSet.has(tag)) {
				return false;
			}
		}
		return true;
	}

	for (const tag of selectedTagSet) {
		if (promptTagSet.has(tag)) {
			return true;
		}
	}

	return false;
}

function slugifyEntity(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function asNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function asYesNo(value: unknown): "yes" | "no" {
	return String(value ?? "").toLowerCase() === "yes" ? "yes" : "no";
}

function isTruthyFlag(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function splitCsvish(value: string): string[] {
	return value
		.split(/[;,]/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

const UNDER_THE_HOOD_RANGE_OPTIONS: UnderTheHoodRange[] = [
	"1d",
	"7d",
	"30d",
	"all",
];

function normalizeUnderTheHoodRange(value: unknown): UnderTheHoodRange {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase() as UnderTheHoodRange;
	return UNDER_THE_HOOD_RANGE_OPTIONS.includes(normalized) ? normalized : "all";
}

function rangeLabelForUnderTheHood(range: UnderTheHoodRange): string {
	if (range === "1d") return "Last 1 day";
	if (range === "7d") return "Last 7 days";
	if (range === "30d") return "Last 30 days";
	return "All time";
}

function rangeStartMsForUnderTheHood(
	range: UnderTheHoodRange,
	nowMs: number,
): number | null {
	if (range === "1d") return nowMs - 24 * 60 * 60 * 1000;
	if (range === "7d") return nowMs - 7 * 24 * 60 * 60 * 1000;
	if (range === "30d") return nowMs - 30 * 24 * 60 * 60 * 1000;
	return null;
}

function timestampMs(value: unknown): number | null {
	const parsed = Date.parse(String(value ?? "").trim());
	return Number.isFinite(parsed) ? parsed : null;
}

type ModelPricing = {
	inputUsdPerMillion: number;
	outputUsdPerMillion: number;
};

const MODEL_PRICING_BY_MODEL: Record<string, ModelPricing> = {
	"gpt-5.2": { inputUsdPerMillion: 1.75, outputUsdPerMillion: 14 },
	"gpt-4o": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
	"gpt-4o-mini": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
	"claude-sonnet-4-5-20250929": {
		inputUsdPerMillion: 3,
		outputUsdPerMillion: 15,
	},
	"claude-opus-4-1-20250805": {
		inputUsdPerMillion: 15,
		outputUsdPerMillion: 75,
	},
	"claude-opus-4-20250514": { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
	"gemini-2.5-flash": { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
};

const MODEL_PRICING_FAMILY_RULES: Array<{
	test: (normalizedModel: string) => boolean;
	pricing: ModelPricing;
}> = [
	{
		test: (model) => model === "gpt-5.2" || model.startsWith("gpt-5.2-"),
		pricing: MODEL_PRICING_BY_MODEL["gpt-5.2"],
	},
	{
		test: (model) => model === "gpt-4o",
		pricing: MODEL_PRICING_BY_MODEL["gpt-4o"],
	},
	{
		test: (model) =>
			model === "gpt-4o-mini" || model.startsWith("gpt-4o-mini-"),
		pricing: MODEL_PRICING_BY_MODEL["gpt-4o-mini"],
	},
	{
		test: (model) =>
			model === "claude-sonnet-4-5" || model.startsWith("claude-sonnet-4-5-"),
		pricing: MODEL_PRICING_BY_MODEL["claude-sonnet-4-5-20250929"],
	},
	{
		test: (model) =>
			model === "claude-sonnet-4" || model.startsWith("claude-sonnet-4-"),
		pricing: MODEL_PRICING_BY_MODEL["claude-sonnet-4-5-20250929"],
	},
	{
		test: (model) => model.startsWith("claude-opus-4-5"),
		pricing: MODEL_PRICING_BY_MODEL["claude-opus-4-1-20250805"],
	},
	{
		test: (model) =>
			model === "claude-opus-4-1" || model.startsWith("claude-opus-4-1-"),
		pricing: MODEL_PRICING_BY_MODEL["claude-opus-4-1-20250805"],
	},
	{
		test: (model) =>
			model === "claude-opus-4" || model.startsWith("claude-opus-4-"),
		pricing: MODEL_PRICING_BY_MODEL["claude-opus-4-20250514"],
	},
	{
		test: (model) =>
			model === "gemini-2.5-flash" || model.startsWith("gemini-2.5-flash-"),
		pricing: MODEL_PRICING_BY_MODEL["gemini-2.5-flash"],
	},
];

function safeTokenInt(value: unknown): number {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.max(0, Math.round(parsed));
}

function resolveModelPricingForServer(model: string): ModelPricing | null {
	const normalized = model.trim().toLowerCase();
	if (!normalized) return null;
	const exact = MODEL_PRICING_BY_MODEL[normalized];
	if (exact) return exact;
	const familyMatch = MODEL_PRICING_FAMILY_RULES.find((rule) =>
		rule.test(normalized),
	);
	return familyMatch?.pricing ?? null;
}

function estimateResponseCostForServer(
	model: string,
	inputTokens: number,
	outputTokens: number,
): {
	inputCostUsd: number;
	outputCostUsd: number;
	totalCostUsd: number;
	priced: boolean;
} {
	const pricing = resolveModelPricingForServer(model);
	if (!pricing) {
		return {
			inputCostUsd: 0,
			outputCostUsd: 0,
			totalCostUsd: 0,
			priced: false,
		};
	}
	const inputCostUsd = (inputTokens / 1_000_000) * pricing.inputUsdPerMillion;
	const outputCostUsd =
		(outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
	return {
		inputCostUsd,
		outputCostUsd,
		totalCostUsd: inputCostUsd + outputCostUsd,
		priced: true,
	};
}

function inferModelOwnerFromModel(model: string): string {
	const normalized = model.trim().toLowerCase();
	if (!normalized) return "Unknown";
	if (normalized === CHATGPT_WEB_MODEL) return "OpenAI";
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

function parseModelOwnerMap(rawValue: string): Record<string, string> {
	const entries = rawValue
		.split(/[;,]/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const parsed: Record<string, string> = {};
	for (const entry of entries) {
		const separatorIndex = entry.includes("=>")
			? entry.indexOf("=>")
			: entry.indexOf(":");
		if (separatorIndex < 0) continue;
		const model = entry.slice(0, separatorIndex).trim();
		const owner = entry
			.slice(separatorIndex + (entry.includes("=>") ? 2 : 1))
			.trim();
		if (!model || !owner) continue;
		parsed[model] = owner;
	}
	return parsed;
}

function buildModelOwnerSummaryFromRows(rows: Array<Record<string, unknown>>): {
	modelOwners: string[];
	modelOwnerMap: Record<string, string>;
	modelOwnerStats: Array<{
		owner: string;
		models: string[];
		responseCount: number;
	}>;
} {
	const ownerByModel = new Map<string, string>();
	const countByOwner = new Map<string, number>();
	const modelsByOwner = new Map<string, Set<string>>();

	for (const row of rows) {
		const model = String(row.model ?? "").trim();
		if (!model) continue;
		const rowOwner = String(row.model_owner ?? "").trim();
		const owner = rowOwner || inferModelOwnerFromModel(model);
		ownerByModel.set(model, owner);
		countByOwner.set(owner, (countByOwner.get(owner) ?? 0) + 1);
		const ownerModels = modelsByOwner.get(owner) ?? new Set<string>();
		ownerModels.add(model);
		modelsByOwner.set(owner, ownerModels);
	}

	const modelOwners = [...new Set(ownerByModel.values())].sort((a, b) =>
		a.localeCompare(b),
	);
	const modelOwnerMap = Object.fromEntries(
		[...ownerByModel.entries()].sort(([left], [right]) =>
			left.localeCompare(right),
		),
	);
	const modelOwnerStats = [...countByOwner.entries()]
		.map(([owner, responseCount]) => ({
			owner,
			models: [...(modelsByOwner.get(owner) ?? new Set<string>())].sort(
				(a, b) => a.localeCompare(b),
			),
			responseCount,
		}))
		.sort((left, right) => {
			if (right.responseCount !== left.responseCount) {
				return right.responseCount - left.responseCount;
			}
			return left.owner.localeCompare(right.owner);
		});

	return { modelOwners, modelOwnerMap, modelOwnerStats };
}

function normalizePromptLabModelAlias(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		return "";
	}
	return PROMPT_LAB_MODEL_ALIASES[normalized.toLowerCase()] ?? normalized;
}

function normalizePromptLabModelList(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const normalized = normalizePromptLabModelAlias(value);
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(normalized);
	}
	return out;
}

function getPromptLabAllowedModels(): string[] {
	const configured = String(process.env.BENCHMARK_ALLOWED_MODELS ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const allowed = normalizePromptLabModelList(
		configured.length > 0 ? configured : PROMPT_LAB_FALLBACK_MODELS,
	);
	if (!allowed.some((model) => model.toLowerCase() === CHATGPT_WEB_MODEL)) {
		allowed.push(CHATGPT_WEB_MODEL);
	}
	return allowed;
}

function resolvePromptLabModel(
	modelInput: string,
	allowedModels: string[],
): string {
	const normalizedMap = new Map(
		allowedModels.map((name) => [name.toLowerCase(), name]),
	);
	const resolved = normalizedMap.get(
		normalizePromptLabModelAlias(modelInput).toLowerCase(),
	);
	if (!resolved) {
		const error = new Error(
			`Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(", ")}`,
		) as Error & { statusCode?: number };
		error.statusCode = 400;
		throw error;
	}
	return resolved;
}

function parsePromptLabRequestedModels(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	return [];
}

function resolvePromptLabModels(
	payload: { model?: string; models?: unknown; selectAllModels?: boolean },
	allowedModels: string[],
): string[] {
	const shouldSelectAll = payload.selectAllModels === true;
	let candidates = shouldSelectAll
		? allowedModels
		: parsePromptLabRequestedModels(payload.models);

	if (
		candidates.length === 0 &&
		typeof payload.model === "string" &&
		payload.model.trim()
	) {
		candidates = [payload.model.trim()];
	}
	if (candidates.length === 0) {
		candidates = [PROMPT_LAB_DEFAULT_MODEL];
	}

	const resolved: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const model = resolvePromptLabModel(candidate, allowedModels);
		const key = model.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		resolved.push(model);
	}
	return resolved;
}

function inferPromptLabProvider(modelInput: string): PromptLabProvider {
	const normalized = modelInput.trim().toLowerCase();
	if (normalized === CHATGPT_WEB_MODEL) {
		return "chatgpt-web";
	}
	if (normalized.startsWith("claude") || normalized.startsWith("anthropic/")) {
		return "anthropic";
	}
	if (normalized.startsWith("gemini") || normalized.startsWith("google/")) {
		return "google";
	}
	return "openai";
}

function resolvePromptLabSearchContext(rawValue: unknown): {
	enabled: boolean;
	location: string;
	language: string;
} {
	const value =
		rawValue && typeof rawValue === "object"
			? (rawValue as Record<string, unknown>)
			: {};
	const enabled = Boolean(value.enabled);
	const location =
		typeof value.location === "string" && value.location.trim()
			? value.location.trim()
			: PROMPT_LAB_DEFAULT_SEARCH_CONTEXT_LOCATION;
	const language =
		typeof value.language === "string" && value.language.trim()
			? value.language.trim()
			: PROMPT_LAB_DEFAULT_SEARCH_CONTEXT_LANGUAGE;
	return {
		enabled,
		location,
		language,
	};
}

function buildPromptLabEffectiveQuery(
	query: string,
	provider: PromptLabProvider,
	searchContext: {
		enabled: boolean;
		location: string;
		language: string;
	},
): string {
	if (provider !== "openai" || !searchContext.enabled) {
		return query;
	}
	return `${query} (The user's location is ${searchContext.location}. Be sure to reply in ${searchContext.language} language)`;
}

function buildPromptLabUserPrompt(
	effectiveQuery: string,
	enforceWebGrounding: boolean,
): string {
	const base = PROMPT_LAB_USER_PROMPT_TEMPLATE.replace(
		"{query}",
		effectiveQuery,
	);
	if (!enforceWebGrounding) {
		return base;
	}
	return `${base}\nYou must use web search before finalizing. Cite the sources you relied on in the answer.`;
}

function resolvePromptLabApiKey(provider: PromptLabProvider): string {
	const keyName =
		provider === "anthropic"
			? "ANTHROPIC_API_KEY"
			: provider === "google"
				? "GEMINI_API_KEY"
				: "OPENAI_API_KEY";
	const apiKey = String(process.env[keyName] ?? "").trim();
	if (!apiKey) {
		const error = new Error(
			`Prompt lab is not configured. Set ${keyName} on the server.`,
		) as HttpError;
		error.statusCode = 503;
		error.exposeMessage = true;
		throw error;
	}
	return apiKey;
}

function resolvePromptLabModelOwner(provider: PromptLabProvider): string {
	if (provider === "anthropic") return "Anthropic";
	if (provider === "google") return "Google";
	if (provider === "chatgpt-web") return "OpenAI";
	if (provider === "openai") return "OpenAI";
	return "Unknown";
}

function getPromptLabSystemPrompt(provider: PromptLabProvider): string {
	return provider === "openai"
		? PROMPT_LAB_OPENAI_SYSTEM_PROMPT
		: PROMPT_LAB_SYSTEM_PROMPT;
}

function extractPromptLabResponseText(
	responsePayload: Record<string, unknown>,
): string {
	const outputText = responsePayload.output_text;
	if (typeof outputText === "string" && outputText.trim()) {
		return outputText.trim();
	}

	const texts: string[] = [];
	const outputItems = Array.isArray(responsePayload.output)
		? responsePayload.output
		: [];
	for (const outputItem of outputItems) {
		if (!outputItem || typeof outputItem !== "object") {
			continue;
		}
		const contentItems = Array.isArray(
			(outputItem as { content?: unknown }).content,
		)
			? (outputItem as { content: unknown[] }).content
			: [];
		for (const content of contentItems) {
			if (!content || typeof content !== "object") {
				continue;
			}
			const text = (content as { text?: unknown }).text;
			if (typeof text === "string" && text.trim()) {
				texts.push(text.trim());
			}
		}
	}

	const contentItems = Array.isArray(responsePayload.content)
		? responsePayload.content
		: [];
	for (const content of contentItems) {
		if (!content || typeof content !== "object") {
			continue;
		}
		const text = (content as { text?: unknown }).text;
		if (typeof text === "string" && text.trim()) {
			texts.push(text.trim());
		}
	}

	const candidates = Array.isArray(responsePayload.candidates)
		? responsePayload.candidates
		: [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") {
			continue;
		}
		const content = (candidate as { content?: unknown }).content;
		if (!content || typeof content !== "object") {
			continue;
		}
		const parts = Array.isArray((content as { parts?: unknown }).parts)
			? (content as { parts: unknown[] }).parts
			: [];
		for (const part of parts) {
			if (!part || typeof part !== "object") {
				continue;
			}
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string" && text.trim()) {
				texts.push(text.trim());
			}
		}
	}

	return texts.join("\n").trim();
}

function normalizePromptLabCitationHost(url: string): string {
	if (!url.trim()) return "";
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

function normalizePromptLabCitationBound(value: unknown): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	const rounded = Math.round(parsed);
	return rounded >= 0 ? rounded : null;
}

function buildPromptLabCitationRef(
	candidate: unknown,
	provider: PromptLabProvider,
	sourceText: string,
): Omit<PromptLabCitationRef, "id"> | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const entry = candidate as {
		url?: unknown;
		uri?: unknown;
		href?: unknown;
		source?: unknown;
		title?: unknown;
		snippet?: unknown;
		text?: unknown;
		excerpt?: unknown;
		start_index?: unknown;
		startIndex?: unknown;
		end_index?: unknown;
		endIndex?: unknown;
	};
	const urlValue = [entry.url, entry.uri, entry.href, entry.source].find(
		(value) => typeof value === "string" && value.trim(),
	);
	if (typeof urlValue !== "string") {
		return null;
	}
	const url = urlValue.trim();
	const host = normalizePromptLabCitationHost(url);
	const title =
		typeof entry.title === "string" && entry.title.trim()
			? entry.title.trim()
			: host || url;
	const snippetValue = [entry.snippet, entry.text, entry.excerpt].find(
		(value) => typeof value === "string" && value.trim(),
	);
	const snippet =
		typeof snippetValue === "string" ? snippetValue.trim() : undefined;
	const startIndex = normalizePromptLabCitationBound(
		entry.start_index ?? entry.startIndex,
	);
	const endIndex = normalizePromptLabCitationBound(
		entry.end_index ?? entry.endIndex,
	);
	let anchorText: string | null = null;
	if (
		sourceText &&
		startIndex !== null &&
		endIndex !== null &&
		endIndex > startIndex &&
		endIndex <= sourceText.length
	) {
		const sliced = sourceText.slice(startIndex, endIndex).trim();
		if (sliced) {
			anchorText = sliced;
		}
	}

	return {
		url,
		title,
		host,
		snippet,
		startIndex,
		endIndex,
		anchorText,
		provider,
	};
}

function extractPromptLabCitationRefs(
	responsePayload: Record<string, unknown>,
	provider: PromptLabProvider,
): PromptLabCitationRef[] {
	const refs: PromptLabCitationRef[] = [];
	const seen = new Set<string>();
	let nextId = 1;

	const appendRef = (candidate: unknown, sourceText = "") => {
		const normalized = buildPromptLabCitationRef(
			candidate,
			provider,
			sourceText,
		);
		if (!normalized) return;
		const dedupeKey = [
			normalized.url,
			normalized.startIndex ?? "",
			normalized.endIndex ?? "",
			normalized.title.toLowerCase(),
		].join("|");
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		refs.push({
			id: `c${nextId++}`,
			...normalized,
		});
	};

	for (const key of ["citations", "sources", "references"] as const) {
		const topLevelValue = responsePayload[key];
		if (Array.isArray(topLevelValue)) {
			for (const item of topLevelValue) {
				appendRef(item);
			}
		}
	}

	const outputItems = Array.isArray(responsePayload.output)
		? responsePayload.output
		: [];
	for (const outputItem of outputItems) {
		if (!outputItem || typeof outputItem !== "object") continue;
		const contentItems = Array.isArray(
			(outputItem as { content?: unknown }).content,
		)
			? (outputItem as { content: unknown[] }).content
			: [];
		for (const content of contentItems) {
			if (!content || typeof content !== "object") continue;
			const sourceText =
				typeof (content as { text?: unknown }).text === "string"
					? ((content as { text: string }).text ?? "")
					: "";

			const contentCitations = (content as { citations?: unknown }).citations;
			if (Array.isArray(contentCitations)) {
				for (const citation of contentCitations) {
					appendRef(citation, sourceText);
				}
			}

			const annotations = (content as { annotations?: unknown }).annotations;
			if (!Array.isArray(annotations)) continue;
			for (const annotation of annotations) {
				appendRef(annotation, sourceText);
				const nested = (annotation as { url_citation?: unknown }).url_citation;
				appendRef(nested, sourceText);
			}
		}
	}

	const contentItems = Array.isArray(responsePayload.content)
		? responsePayload.content
		: [];
	for (const content of contentItems) {
		if (!content || typeof content !== "object") continue;
		const sourceText =
			typeof (content as { text?: unknown }).text === "string"
				? ((content as { text: string }).text ?? "")
				: "";
		const contentCitations = (content as { citations?: unknown }).citations;
		if (Array.isArray(contentCitations)) {
			for (const citation of contentCitations) {
				appendRef(citation, sourceText);
			}
		}
	}

	const candidates = Array.isArray(responsePayload.candidates)
		? responsePayload.candidates
		: [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") continue;
		const grounding = (candidate as { groundingMetadata?: unknown })
			.groundingMetadata;
		if (!grounding || typeof grounding !== "object") continue;

		const chunks = Array.isArray(
			(grounding as { groundingChunks?: unknown }).groundingChunks,
		)
			? (grounding as { groundingChunks: unknown[] }).groundingChunks
			: [];
		for (const chunk of chunks) {
			if (!chunk || typeof chunk !== "object") continue;
			appendRef(chunk);
			const web = (chunk as { web?: unknown }).web;
			appendRef(web);
		}

		const citationSources = Array.isArray(
			(grounding as { citationMetadata?: { citationSources?: unknown } })
				.citationMetadata?.citationSources,
		)
			? ((grounding as { citationMetadata?: { citationSources?: unknown[] } })
					.citationMetadata?.citationSources as unknown[])
			: [];
		for (const source of citationSources) {
			appendRef(source);
		}
	}

	refs.sort((left, right) => {
		const leftEnd =
			left.endIndex === null || left.endIndex === undefined
				? Number.POSITIVE_INFINITY
				: left.endIndex;
		const rightEnd =
			right.endIndex === null || right.endIndex === undefined
				? Number.POSITIVE_INFINITY
				: right.endIndex;
		if (leftEnd !== rightEnd) return leftEnd - rightEnd;
		return left.url.localeCompare(right.url);
	});

	return refs.map((ref, index) => ({
		...ref,
		id: `c${index + 1}`,
	}));
}

function extractPromptLabCitations(
	citationRefs: PromptLabCitationRef[],
): string[] {
	const citations: string[] = [];
	const seen = new Set<string>();
	for (const ref of citationRefs) {
		const normalized = String(ref.url || "").trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		citations.push(normalized);
	}
	return citations;
}

function toNonNegativeInt(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.round(parsed);
}

function extractPromptLabTokenUsage(responsePayload: Record<string, unknown>): {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
} {
	const usage =
		typeof responsePayload.usage === "object" && responsePayload.usage !== null
			? (responsePayload.usage as Record<string, unknown>)
			: {};
	const usageMetadata =
		typeof responsePayload.usageMetadata === "object" &&
		responsePayload.usageMetadata !== null
			? (responsePayload.usageMetadata as Record<string, unknown>)
			: {};

	const inputTokens = Math.max(
		toNonNegativeInt(usage.input_tokens),
		toNonNegativeInt(usage.prompt_tokens),
		toNonNegativeInt(usageMetadata.promptTokenCount),
		toNonNegativeInt(usageMetadata.prompt_tokens),
	);
	const outputTokens = Math.max(
		toNonNegativeInt(usage.output_tokens),
		toNonNegativeInt(usage.completion_tokens),
		toNonNegativeInt(usageMetadata.candidatesTokenCount),
		toNonNegativeInt(usageMetadata.completion_tokens),
	);
	const totalTokens =
		Math.max(
			toNonNegativeInt(usage.total_tokens),
			toNonNegativeInt(usageMetadata.totalTokenCount),
			toNonNegativeInt(usageMetadata.total_tokens),
		) || inputTokens + outputTokens;

	return {
		inputTokens,
		outputTokens,
		totalTokens,
	};
}

async function runOpenAiPromptLabQuery(
	effectiveQuery: string,
	model: string,
	webSearch: boolean,
): Promise<{
	responseText: string;
	citationRefs: PromptLabCitationRef[];
	citations: string[];
	effectiveQuery: string;
	tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
	const apiKey = resolvePromptLabApiKey("openai");
	const userPrompt = buildPromptLabUserPrompt(effectiveQuery, webSearch);
	const systemPrompt = getPromptLabSystemPrompt("openai");

	const body: Record<string, unknown> = {
		model,
		temperature: 0.7,
		input: [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: userPrompt,
			},
		],
	};
	if (webSearch) {
		body.tools = [{ type: "web_search_preview" }];
	}

	const upstreamResponse = await fetch(OPENAI_RESPONSES_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const raw = await upstreamResponse.text();
	let payload: unknown = {};
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = {};
		}
	}

	if (!upstreamResponse.ok) {
		const upstreamMessage =
			typeof payload === "object" &&
			payload !== null &&
			typeof (payload as { error?: { message?: unknown } }).error?.message ===
				"string"
				? (payload as { error: { message: string } }).error.message
				: `OpenAI request failed (${upstreamResponse.status}).`;
		const error = new Error(upstreamMessage) as Error & { statusCode?: number };
		error.statusCode =
			upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
		throw error;
	}

	const responsePayload =
		payload && typeof payload === "object"
			? (payload as Record<string, unknown>)
			: {};
	const citationRefs = extractPromptLabCitationRefs(responsePayload, "openai");

	return {
		responseText: extractPromptLabResponseText(responsePayload),
		citationRefs,
		citations: extractPromptLabCitations(citationRefs),
		effectiveQuery,
		tokens: extractPromptLabTokenUsage(responsePayload),
	};
}

async function runAnthropicPromptLabQuery(
	effectiveQuery: string,
	model: string,
): Promise<{
	responseText: string;
	citationRefs: PromptLabCitationRef[];
	citations: string[];
	effectiveQuery: string;
	tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
	const apiKey = resolvePromptLabApiKey("anthropic");
	const userPrompt = buildPromptLabUserPrompt(effectiveQuery, false);
	const systemPrompt = getPromptLabSystemPrompt("anthropic");

	const body: Record<string, unknown> = {
		model,
		max_tokens: 1024,
		temperature: 0.7,
		system: systemPrompt,
		messages: [
			{
				role: "user",
				content: userPrompt,
			},
		],
	};

	const upstreamResponse = await fetch(ANTHROPIC_MESSAGES_API_URL, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_API_VERSION,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const raw = await upstreamResponse.text();
	let payload: unknown = {};
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = {};
		}
	}

	if (!upstreamResponse.ok) {
		const upstreamMessage =
			typeof payload === "object" &&
			payload !== null &&
			typeof (payload as { error?: { message?: unknown } }).error?.message ===
				"string"
				? (payload as { error: { message: string } }).error.message
				: `Anthropic request failed (${upstreamResponse.status}).`;
		const error = new Error(upstreamMessage) as Error & { statusCode?: number };
		error.statusCode =
			upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
		throw error;
	}

	const responsePayload =
		payload && typeof payload === "object"
			? (payload as Record<string, unknown>)
			: {};
	const citationRefs = extractPromptLabCitationRefs(
		responsePayload,
		"anthropic",
	);

	return {
		responseText: extractPromptLabResponseText(responsePayload),
		citationRefs,
		citations: extractPromptLabCitations(citationRefs),
		effectiveQuery,
		tokens: extractPromptLabTokenUsage(responsePayload),
	};
}

async function runGeminiPromptLabQuery(
	effectiveQuery: string,
	model: string,
): Promise<{
	responseText: string;
	citationRefs: PromptLabCitationRef[];
	citations: string[];
	effectiveQuery: string;
	tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
	const apiKey = resolvePromptLabApiKey("google");
	const modelPath = encodeURIComponent(model);
	const url =
		`${GEMINI_GENERATE_CONTENT_API_ROOT}/${modelPath}:generateContent` +
		`?key=${encodeURIComponent(apiKey)}`;
	const userPrompt = buildPromptLabUserPrompt(effectiveQuery, false);
	const systemPrompt = getPromptLabSystemPrompt("google");

	const body: Record<string, unknown> = {
		systemInstruction: { parts: [{ text: systemPrompt }] },
		contents: [
			{
				role: "user",
				parts: [{ text: userPrompt }],
			},
		],
		generationConfig: { temperature: 0.7 },
	};

	const upstreamResponse = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const raw = await upstreamResponse.text();
	let payload: unknown = {};
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = {};
		}
	}

	if (!upstreamResponse.ok) {
		const upstreamMessage =
			typeof payload === "object" &&
			payload !== null &&
			typeof (payload as { error?: { message?: unknown } }).error?.message ===
				"string"
				? (payload as { error: { message: string } }).error.message
				: `Gemini request failed (${upstreamResponse.status}).`;
		const error = new Error(upstreamMessage) as Error & { statusCode?: number };
		error.statusCode =
			upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
		throw error;
	}

	const responsePayload =
		payload && typeof payload === "object"
			? (payload as Record<string, unknown>)
			: {};
	const citationRefs = extractPromptLabCitationRefs(responsePayload, "google");

	return {
		responseText: extractPromptLabResponseText(responsePayload),
		citationRefs,
		citations: extractPromptLabCitations(citationRefs),
		effectiveQuery,
		tokens: extractPromptLabTokenUsage(responsePayload),
	};
}

async function runPromptLabQuery(
	query: string,
	model: string,
	webSearch: boolean,
	includeRawHtml: boolean,
	searchContext: {
		enabled: boolean;
		location: string;
		language: string;
	},
): Promise<{
	responseText: string;
	citationRefs: PromptLabCitationRef[];
	citations: string[];
	effectiveQuery: string;
	rawHtml?: string;
	tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
	const provider = inferPromptLabProvider(model);
	const effectiveQuery = buildPromptLabEffectiveQuery(
		query,
		provider,
		searchContext,
	);
	if (provider === "chatgpt-web") {
		return runChatGptWebPromptLabQuery({
			query: buildPromptLabUserPrompt(effectiveQuery, true),
			includeRawHtml,
		});
	}
	if (provider === "anthropic") {
		return runAnthropicPromptLabQuery(effectiveQuery, model);
	}
	if (provider === "google") {
		return runGeminiPromptLabQuery(effectiveQuery, model);
	}
	return runOpenAiPromptLabQuery(effectiveQuery, model, webSearch);
}

async function runPromptLabQueryForModel(
	query: string,
	model: string,
	requestedWebSearch: boolean,
	includeRawHtml: boolean,
	searchContext: {
		enabled: boolean;
		location: string;
		language: string;
	},
): Promise<{
	ok: boolean;
	model: string;
	provider: PromptLabProvider;
	modelOwner: string;
	webSearchEnabled: boolean;
	responseText: string;
	effectiveQuery: string;
	citationRefs: PromptLabCitationRef[];
	citations: string[];
	rawHtml?: string;
	tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
	durationMs: number;
	error: string | null;
}> {
	const provider = inferPromptLabProvider(model);
	const modelOwner = resolvePromptLabModelOwner(provider);
	const webSearchEnabled =
		provider === "chatgpt-web"
			? true
			: provider === "openai"
				? requestedWebSearch
				: false;
	const effectiveQuery = buildPromptLabEffectiveQuery(
		query,
		provider,
		searchContext,
	);
	const startedAt = Date.now();

	try {
		const result = await runPromptLabQuery(
			query,
			model,
			webSearchEnabled,
			includeRawHtml,
			searchContext,
		);
		return {
			ok: true,
			model,
			provider,
			modelOwner,
			webSearchEnabled,
			responseText: result.responseText,
			effectiveQuery: result.effectiveQuery,
			citationRefs: result.citationRefs,
			citations: result.citations,
			rawHtml: result.rawHtml,
			tokens: result.tokens,
			durationMs: Date.now() - startedAt,
			error: null,
		};
	} catch (error) {
		return {
			ok: false,
			model,
			provider,
			modelOwner,
			webSearchEnabled,
			responseText: "",
			effectiveQuery,
			citationRefs: [],
			citations: [],
			rawHtml: undefined,
			tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function summarizePromptLabModelResults(
	results: Array<{
		ok: boolean;
		durationMs: number;
		tokens: { inputTokens: number; outputTokens: number; totalTokens: number };
	}>,
): {
	modelCount: number;
	successCount: number;
	failureCount: number;
	totalDurationMs: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
} {
	return results.reduce(
		(summary, result) => {
			summary.modelCount += 1;
			if (result.ok) {
				summary.successCount += 1;
			} else {
				summary.failureCount += 1;
			}
			summary.totalDurationMs += Math.max(0, Math.round(result.durationMs));
			summary.totalInputTokens += Math.max(
				0,
				Math.round(result.tokens.inputTokens),
			);
			summary.totalOutputTokens += Math.max(
				0,
				Math.round(result.tokens.outputTokens),
			);
			summary.totalTokens += Math.max(0, Math.round(result.tokens.totalTokens));
			return summary;
		},
		{
			modelCount: 0,
			successCount: 0,
			failureCount: 0,
			totalDurationMs: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalTokens: 0,
		},
	);
}

function normalizeConfig(rawConfig: BenchmarkConfig): BenchmarkConfig {
	const queries = uniqueNonEmpty(rawConfig.queries);
	const queryTags = normalizeQueryTagsMap(queries, rawConfig.queryTags);
	const competitors = uniqueNonEmpty(rawConfig.competitors);
	if (!competitors.some((name) => name.toLowerCase() === "highcharts")) {
		throw new Error('`competitors` must include "Highcharts".');
	}

	const aliases: Record<string, string[]> = {};
	for (const competitor of competitors) {
		const candidateAliases =
			rawConfig.aliases[competitor] ??
			rawConfig.aliases[competitor.toLowerCase()] ??
			[];
		aliases[competitor] = uniqueNonEmpty([competitor, ...candidateAliases]);
	}
	const queryKeySet = new Set(
		queries.map((query) => query.trim().toLowerCase()),
	);
	const pausedQueries = uniqueNonEmpty(rawConfig.pausedQueries ?? []).filter(
		(query) => queryKeySet.has(query.trim().toLowerCase()),
	);

	return {
		queries,
		queryTags,
		competitors,
		aliases,
		competitorCitationDomains: normalizeCompetitorCitationDomains(
			rawConfig.competitorCitationDomains,
		),
		pausedQueries,
	};
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
	const readPath = async (candidatePath: string): Promise<string | null> => {
		try {
			return await fs.readFile(candidatePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	};

	try {
		let content = await readPath(filePath);
		if (content === null) {
			content = await readPath(path.join(fixtureDir, path.basename(filePath)));
		}
		if (content === null) {
			return [];
		}
		if (!content.trim()) {
			return [];
		}
		return parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as CsvRow[];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function readJsonl(
	filePath: string,
): Promise<Array<Record<string, unknown>>> {
	const readPath = async (candidatePath: string): Promise<string | null> => {
		try {
			return await fs.readFile(candidatePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	};

	try {
		let text = await readPath(filePath);
		if (text === null) {
			text = await readPath(path.join(fixtureDir, path.basename(filePath)));
		}
		if (text === null) {
			return [];
		}
		return text
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const parsed = JSON.parse(line);
					return typeof parsed === "object" && parsed !== null
						? [parsed as Record<string, unknown>]
						: [];
				} catch {
					return [];
				}
			});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function loadConfig(): Promise<BenchmarkConfig> {
	const raw = await fs.readFile(configPath, "utf8");
	const parsed = configSchema.parse(JSON.parse(raw));
	return normalizeConfig(parsed);
}

type DashboardModelStat = {
	model: string;
	owner: string;
	responseCount: number;
	successCount: number;
	failureCount: number;
	webSearchEnabledCount: number;
	totalDurationMs: number;
	avgDurationMs: number;
	p95DurationMs: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	avgInputTokens: number;
	avgOutputTokens: number;
	avgTotalTokens: number;
};

function percentile(values: number[], target: number): number {
	if (values.length === 0) return 0;
	const sorted = values.slice().sort((left, right) => left - right);
	const clampedTarget = Math.max(0, Math.min(1, target));
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(clampedTarget * sorted.length) - 1),
	);
	return sorted[index] ?? 0;
}

function buildModelStatsFromRows(rows: Array<Record<string, unknown>>): {
	modelStats: DashboardModelStat[];
	tokenTotals: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	durationTotals: { totalDurationMs: number; avgDurationMs: number };
} {
	const byModel = new Map<
		string,
		{
			owner: string;
			responseCount: number;
			successCount: number;
			failureCount: number;
			webSearchEnabledCount: number;
			durations: number[];
			totalDurationMs: number;
			totalInputTokens: number;
			totalOutputTokens: number;
			totalTokens: number;
		}
	>();

	let totalDurationMs = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalTokens = 0;

	for (const row of rows) {
		const model = String(row.model ?? "").trim();
		if (!model) continue;

		const owner =
			String(row.model_owner ?? "").trim() || inferModelOwnerFromModel(model);
		const durationMs = Math.max(0, Math.round(asNumber(row.duration_ms)));
		const inputTokens = Math.max(0, Math.round(asNumber(row.prompt_tokens)));
		const outputTokens = Math.max(
			0,
			Math.round(asNumber(row.completion_tokens)),
		);
		const rowTotalTokens = Math.max(
			0,
			Math.round(asNumber(row.total_tokens) || inputTokens + outputTokens),
		);
		const hasError = Boolean(String(row.error ?? "").trim());
		const webEnabled = isTruthyFlag(row.web_search_enabled);

		let bucket = byModel.get(model);
		if (!bucket) {
			bucket = {
				owner,
				responseCount: 0,
				successCount: 0,
				failureCount: 0,
				webSearchEnabledCount: 0,
				durations: [],
				totalDurationMs: 0,
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalTokens: 0,
			};
			byModel.set(model, bucket);
		}

		bucket.responseCount += 1;
		if (hasError) {
			bucket.failureCount += 1;
		} else {
			bucket.successCount += 1;
		}
		if (webEnabled) {
			bucket.webSearchEnabledCount += 1;
		}
		bucket.durations.push(durationMs);
		bucket.totalDurationMs += durationMs;
		bucket.totalInputTokens += inputTokens;
		bucket.totalOutputTokens += outputTokens;
		bucket.totalTokens += rowTotalTokens;

		totalDurationMs += durationMs;
		totalInputTokens += inputTokens;
		totalOutputTokens += outputTokens;
		totalTokens += rowTotalTokens;
	}

	const modelStats = [...byModel.entries()]
		.map(([model, bucket]) => {
			const responseCount = bucket.responseCount;
			return {
				model,
				owner: bucket.owner,
				responseCount,
				successCount: bucket.successCount,
				failureCount: bucket.failureCount,
				webSearchEnabledCount: bucket.webSearchEnabledCount,
				totalDurationMs: bucket.totalDurationMs,
				avgDurationMs:
					responseCount > 0
						? Number((bucket.totalDurationMs / responseCount).toFixed(2))
						: 0,
				p95DurationMs: Number(percentile(bucket.durations, 0.95).toFixed(2)),
				totalInputTokens: bucket.totalInputTokens,
				totalOutputTokens: bucket.totalOutputTokens,
				totalTokens: bucket.totalTokens,
				avgInputTokens:
					responseCount > 0
						? Number((bucket.totalInputTokens / responseCount).toFixed(2))
						: 0,
				avgOutputTokens:
					responseCount > 0
						? Number((bucket.totalOutputTokens / responseCount).toFixed(2))
						: 0,
				avgTotalTokens:
					responseCount > 0
						? Number((bucket.totalTokens / responseCount).toFixed(2))
						: 0,
			};
		})
		.sort((left, right) => {
			if (right.responseCount !== left.responseCount) {
				return right.responseCount - left.responseCount;
			}
			return left.model.localeCompare(right.model);
		});

	return {
		modelStats,
		tokenTotals: {
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			totalTokens,
		},
		durationTotals: {
			totalDurationMs,
			avgDurationMs:
				rows.length > 0
					? Number((totalDurationMs / rows.length).toFixed(2))
					: 0,
		},
	};
}

function inferWindowFromJsonl(rows: Array<Record<string, unknown>>): {
	start: string | null;
	end: string | null;
	models: string[];
	modelOwners: string[];
	modelOwnerMap: Record<string, string>;
	modelOwnerStats: Array<{
		owner: string;
		models: string[];
		responseCount: number;
	}>;
	modelStats: DashboardModelStat[];
	tokenTotals: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	durationTotals: { totalDurationMs: number; avgDurationMs: number };
} {
	const timestamps = rows
		.map((row) => String(row.timestamp ?? ""))
		.filter(Boolean)
		.sort();
	const models = [
		...new Set(rows.map((row) => String(row.model ?? "")).filter(Boolean)),
	];
	const ownerSummary = buildModelOwnerSummaryFromRows(rows);
	const modelStatsSummary = buildModelStatsFromRows(rows);
	return {
		start: timestamps[0] ?? null,
		end: timestamps.at(-1) ?? null,
		models,
		modelOwners: ownerSummary.modelOwners,
		modelOwnerMap: ownerSummary.modelOwnerMap,
		modelOwnerStats: ownerSummary.modelOwnerStats,
		modelStats: modelStatsSummary.modelStats,
		tokenTotals: modelStatsSummary.tokenTotals,
		durationTotals: modelStatsSummary.durationTotals,
	};
}

function shouldUseSupabaseDashboardSource(): boolean {
	return DASHBOARD_SOURCE === "supabase";
}

function requireSupabaseClient() {
	if (!supabase) {
		throw new Error(
			"DASHBOARD_SOURCE=supabase requires SUPABASE_URL and a Supabase key (service role or anon).",
		);
	}
	return supabase;
}

function isMissingRelation(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const code = (error as { code?: string }).code;
	return code === "42P01";
}

function isMissingColumn(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const code = (error as { code?: string }).code;
	if (code === "42703" || code === "PGRST204") {
		return true;
	}
	const message = String(
		(error as { message?: string }).message ?? "",
	).toLowerCase();
	return (
		message.includes("could not find the") &&
		message.includes("column") &&
		message.includes("schema cache")
	);
}

function asError(error: unknown, context: string): Error {
	if (error instanceof Error) {
		return error;
	}
	if (typeof error === "object" && error !== null) {
		const message = String(
			(error as { message?: unknown }).message ?? "",
		).trim();
		if (message) {
			return new Error(`${context}: ${message}`);
		}
	}
	return new Error(`${context}: ${String(error)}`);
}

function roundTo(value: number, decimals = 2): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

async function fetchAllSupabasePages<T>(
	fetchPage: (
		from: number,
		to: number,
	) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; error: unknown | null }> {
	const rows: T[] = [];
	let offset = 0;
	let pageCount = 0;
	const maxPages = 10_000;

	while (pageCount < maxPages) {
		const pageResult = await fetchPage(offset, offset + SUPABASE_PAGE_SIZE - 1);
		if (pageResult.error) {
			return { rows: [], error: pageResult.error };
		}

		const pageRows = (pageResult.data ?? []) as T[];
		if (pageRows.length === 0) {
			return { rows, error: null };
		}

		rows.push(...pageRows);
		offset += pageRows.length;
		pageCount += 1;
	}

	return {
		rows: [],
		error: new Error("Supabase pagination exceeded maximum page limit"),
	};
}

async function fetchConfigFromSupabaseForServer() {
	const client = requireSupabaseClient();

	const promptRowsWithTags = await fetchAllSupabasePages<{
		id: string;
		query_text: string;
		sort_order: number;
		is_active: boolean;
		tags?: string[] | null;
		updated_at?: string | null;
	}>((from, to) =>
		client
			.from("prompt_queries")
			.select("id,query_text,sort_order,is_active,tags,updated_at")
			.order("sort_order", { ascending: true })
			.range(from, to),
	);

	let promptRowsError = promptRowsWithTags.error;
	let promptRows = promptRowsWithTags.rows;
	if (promptRowsError && isMissingColumn(promptRowsError)) {
		const promptRowsFallback = await fetchAllSupabasePages<{
			id: string;
			query_text: string;
			sort_order: number;
			is_active: boolean;
			updated_at?: string | null;
		}>((from, to) =>
			client
				.from("prompt_queries")
				.select("id,query_text,sort_order,is_active,updated_at")
				.order("sort_order", { ascending: true })
				.range(from, to),
		);
		promptRowsError = promptRowsFallback.error;
		promptRows = promptRowsFallback.rows.map((row) => ({
			...row,
			tags: null,
		}));
	}
	if (promptRowsError) {
		throw asError(
			promptRowsError,
			"Failed to read prompt_queries from Supabase",
		);
	}

	const competitorRowsWithAliases = await fetchAllSupabasePages<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
		is_active: boolean;
		updated_at?: string | null;
		competitor_aliases?: Array<{ alias: string }>;
	}>((from, to) =>
		client
			.from("competitors")
			.select(
				"id,name,slug,is_primary,sort_order,is_active,updated_at,competitor_aliases(alias)",
			)
			.eq("is_active", true)
			.order("sort_order", { ascending: true })
			.range(from, to),
	);

	let competitorRowsError = competitorRowsWithAliases.error;
	let competitorRows = competitorRowsWithAliases.rows;
	if (competitorRowsError && isMissingRelation(competitorRowsError)) {
		const competitorRowsFallback = await fetchAllSupabasePages<{
			id: string;
			name: string;
			slug: string;
			is_primary: boolean;
			sort_order: number;
			is_active: boolean;
			updated_at?: string | null;
		}>((from, to) =>
			client
				.from("competitors")
				.select("id,name,slug,is_primary,sort_order,is_active,updated_at")
				.eq("is_active", true)
				.order("sort_order", { ascending: true })
				.range(from, to),
		);
		competitorRowsError = competitorRowsFallback.error;
		competitorRows = competitorRowsFallback.rows.map((row) => ({
			...row,
			competitor_aliases: [],
		}));
	}
	if (competitorRowsError) {
		throw asError(
			competitorRowsError,
			"Failed to read competitors from Supabase",
		);
	}

	const visiblePromptRows = promptRows.filter(
		(row) => !hasDeletedPromptTag(row.tags),
	);
	const queries = visiblePromptRows.map((row) => row.query_text);
	const queryTags = Object.fromEntries(
		visiblePromptRows.map((row) => [
			row.query_text,
			normalizePromptTags(row.tags, row.query_text),
		]),
	);
	const pausedQueries = visiblePromptRows
		.filter((row) => !row.is_active)
		.map((row) => row.query_text);
	const competitors = competitorRows.map((row) => row.name);

	const aliases: Record<string, string[]> = {};
	for (const row of competitorRows) {
		const aliasValues = (row.competitor_aliases ?? []).map(
			(aliasRow) => aliasRow.alias,
		);
		aliases[row.name] = uniqueNonEmpty([row.name, ...aliasValues]);
	}

	let competitorCitationDomains = defaultCompetitorCitationDomains();
	const appSettingsResult = await client
		.from("app_settings")
		.select("value_json")
		.eq("key", COMPETITOR_CITATION_DOMAINS_SETTING_KEY)
		.limit(1);
	if (appSettingsResult.error) {
		if (
			!isMissingRelation(appSettingsResult.error) &&
			!isMissingColumn(appSettingsResult.error)
		) {
			throw asError(
				appSettingsResult.error,
				`Failed to read app_settings.${COMPETITOR_CITATION_DOMAINS_SETTING_KEY}`,
			);
		}
	} else {
		const row = ((appSettingsResult.data ?? [])[0] ?? null) as {
			value_json?: unknown;
		} | null;
		const valueJson = row?.value_json;
		const bySlug =
			valueJson && typeof valueJson === "object" && !Array.isArray(valueJson)
				? (valueJson as { by_competitor_slug?: unknown }).by_competitor_slug
				: null;
		competitorCitationDomains = mergeCompetitorCitationDomains(bySlug);
	}

	const updatedAt = [
		...visiblePromptRows.map((row) => row.updated_at).filter(Boolean),
		...competitorRows.map((row) => row.updated_at).filter(Boolean),
	]
		.map((value) => String(value))
		.sort()
		.at(-1);

	return {
		config: {
			queries,
			queryTags,
			competitors,
			aliases,
			competitorCitationDomains,
			pausedQueries,
		},
		meta: {
			source:
				"supabase://public.prompt_queries+public.competitors+public.competitor_aliases+public.app_settings",
			updatedAt: updatedAt ?? new Date().toISOString(),
			queries: queries.length,
			competitors: competitors.length,
		},
	};
}

async function updateConfigInSupabaseForServer(config: BenchmarkConfig) {
	const client = requireSupabaseClient();
	const normalized = normalizeConfig(config);
	const queries = normalized.queries;
	const competitors = normalized.competitors;
	const pausedQuerySet = new Set(
		(normalized.pausedQueries ?? []).map((query) => query.trim().toLowerCase()),
	);

	const aliasesByName: Record<string, string[]> = {};
	for (const competitor of competitors) {
		aliasesByName[competitor] = uniqueNonEmpty([
			competitor,
			...(normalized.aliases[competitor] ??
				normalized.aliases[competitor.toLowerCase()] ??
				[]),
		]);
	}

	const queryTags = normalizeQueryTagsMap(queries, normalized.queryTags);
	const promptPayload = queries.map((queryText, index) => ({
		query_text: queryText,
		sort_order: index + 1,
		is_active: !pausedQuerySet.has(queryText.trim().toLowerCase()),
		tags: queryTags[queryText] ?? inferPromptTags(queryText),
	}));

	let promptUpsert = await client
		.from("prompt_queries")
		.upsert(promptPayload, { onConflict: "query_text" });
	if (promptUpsert.error && isMissingColumn(promptUpsert.error)) {
		const promptPayloadWithoutTags = promptPayload.map(
			({ tags: _tags, ...rest }) => rest,
		);
		promptUpsert = await client
			.from("prompt_queries")
			.upsert(promptPayloadWithoutTags, { onConflict: "query_text" });
	}
	if (promptUpsert.error) {
		throw asError(
			promptUpsert.error,
			"Unable to save prompts. Check RLS write policy for prompt_queries",
		);
	}

	let promptTagsColumnAvailable = true;
	const allPromptRowsWithTags = await fetchAllSupabasePages<{
		id: string;
		query_text: string;
		is_active: boolean;
		tags?: string[] | null;
	}>((from, to) =>
		client
			.from("prompt_queries")
			.select("id,query_text,is_active,tags")
			.order("id", { ascending: true })
			.range(from, to),
	);
	let allPromptRowsError = allPromptRowsWithTags.error;
	let allPromptRowsData = allPromptRowsWithTags.rows;

	if (allPromptRowsError && isMissingColumn(allPromptRowsError)) {
		promptTagsColumnAvailable = false;
		const fallbackRows = await fetchAllSupabasePages<{
			id: string;
			query_text: string;
			is_active: boolean;
		}>((from, to) =>
			client
				.from("prompt_queries")
				.select("id,query_text,is_active")
				.order("id", { ascending: true })
				.range(from, to),
		);
		allPromptRowsError = fallbackRows.error;
		allPromptRowsData = fallbackRows.rows.map((row) => ({
			...row,
			tags: null,
		}));
	}

	if (allPromptRowsError) {
		throw asError(allPromptRowsError, "Unable to refresh prompt list");
	}

	const trackedQuerySet = new Set(queries);
	for (const row of allPromptRowsData) {
		const rowPausedKey = row.query_text.trim().toLowerCase();
		const shouldKeep = trackedQuerySet.has(row.query_text);
		const shouldBeActive = shouldKeep && !pausedQuerySet.has(rowPausedKey);
		const shouldMarkDeleted =
			promptTagsColumnAvailable &&
			!shouldKeep &&
			!hasDeletedPromptTag(row.tags);
		const shouldRestoreTracked =
			promptTagsColumnAvailable && shouldKeep && hasDeletedPromptTag(row.tags);

		if (
			row.is_active !== shouldBeActive ||
			shouldMarkDeleted ||
			shouldRestoreTracked
		) {
			const promptUpdatePayload: Record<string, unknown> = {
				is_active: shouldBeActive,
			};
			if (promptTagsColumnAvailable) {
				if (!shouldKeep) {
					promptUpdatePayload.tags = withDeletedPromptTag(
						row.tags,
						row.query_text,
					);
				} else {
					promptUpdatePayload.tags =
						queryTags[row.query_text] ?? inferPromptTags(row.query_text);
				}
			}

			const updateResult = await client
				.from("prompt_queries")
				.update(promptUpdatePayload)
				.eq("id", row.id);
			if (updateResult.error) {
				throw asError(
					updateResult.error,
					"Unable to update prompt active state",
				);
			}
		}
	}

	const competitorPayload = competitors.map((name, index) => ({
		name,
		slug: slugifyEntity(name),
		is_primary: name.toLowerCase() === "highcharts",
		sort_order: index + 1,
		is_active: true,
	}));

	const competitorUpsert = await client
		.from("competitors")
		.upsert(competitorPayload, { onConflict: "slug" });
	if (competitorUpsert.error) {
		throw asError(
			competitorUpsert.error,
			"Unable to save competitors. Check RLS write policy for competitors",
		);
	}

	const allCompetitors = await client
		.from("competitors")
		.select("id,name,slug,is_active");
	if (allCompetitors.error) {
		throw asError(allCompetitors.error, "Unable to refresh competitor list");
	}

	const activeCompetitorSlugSet = new Set(
		competitors.map((name) => slugifyEntity(name)),
	);
	for (const row of (allCompetitors.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_active: boolean;
	}>) {
		const shouldBeActive = activeCompetitorSlugSet.has(row.slug);
		if (row.is_active !== shouldBeActive) {
			const updateResult = await client
				.from("competitors")
				.update({ is_active: shouldBeActive })
				.eq("id", row.id);
			if (updateResult.error) {
				throw asError(
					updateResult.error,
					"Unable to update competitor active state",
				);
			}
		}
	}

	const activeCompetitors = await client
		.from("competitors")
		.select("id,name,slug")
		.eq("is_active", true);
	if (activeCompetitors.error) {
		throw asError(
			activeCompetitors.error,
			"Unable to read active competitors for alias sync",
		);
	}

	for (const competitor of (activeCompetitors.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
	}>) {
		const desiredAliases = uniqueNonEmpty([
			competitor.name,
			...(aliasesByName[competitor.name] ??
				aliasesByName[competitor.name.toLowerCase()] ??
				[]),
		]);

		if (desiredAliases.length > 0) {
			const aliasUpsert = await client.from("competitor_aliases").upsert(
				desiredAliases.map((alias) => ({
					competitor_id: competitor.id,
					alias,
				})),
				{ onConflict: "competitor_id,alias" },
			);
			if (aliasUpsert.error) {
				throw asError(
					aliasUpsert.error,
					`Unable to upsert aliases for ${competitor.name}. Check RLS policy for competitor_aliases`,
				);
			}
		}

		const existingAliases = await client
			.from("competitor_aliases")
			.select("alias")
			.eq("competitor_id", competitor.id);
		if (existingAliases.error) {
			throw asError(
				existingAliases.error,
				`Unable to read aliases for ${competitor.name}`,
			);
		}

		const desiredSet = new Set(
			desiredAliases.map((value) => value.toLowerCase()),
		);
		const extras = (existingAliases.data ?? [])
			.map((row) => String((row as { alias: string }).alias))
			.filter((alias) => !desiredSet.has(alias.toLowerCase()));

		for (const alias of extras) {
			const deleteResult = await client
				.from("competitor_aliases")
				.delete()
				.eq("competitor_id", competitor.id)
				.eq("alias", alias);
			if (deleteResult.error) {
				throw asError(
					deleteResult.error,
					`Unable to delete stale alias ${alias}`,
				);
			}
		}
	}

	if (
		Object.hasOwn(normalized, "competitorCitationDomains") &&
		normalized.competitorCitationDomains !== undefined
	) {
		const normalizedDomains = normalizeCompetitorCitationDomains(
			normalized.competitorCitationDomains,
		);
		const upsertResult = await client.from("app_settings").upsert(
			{
				key: COMPETITOR_CITATION_DOMAINS_SETTING_KEY,
				value_json: {
					version: 1,
					by_competitor_slug: normalizedDomains,
				},
			},
			{ onConflict: "key" },
		);
		if (
			upsertResult.error &&
			!isMissingRelation(upsertResult.error) &&
			!isMissingColumn(upsertResult.error)
		) {
			throw asError(
				upsertResult.error,
				`Unable to save app_settings.${COMPETITOR_CITATION_DOMAINS_SETTING_KEY}`,
			);
		}
	}

	return fetchConfigFromSupabaseForServer();
}

async function togglePromptInSupabaseForServer(
	query: string,
	active: boolean,
): Promise<void> {
	const client = requireSupabaseClient();

	const promptRowWithTags = await client
		.from("prompt_queries")
		.select("id,query_text,tags")
		.eq("query_text", query)
		.limit(1);

	let promptTagsColumnAvailable = true;
	let promptRowError = promptRowWithTags.error;
	let promptRow = ((promptRowWithTags.data ?? [])[0] ?? null) as {
		id: string;
		query_text: string;
		tags?: string[] | null;
	} | null;

	if (promptRowError && isMissingColumn(promptRowError)) {
		promptTagsColumnAvailable = false;
		const fallbackRow = await client
			.from("prompt_queries")
			.select("id,query_text")
			.eq("query_text", query)
			.limit(1);
		promptRowError = fallbackRow.error;
		promptRow = ((fallbackRow.data ?? [])[0] ?? null) as {
			id: string;
			query_text: string;
		} | null;
	}

	if (promptRowError) {
		throw asError(promptRowError, "Failed to load prompt metadata for toggle");
	}
	if (!promptRow) {
		throw new Error(`Prompt not found: ${query}`);
	}

	const updatePayload: Record<string, unknown> = { is_active: active };
	if (promptTagsColumnAvailable) {
		updatePayload.tags = normalizePromptTags(
			promptRow.tags,
			promptRow.query_text,
		);
	}

	const updateResult = await client
		.from("prompt_queries")
		.update(updatePayload)
		.eq("id", promptRow.id);

	if (updateResult.error) {
		throw asError(updateResult.error, "Failed to toggle prompt active state");
	}
}

function hasRunResponses(responseCount: unknown): boolean {
	return Math.max(0, Math.round(asNumber(responseCount))) > 0;
}

function selectDashboardRun<
	T extends { response_count: number | null; ended_at: string | null },
>(runs: T[]): T | null {
	if (runs.length === 0) return null;

	const completedWithResponses = runs.find(
		(run) =>
			hasRunResponses(run.response_count) &&
			Boolean(String(run.ended_at ?? "").trim()),
	);
	if (completedWithResponses) return completedWithResponses;

	const withResponses = runs.find((run) => hasRunResponses(run.response_count));
	if (withResponses) return withResponses;

	return runs[0];
}

function parseSupabaseList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return uniqueNonEmpty(value.map((item) => String(item ?? "")));
	}
	if (typeof value === "string") {
		return uniqueNonEmpty(value.split(",").map((item) => item.trim()));
	}
	return [];
}

function pickTimestamp(
	...values: Array<string | null | undefined>
): string | null {
	for (const value of values) {
		const normalized = String(value ?? "").trim();
		if (!normalized) continue;
		const parsed = Date.parse(normalized);
		if (Number.isFinite(parsed)) {
			return new Date(parsed).toISOString();
		}
	}
	return null;
}

function monthKeyFromDate(value: string | null): string | null {
	if (!value) return null;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	const year = parsed.getUTCFullYear();
	const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
	return `${year}-${month}`;
}

function formatMonthLabel(monthKey: string): string {
	const [yearRaw, monthRaw] = monthKey.split("-");
	const year = Number(yearRaw);
	const month = Number(monthRaw);
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		month < 1 ||
		month > 12
	) {
		return monthKey;
	}

	const dt = new Date(Date.UTC(year, month - 1, 1));
	return dt.toLocaleDateString(undefined, {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
}

function normalizeCitationHost(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	try {
		return new URL(trimmed).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return (
			trimmed
				.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
				.split("/")[0]
				.split("?")[0]
				.split("#")[0]
				.split("@")
				.at(-1)
				?.split(":")[0]
				?.toLowerCase()
				.replace(/^www\./, "")
				.trim() || ""
		);
	}
}

function normalizeDomainCandidate(value: unknown): string | null {
	const host = normalizeCitationHost(String(value ?? ""));
	return host || null;
}

function normalizeCompetitorCitationDomains(
	raw: unknown,
): Record<string, string[]> {
	if (!raw || typeof raw !== "object") {
		return {};
	}

	const input = raw as Record<string, unknown>;
	const output: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(input)) {
		const slug = String(key).trim().toLowerCase();
		if (!slug) continue;
		const candidates = Array.isArray(value) ? value : [value];
		const normalized = [
			...new Set(
				candidates
					.map((candidate) => normalizeDomainCandidate(candidate))
					.filter((candidate): candidate is string => Boolean(candidate)),
			),
		];
		if (normalized.length > 0) {
			output[slug] = normalized;
		}
	}
	return output;
}

function defaultCompetitorCitationDomains(): Record<string, string[]> {
	return { highcharts: ["highcharts.com"] };
}

function mergeCompetitorCitationDomains(
	rawDomains: unknown,
	fallback: Record<string, string[]> = defaultCompetitorCitationDomains(),
): Record<string, string[]> {
	const normalized = normalizeCompetitorCitationDomains(rawDomains);
	const merged: Record<string, string[]> = { ...fallback };
	for (const [slug, domains] of Object.entries(normalized)) {
		merged[slug] = domains;
	}
	return merged;
}

function normalizeCitationProvider(
	value: unknown,
	fallbackProvider = "openai",
): string {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) return fallbackProvider;
	if (normalized.includes("chatgpt-web")) return "chatgpt-web";
	if (normalized.includes("anthropic") || normalized.includes("claude"))
		return "anthropic";
	if (normalized.includes("google") || normalized.includes("gemini"))
		return "google";
	if (
		normalized.includes("openai") ||
		normalized.includes("chatgpt") ||
		normalized.includes("gpt")
	) {
		return "openai";
	}
	return fallbackProvider;
}

function normalizeCitationBound(value: unknown): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	const rounded = Math.round(parsed);
	return rounded >= 0 ? rounded : null;
}

function buildCitationRef(
	candidate: unknown,
	fallbackProvider = "openai",
	sourceText = "",
) {
	if (!candidate || typeof candidate !== "object") return null;
	const entry = candidate as Record<string, unknown>;
	const urlValue = [
		entry.url,
		entry.uri,
		entry.href,
		entry.source,
		entry.link,
	].find((value) => typeof value === "string" && value.trim());
	if (typeof urlValue !== "string") return null;

	const url = urlValue.trim();
	const host = normalizeCitationHost(url);
	const title =
		typeof entry.title === "string" && entry.title.trim()
			? entry.title.trim()
			: host || url;
	const snippetValue = [entry.snippet, entry.text, entry.excerpt].find(
		(value) => typeof value === "string" && value.trim(),
	);
	const snippet =
		typeof snippetValue === "string" ? snippetValue.trim() : undefined;
	const startIndex = normalizeCitationBound(
		entry.start_index ?? entry.startIndex,
	);
	const endIndex = normalizeCitationBound(entry.end_index ?? entry.endIndex);
	let anchorText =
		typeof entry.anchorText === "string" && entry.anchorText.trim()
			? entry.anchorText.trim()
			: typeof entry.anchor_text === "string" && entry.anchor_text.trim()
				? entry.anchor_text.trim()
				: null;

	if (
		!anchorText &&
		sourceText &&
		startIndex !== null &&
		endIndex !== null &&
		endIndex > startIndex &&
		endIndex <= sourceText.length
	) {
		const sliced = sourceText.slice(startIndex, endIndex).trim();
		if (sliced) {
			anchorText = sliced;
		}
	}

	return {
		url,
		title,
		host,
		snippet,
		startIndex,
		endIndex,
		anchorText,
		provider: normalizeCitationProvider(entry.provider, fallbackProvider),
	};
}

function normalizeCitationRefs(
	rawCitations: unknown,
	fallbackProvider = "openai",
) {
	const refs: Array<Record<string, unknown>> = [];
	const seen = new Set<string>();
	let nextId = 1;

	const parseStringValue = (value: string): unknown => {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
			try {
				return JSON.parse(trimmed);
			} catch {
				return { url: trimmed };
			}
		}
		return { url: trimmed };
	};

	const append = (candidate: unknown, sourceText = "") => {
		if (typeof candidate === "string") {
			const parsed = parseStringValue(candidate);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					append(item, sourceText);
				}
				return;
			}
			candidate = parsed;
		}
		if (Array.isArray(candidate)) {
			for (const item of candidate) {
				append(item, sourceText);
			}
			return;
		}
		const normalized = buildCitationRef(
			candidate,
			fallbackProvider,
			sourceText,
		);
		if (!normalized) return;
		const dedupeKey = [
			normalized.url,
			normalized.startIndex ?? "",
			normalized.endIndex ?? "",
			String(normalized.title).toLowerCase(),
			normalized.provider,
		].join("|");
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		refs.push({ id: `c${nextId++}`, ...normalized });
	};

	const walk = (value: unknown) => {
		if (value === null || value === undefined) return;
		if (Array.isArray(value)) {
			for (const item of value) append(item);
			return;
		}
		if (typeof value === "string") {
			walk(parseStringValue(value));
			return;
		}
		if (typeof value !== "object") {
			return;
		}
		const payload = value as Record<string, unknown>;

		if (Array.isArray(payload.citationRefs)) {
			for (const ref of payload.citationRefs) append(ref);
		}
		for (const key of ["citations", "sources", "references"] as const) {
			const topLevel = payload[key];
			if (Array.isArray(topLevel)) {
				for (const candidate of topLevel) append(candidate);
			}
		}

		const outputItems = Array.isArray(payload.output) ? payload.output : [];
		for (const outputItem of outputItems) {
			if (!outputItem || typeof outputItem !== "object") continue;
			const contentItems = Array.isArray(
				(outputItem as { content?: unknown }).content,
			)
				? (((outputItem as { content: unknown[] }).content ?? []) as unknown[])
				: [];
			for (const content of contentItems) {
				if (!content || typeof content !== "object") continue;
				const sourceText =
					typeof (content as { text?: unknown }).text === "string"
						? ((content as { text: string }).text ?? "")
						: "";
				const contentCitations = (content as { citations?: unknown }).citations;
				if (Array.isArray(contentCitations)) {
					for (const candidate of contentCitations)
						append(candidate, sourceText);
				}
				const annotations = (content as { annotations?: unknown }).annotations;
				if (!Array.isArray(annotations)) continue;
				for (const annotation of annotations) {
					append(annotation, sourceText);
					append(
						(annotation as { url_citation?: unknown }).url_citation,
						sourceText,
					);
				}
			}
		}

		const contentItems = Array.isArray(payload.content) ? payload.content : [];
		for (const content of contentItems) {
			if (!content || typeof content !== "object") continue;
			const sourceText =
				typeof (content as { text?: unknown }).text === "string"
					? ((content as { text: string }).text ?? "")
					: "";
			const contentCitations = (content as { citations?: unknown }).citations;
			if (Array.isArray(contentCitations)) {
				for (const candidate of contentCitations) append(candidate, sourceText);
			}
		}

		const candidates = Array.isArray(payload.candidates)
			? payload.candidates
			: [];
		for (const candidate of candidates) {
			if (!candidate || typeof candidate !== "object") continue;
			const grounding = (candidate as { groundingMetadata?: unknown })
				.groundingMetadata;
			if (!grounding || typeof grounding !== "object") continue;
			const chunks = Array.isArray(
				(grounding as { groundingChunks?: unknown }).groundingChunks,
			)
				? (((grounding as { groundingChunks: unknown[] }).groundingChunks ??
						[]) as unknown[])
				: [];
			for (const chunk of chunks) {
				if (!chunk || typeof chunk !== "object") continue;
				append(chunk);
				append((chunk as { web?: unknown }).web);
			}
			const citationSources = Array.isArray(
				(grounding as { citationMetadata?: { citationSources?: unknown } })
					.citationMetadata?.citationSources,
			)
				? (((
						grounding as { citationMetadata?: { citationSources?: unknown[] } }
					).citationMetadata?.citationSources ?? []) as unknown[])
				: [];
			for (const source of citationSources) append(source);
		}

		append(payload);
	};

	walk(rawCitations);

	refs.sort((left, right) => {
		const leftEnd =
			typeof left.endIndex === "number"
				? left.endIndex
				: Number.POSITIVE_INFINITY;
		const rightEnd =
			typeof right.endIndex === "number"
				? right.endIndex
				: Number.POSITIVE_INFINITY;
		if (leftEnd !== rightEnd) return leftEnd - rightEnd;
		return String(left.url ?? "").localeCompare(String(right.url ?? ""));
	});

	return refs.map((ref, index) => ({
		...ref,
		id: `c${index + 1}`,
	}));
}

function normalizeCitations(
	rawCitations: unknown,
	fallbackProvider = "openai",
): string[] {
	const refs = normalizeCitationRefs(rawCitations, fallbackProvider);
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const ref of refs) {
		const url = String(ref.url ?? "").trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
	}
	return urls;
}

function aggregateCitationSources(
	inputs: Array<{
		responseId?: string | number;
		citationRefs?: unknown[] | null;
		citations?: string[] | null;
	}>,
) {
	const buckets = new Map<
		string,
		{
			key: string;
			host: string;
			title: string;
			primaryUrl: string;
			citationCount: number;
			urls: Set<string>;
			responseIds: Set<string>;
			providers: Set<string>;
		}
	>();

	inputs.forEach((input, index) => {
		const responseId = String(input.responseId ?? `row-${index + 1}`);
		const refs = Array.isArray(input.citationRefs)
			? input.citationRefs
			: (input.citations ?? []).map((url, refIndex) => ({
					id: `legacy-${refIndex + 1}`,
					url,
					host: normalizeCitationHost(String(url ?? "")),
					title: normalizeCitationHost(String(url ?? "")) || String(url ?? ""),
					provider: "openai",
				}));
		const seenForResponse = new Set<string>();

		refs.forEach((ref) => {
			const url = String((ref as { url?: unknown }).url ?? "").trim();
			if (!url) return;
			const host =
				normalizeCitationHost(
					String((ref as { host?: unknown }).host ?? url),
				) || url;
			const key = host;

			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = {
					key,
					host,
					title:
						String((ref as { title?: unknown }).title ?? "").trim() || host,
					primaryUrl: url,
					citationCount: 0,
					urls: new Set<string>(),
					responseIds: new Set<string>(),
					providers: new Set<string>(),
				};
				buckets.set(key, bucket);
			}

			bucket.citationCount += 1;
			bucket.urls.add(url);

			const provider = String((ref as { provider?: unknown }).provider ?? "")
				.trim()
				.toLowerCase();
			if (provider) {
				bucket.providers.add(provider);
			}
			if (!seenForResponse.has(key)) {
				seenForResponse.add(key);
				bucket.responseIds.add(responseId);
			}

			const normalizedTitle = String(
				(ref as { title?: unknown }).title ?? "",
			).trim();
			if (
				normalizedTitle &&
				(bucket.title === bucket.host || bucket.title === bucket.primaryUrl)
			) {
				bucket.title = normalizedTitle;
			}
			if (!bucket.primaryUrl || bucket.primaryUrl === bucket.host) {
				bucket.primaryUrl = url;
			}
		});
	});

	return [...buckets.values()]
		.map((bucket) => ({
			key: bucket.key,
			host: bucket.host,
			title: bucket.title,
			primaryUrl: bucket.primaryUrl,
			citationCount: bucket.citationCount,
			responseCount: bucket.responseIds.size,
			uniqueUrlCount: bucket.urls.size,
			providers: [...bucket.providers.values()].sort((left, right) =>
				left.localeCompare(right),
			),
		}))
		.sort((left, right) => {
			if (right.citationCount !== left.citationCount) {
				return right.citationCount - left.citationCount;
			}
			if (right.responseCount !== left.responseCount) {
				return right.responseCount - left.responseCount;
			}
			if (right.uniqueUrlCount !== left.uniqueUrlCount) {
				return right.uniqueUrlCount - left.uniqueUrlCount;
			}
			return left.host.localeCompare(right.host);
		});
}

function aggregateUrlStats(
	refs: Array<{
		responseId: string;
		citationRefs: Array<Record<string, unknown>>;
	}>,
) {
	const buckets = new Map<
		string,
		{
			url: string;
			title: string;
			host: string;
			citationCount: number;
			responseIds: Set<string>;
			providers: Set<string>;
		}
	>();

	for (const { responseId, citationRefs } of refs) {
		for (const ref of citationRefs) {
			const url = String(ref.url ?? "").trim();
			if (!url) continue;
			let bucket = buckets.get(url);
			if (!bucket) {
				bucket = {
					url,
					title:
						String(ref.title ?? "").trim() ||
						String(ref.host ?? "").trim() ||
						url,
					host: String(ref.host ?? "").trim() || url,
					citationCount: 0,
					responseIds: new Set<string>(),
					providers: new Set<string>(),
				};
				buckets.set(url, bucket);
			}
			bucket.citationCount += 1;
			bucket.responseIds.add(responseId);
			if (ref.provider) bucket.providers.add(String(ref.provider));
			if (
				String(ref.title ?? "").trim() &&
				(bucket.title === bucket.host || bucket.title === bucket.url)
			) {
				bucket.title = String(ref.title).trim();
			}
		}
	}

	return [...buckets.values()]
		.map((bucket) => ({
			url: bucket.url,
			title: bucket.title,
			host: bucket.host,
			citationCount: bucket.citationCount,
			responseCount: bucket.responseIds.size,
			providers: [...bucket.providers].sort(),
		}))
		.sort(
			(left, right) =>
				right.citationCount - left.citationCount ||
				right.responseCount - left.responseCount ||
				left.url.localeCompare(right.url),
		);
}

type LlmProviderKey = "chatgpt" | "claude" | "gemini";

function normalizeProviderKey(value: string): LlmProviderKey | null {
	const normalized = value.trim().toLowerCase();
	if (!normalized) return null;
	if (
		normalized.includes("chatgpt") ||
		normalized.includes("openai") ||
		normalized.startsWith("gpt") ||
		normalized.startsWith("o1") ||
		normalized.startsWith("o3")
	) {
		return "chatgpt";
	}
	if (normalized.includes("claude") || normalized.includes("anthropic")) {
		return "claude";
	}
	if (normalized.includes("gemini") || normalized.includes("google")) {
		return "gemini";
	}
	return null;
}

function normalizeSelectedProviders(providers: unknown): LlmProviderKey[] {
	const rawProviders = Array.isArray(providers)
		? providers
		: String(providers ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
	return [
		...new Set(
			rawProviders
				.map((provider) => normalizeProviderKey(String(provider)))
				.filter((provider): provider is LlmProviderKey => provider !== null),
		),
	];
}

function inferProviderFromResponseRow(response: {
	provider?: string | null;
	model_owner?: string | null;
	model?: string | null;
}): LlmProviderKey | null {
	const directProvider = normalizeProviderKey(String(response.provider ?? ""));
	if (directProvider) return directProvider;

	const modelOwnerProvider = normalizeProviderKey(
		String(response.model_owner ?? ""),
	);
	if (modelOwnerProvider) return modelOwnerProvider;

	return normalizeProviderKey(String(response.model ?? ""));
}

function responseMatchesProviderFilter(
	response: {
		provider?: string | null;
		model_owner?: string | null;
		model?: string | null;
	},
	selectedProviderSet: Set<LlmProviderKey>,
): boolean {
	if (selectedProviderSet.size === 0) return true;
	const provider = inferProviderFromResponseRow(response);
	return provider ? selectedProviderSet.has(provider) : false;
}

function resolveRunModels(row: MvRunSummaryRow): string[] {
	if (Array.isArray(row.models)) {
		const fromArray = parseSupabaseList(row.models);
		if (fromArray.length > 0) return fromArray;
	}
	const fromCsv = parseSupabaseList(row.models_csv);
	if (fromCsv.length > 0) return fromCsv;
	return parseSupabaseList(row.model);
}

function resolveRunModelOwners(row: MvRunSummaryRow): string[] {
	if (Array.isArray(row.model_owners)) {
		const fromArray = parseSupabaseList(row.model_owners);
		if (fromArray.length > 0) return fromArray;
	}
	return parseSupabaseList(row.model_owners_csv);
}

function buildModelSummaryFromViewRows(rows: MvModelPerformanceRow[]): {
	modelStats: DashboardModelStat[];
	tokenTotals: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	durationTotals: { totalDurationMs: number; avgDurationMs: number };
	modelOwners: string[];
	modelOwnerMap: Record<string, string>;
	modelOwnerStats: Array<{
		owner: string;
		models: string[];
		responseCount: number;
	}>;
} {
	const modelOwnerMap: Record<string, string> = {};
	const ownerResponseCount = new Map<string, number>();
	const ownerModels = new Map<string, Set<string>>();

	let totalResponses = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalTokens = 0;
	let totalDurationMs = 0;

	const modelStats = rows
		.map((row) => {
			const model = String(row.model ?? "").trim();
			const owner =
				String(row.owner ?? "").trim() || inferModelOwnerFromModel(model);
			const responseCount = Math.max(
				0,
				Math.round(asNumber(row.response_count)),
			);
			const successCount = Math.max(0, Math.round(asNumber(row.success_count)));
			const failureCount = Math.max(0, Math.round(asNumber(row.failure_count)));
			const webSearchEnabledCount = Math.max(
				0,
				Math.round(asNumber(row.web_search_enabled_count)),
			);
			const modelTotalDurationMs = Math.max(
				0,
				Math.round(asNumber(row.total_duration_ms)),
			);
			const modelInputTokens = Math.max(
				0,
				Math.round(asNumber(row.total_input_tokens)),
			);
			const modelOutputTokens = Math.max(
				0,
				Math.round(asNumber(row.total_output_tokens)),
			);
			const modelTotalTokens = Math.max(
				0,
				Math.round(asNumber(row.total_tokens)),
			);

			modelOwnerMap[model] = owner;
			ownerResponseCount.set(
				owner,
				(ownerResponseCount.get(owner) ?? 0) + responseCount,
			);
			const ownerModelSet = ownerModels.get(owner) ?? new Set<string>();
			ownerModelSet.add(model);
			ownerModels.set(owner, ownerModelSet);

			totalResponses += responseCount;
			totalInputTokens += modelInputTokens;
			totalOutputTokens += modelOutputTokens;
			totalTokens += modelTotalTokens;
			totalDurationMs += modelTotalDurationMs;

			return {
				model,
				owner,
				responseCount,
				successCount,
				failureCount,
				webSearchEnabledCount,
				totalDurationMs: modelTotalDurationMs,
				avgDurationMs: roundTo(asNumber(row.avg_duration_ms), 2),
				p95DurationMs: roundTo(asNumber(row.p95_duration_ms), 2),
				totalInputTokens: modelInputTokens,
				totalOutputTokens: modelOutputTokens,
				totalTokens: modelTotalTokens,
				avgInputTokens: roundTo(asNumber(row.avg_input_tokens), 2),
				avgOutputTokens: roundTo(asNumber(row.avg_output_tokens), 2),
				avgTotalTokens: roundTo(asNumber(row.avg_total_tokens), 2),
			} satisfies DashboardModelStat;
		})
		.sort((left, right) => {
			if (right.responseCount !== left.responseCount) {
				return right.responseCount - left.responseCount;
			}
			return left.model.localeCompare(right.model);
		});

	const modelOwners = [...new Set(Object.values(modelOwnerMap))].sort((a, b) =>
		a.localeCompare(b),
	);
	const modelOwnerStats = [...ownerResponseCount.entries()]
		.map(([owner, responseCount]) => ({
			owner,
			models: [...(ownerModels.get(owner) ?? new Set<string>())].sort((a, b) =>
				a.localeCompare(b),
			),
			responseCount,
		}))
		.sort((left, right) => {
			if (right.responseCount !== left.responseCount) {
				return right.responseCount - left.responseCount;
			}
			return left.owner.localeCompare(right.owner);
		});

	return {
		modelStats,
		tokenTotals: {
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			totalTokens,
		},
		durationTotals: {
			totalDurationMs,
			avgDurationMs:
				totalResponses > 0 ? roundTo(totalDurationMs / totalResponses, 2) : 0,
		},
		modelOwners,
		modelOwnerMap,
		modelOwnerStats,
	};
}

async function fetchModelPerformanceRowsByRunIds(
	runIds: string[],
): Promise<MvModelPerformanceRow[]> {
	if (runIds.length === 0) {
		return [];
	}
	const client = requireSupabaseClient();
	const rows: MvModelPerformanceRow[] = [];
	const chunkSize = 100;

	for (let index = 0; index < runIds.length; index += chunkSize) {
		const runIdChunk = runIds.slice(index, index + chunkSize);
		let offset = 0;

		while (true) {
			const result = await client
				.from("mv_model_performance")
				.select(
					"run_id,model,owner,response_count,success_count,failure_count,web_search_enabled_count,total_duration_ms,avg_duration_ms,p95_duration_ms,total_input_tokens,total_output_tokens,total_tokens,avg_input_tokens,avg_output_tokens,avg_total_tokens",
				)
				.in("run_id", runIdChunk)
				.order("run_id", { ascending: true })
				.order("model", { ascending: true })
				.range(offset, offset + SUPABASE_PAGE_SIZE - 1);

			if (result.error) {
				throw asError(result.error, "Failed to load mv_model_performance rows");
			}
			const pageRows = (result.data ?? []) as MvModelPerformanceRow[];
			if (pageRows.length === 0) {
				break;
			}
			rows.push(...pageRows);
			offset += pageRows.length;
		}
	}

	return rows;
}

async function fetchMentionRateRowsByRunIds(
	runIds: string[],
	options: { overallOnly?: boolean } = {},
): Promise<MvCompetitorMentionRateRow[]> {
	if (runIds.length === 0) {
		return [];
	}
	const client = requireSupabaseClient();
	const rows: MvCompetitorMentionRateRow[] = [];
	const chunkSize = 100;

	for (let index = 0; index < runIds.length; index += chunkSize) {
		const runIdChunk = runIds.slice(index, index + chunkSize);
		let offset = 0;

		while (true) {
			let query = client
				.from("mv_competitor_mention_rates")
				.select(
					"run_id,query_id,query_key,query_text,competitor_id,entity,entity_key,is_highcharts,is_overall_row,response_count,input_tokens,output_tokens,total_tokens,total_duration_ms,mentions_count,mentions_rate_pct,share_of_voice_rate_pct",
				)
				.in("run_id", runIdChunk)
				.order("run_id", { ascending: true })
				.order("query_key", { ascending: true })
				.order("entity_key", { ascending: true })
				.range(offset, offset + SUPABASE_PAGE_SIZE - 1);

			if (typeof options.overallOnly === "boolean") {
				query = query.eq("is_overall_row", options.overallOnly);
			}

			const result = await query;
			if (result.error) {
				throw asError(
					result.error,
					"Failed to load mv_competitor_mention_rates rows",
				);
			}
			const pageRows = (result.data ?? []) as MvCompetitorMentionRateRow[];
			if (pageRows.length === 0) {
				break;
			}
			rows.push(...pageRows);
			offset += pageRows.length;
		}
	}

	return rows;
}

async function fetchHistoricalRunsByQueryIds(
	queryIds: string[],
): Promise<Map<string, Set<string>>> {
	const runsByQuery = new Map<string, Set<string>>();
	if (queryIds.length === 0) {
		return runsByQuery;
	}
	const client = requireSupabaseClient();
	const chunkSize = 100;

	for (let index = 0; index < queryIds.length; index += chunkSize) {
		const queryIdChunk = queryIds.slice(index, index + chunkSize);
		let offset = 0;
		while (true) {
			const result = await client
				.from("mv_competitor_mention_rates")
				.select("run_id,query_id")
				.eq("is_overall_row", false)
				.in("query_id", queryIdChunk)
				.order("run_id", { ascending: true })
				.range(offset, offset + SUPABASE_PAGE_SIZE - 1);

			if (result.error) {
				throw asError(
					result.error,
					"Failed to load historical run counts from mv_competitor_mention_rates",
				);
			}
			const pageRows = (result.data ?? []) as Array<{
				run_id: string;
				query_id: string | null;
			}>;
			if (pageRows.length === 0) {
				break;
			}
			for (const row of pageRows) {
				if (!row.query_id) continue;
				const runSet = runsByQuery.get(row.query_id) ?? new Set<string>();
				runSet.add(row.run_id);
				runsByQuery.set(row.query_id, runSet);
			}
			offset += pageRows.length;
		}
	}

	return runsByQuery;
}

function emptyDashboardFromConfig(config: BenchmarkConfig) {
	return {
		generatedAt: new Date().toISOString(),
		summary: {
			overallScore: 0,
			queryCount: config.queries.length,
			competitorCount: config.competitors.length,
			totalResponses: 0,
			models: [],
			modelOwners: [],
			modelOwnerMap: {},
			modelOwnerStats: [],
			modelStats: [],
			tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			durationTotals: { totalDurationMs: 0, avgDurationMs: 0 },
			runMonth: null,
			webSearchEnabled: null,
			windowStartUtc: null,
			windowEndUtc: null,
		},
		kpi: null,
		competitorSeries: config.competitors.map((entity) => ({
			entity,
			entityKey: slugifyEntity(entity),
			isHighcharts: entity.toLowerCase() === "highcharts",
			mentionRatePct: 0,
			shareOfVoicePct: 0,
		})),
		promptStatus: config.queries.map((query) => ({
			query,
			tags: inferPromptTags(query),
			isPaused: Boolean((config.pausedQueries ?? []).includes(query)),
			status: "awaiting_run",
			runs: 0,
			highchartsRatePct: 0,
			highchartsRank: null,
			highchartsRankOutOf: config.competitors.length,
			viabilityRatePct: 0,
			topCompetitor: null,
			latestRunResponseCount: null,
			latestInputTokens: 0,
			latestOutputTokens: 0,
			latestTotalTokens: 0,
			estimatedInputCostUsd: 0,
			estimatedOutputCostUsd: 0,
			estimatedTotalCostUsd: 0,
			estimatedAvgCostPerResponseUsd: 0,
			competitorRates: config.competitors.map((name) => ({
				entity: name,
				entityKey: slugifyEntity(name),
				isHighcharts: name.toLowerCase() === "highcharts",
				mentions: 0,
				ratePct: 0,
			})),
		})),
		comparisonRows: [],
		files: {
			comparisonTablePresent: true,
			competitorChartPresent: true,
			kpiPresent: false,
			llmOutputsPresent: false,
		},
	};
}

function summarizePromptStatusForDashboard(promptStatus = []) {
	return promptStatus.map((prompt) => ({
		query: prompt.query,
		tags: Array.isArray(prompt.tags) ? prompt.tags : [],
		isPaused: Boolean(prompt.isPaused),
		status: prompt.status,
		runs: Math.max(0, Math.round(asNumber(prompt.runs))),
		highchartsRatePct: roundTo(asNumber(prompt.highchartsRatePct), 2),
		latestRunResponseCount:
			typeof prompt.latestRunResponseCount === "number" &&
			Number.isFinite(prompt.latestRunResponseCount)
				? Math.max(0, Math.round(prompt.latestRunResponseCount))
				: null,
		competitorRates: Array.isArray(prompt.competitorRates)
			? prompt.competitorRates.map((rate) => ({
					entity: String(rate?.entity ?? ""),
					entityKey: String(rate?.entityKey ?? ""),
					isHighcharts: Boolean(rate?.isHighcharts),
					ratePct: roundTo(asNumber(rate?.ratePct), 2),
					mentions:
						typeof rate?.mentions === "number" && Number.isFinite(rate.mentions)
							? Math.max(0, Math.round(rate.mentions))
							: undefined,
				}))
			: [],
	}));
}

function toDashboardOverviewPayload(payload) {
	return {
		...payload,
		promptStatus: summarizePromptStatusForDashboard(payload?.promptStatus ?? []),
	};
}

async function fetchDashboardFromSupabaseTablesForServer(
	config: BenchmarkConfig,
	options: { providers?: unknown } = {},
) {
	const client = requireSupabaseClient();
	const selectedProviders = normalizeSelectedProviders(options.providers);
	const selectedProviderSet = new Set(selectedProviders);

	const promptRowsWithTags = await fetchAllSupabasePages<{
		id: string;
		query_text: string;
		sort_order: number;
		is_active: boolean;
		tags?: string[] | null;
	}>((from, to) =>
		client
			.from("prompt_queries")
			.select("id,query_text,sort_order,is_active,tags")
			.order("sort_order", { ascending: true })
			.range(from, to),
	);

	let promptRowsError = promptRowsWithTags.error;
	let promptRows = promptRowsWithTags.rows;
	if (promptRowsError && isMissingColumn(promptRowsError)) {
		const promptRowsFallback = await fetchAllSupabasePages<{
			id: string;
			query_text: string;
			sort_order: number;
			is_active: boolean;
		}>((from, to) =>
			client
				.from("prompt_queries")
				.select("id,query_text,sort_order,is_active")
				.order("sort_order", { ascending: true })
				.range(from, to),
		);
		promptRowsError = promptRowsFallback.error;
		promptRows = promptRowsFallback.rows.map((row) => ({
			...row,
			tags: null,
		}));
	}
	if (promptRowsError) {
		throw asError(
			promptRowsError,
			"Failed to load prompt metadata for dashboard",
		);
	}

	const competitorResult = await client
		.from("competitors")
		.select("id,name,slug,is_primary,sort_order")
		.eq("is_active", true)
		.order("sort_order", { ascending: true });
	if (competitorResult.error) {
		throw asError(
			competitorResult.error,
			"Failed to load competitors for dashboard",
		);
	}
	const competitorRows = (competitorResult.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
	}>;

	const runResult = await fetchAllSupabasePages<{
		id: string;
		run_month: string | null;
		model: string | null;
		run_kind?: "full" | "cohort" | null;
		cohort_tag?: string | null;
		web_search_enabled: boolean | null;
		started_at: string | null;
		ended_at: string | null;
		overall_score: number | null;
		created_at: string | null;
	}>((from, to) =>
		client
			.from("benchmark_runs")
			.select(
				"id,run_month,model,run_kind,cohort_tag,web_search_enabled,started_at,ended_at,overall_score,created_at",
			)
			.order("created_at", { ascending: false })
			.range(from, to),
	);

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return emptyDashboardFromConfig(config);
		}
		throw asError(
			runResult.error,
			"Failed to load benchmark_runs for dashboard",
		);
	}

	const allRuns = runResult.rows;
	const latestRun = allRuns[0] ?? null;
	if (!latestRun) {
		return emptyDashboardFromConfig(config);
	}

	const runIds = allRuns.map((run) => run.id);
	const responses: Array<{
		id: number;
		run_id: string;
		query_id: string;
		run_iteration: number;
		model: string;
		provider?: string | null;
		model_owner?: string | null;
		web_search_enabled: boolean;
		error?: string | null;
		duration_ms?: number | null;
		prompt_tokens?: number | null;
		completion_tokens?: number | null;
		total_tokens?: number | null;
	}> = [];
	const runChunkSize = 100;

	for (let index = 0; index < runIds.length; index += runChunkSize) {
		const runIdChunk = runIds.slice(index, index + runChunkSize);
		let responseOffset = 0;

		while (true) {
			const responseResultWithStats = await client
				.from("benchmark_responses")
				.select(
					"id,run_id,query_id,run_iteration,model,provider,model_owner,web_search_enabled,error,duration_ms,prompt_tokens,completion_tokens,total_tokens",
				)
				.in("run_id", runIdChunk)
				.order("id", { ascending: true })
				.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);

			let responseError = responseResultWithStats.error;
			let pageRows = (responseResultWithStats.data ?? []) as Array<{
				id: number;
				run_id: string;
				query_id: string;
				run_iteration: number;
				model: string;
				provider?: string | null;
				model_owner?: string | null;
				web_search_enabled: boolean;
				error?: string | null;
				duration_ms?: number | null;
				prompt_tokens?: number | null;
				completion_tokens?: number | null;
				total_tokens?: number | null;
			}>;

			if (responseError && isMissingColumn(responseError)) {
				const responseResultFallback = await client
					.from("benchmark_responses")
					.select(
						"id,run_id,query_id,run_iteration,model,web_search_enabled,error",
					)
					.in("run_id", runIdChunk)
					.order("id", { ascending: true })
					.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);
				responseError = responseResultFallback.error;
				pageRows = (
					(responseResultFallback.data ?? []) as Array<{
						id: number;
						run_id: string;
						query_id: string;
						run_iteration: number;
						model: string;
						web_search_enabled: boolean;
						error?: string | null;
					}>
				).map((row) => ({
					...row,
					provider: null,
					model_owner: null,
					duration_ms: 0,
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				}));
			}

			if (responseError) {
				if (isMissingRelation(responseError)) {
					return emptyDashboardFromConfig(config);
				}
				throw asError(
					responseError,
					"Failed to load benchmark_responses for dashboard",
				);
			}

			if (pageRows.length === 0) {
				break;
			}

			for (const response of pageRows) {
				if (
					selectedProviderSet.size > 0 &&
					!responseMatchesProviderFilter(response, selectedProviderSet)
				) {
					continue;
				}
				responses.push(response);
			}

			responseOffset += pageRows.length;
		}
	}

	const responseById = new Map<number, (typeof responses)[number]>();
	const responsesByQuery = new Map<string, typeof responses>();
	const runIdsByQuery = new Map<string, Set<string>>();
	const selectedRunIds = new Set<string>();
	const selectedModels = new Set<string>();

	for (const response of responses) {
		responseById.set(response.id, response);
		selectedRunIds.add(response.run_id);
		if (response.model) {
			selectedModels.add(response.model);
		}

		const queryResponses = responsesByQuery.get(response.query_id) ?? [];
		queryResponses.push(response);
		responsesByQuery.set(response.query_id, queryResponses);

		const queryRunIds =
			runIdsByQuery.get(response.query_id) ?? new Set<string>();
		queryRunIds.add(response.run_id);
		runIdsByQuery.set(response.query_id, queryRunIds);
	}

	const responseIds = responses.map((row) => row.id);
	const mentionRows: Array<{
		response_id: number;
		competitor_id: string;
		mentioned: boolean;
	}> = [];
	for (
		let index = 0;
		index < responseIds.length;
		index += SUPABASE_IN_CLAUSE_CHUNK_SIZE
	) {
		const responseChunk = responseIds.slice(
			index,
			index + SUPABASE_IN_CLAUSE_CHUNK_SIZE,
		);
		let mentionOffset = 0;

		while (true) {
			const mentionResult = await client
				.from("response_mentions")
				.select("response_id,competitor_id,mentioned")
				.in("response_id", responseChunk)
				.order("response_id", { ascending: true })
				.order("competitor_id", { ascending: true })
				.range(mentionOffset, mentionOffset + SUPABASE_PAGE_SIZE - 1);

			if (mentionResult.error) {
				if (isMissingRelation(mentionResult.error)) {
					return emptyDashboardFromConfig(config);
				}
				throw asError(
					mentionResult.error,
					"Failed to load response_mentions for dashboard",
				);
			}

			const pageRows = (mentionResult.data ?? []) as Array<{
				response_id: number;
				competitor_id: string;
				mentioned: boolean;
			}>;
			if (pageRows.length === 0) {
				break;
			}

			mentionRows.push(...pageRows);
			mentionOffset += pageRows.length;
		}
	}

	const activeCompetitorIds = new Set(competitorRows.map((row) => row.id));
	const mentionsByResponse = new Map<number, Set<string>>();
	const mentionsByCompetitorId = new Map<string, number>();
	const mentionsByQueryAndCompetitor = new Map<string, number>();

	for (const mention of mentionRows) {
		if (!mention.mentioned || !activeCompetitorIds.has(mention.competitor_id)) {
			continue;
		}

		const response = responseById.get(mention.response_id);
		if (!response) continue;

		const responseMentions =
			mentionsByResponse.get(mention.response_id) ?? new Set<string>();
		responseMentions.add(mention.competitor_id);
		mentionsByResponse.set(mention.response_id, responseMentions);

		mentionsByCompetitorId.set(
			mention.competitor_id,
			(mentionsByCompetitorId.get(mention.competitor_id) ?? 0) + 1,
		);

		const queryCompetitorKey = `${response.query_id}:${mention.competitor_id}`;
		mentionsByQueryAndCompetitor.set(
			queryCompetitorKey,
			(mentionsByQueryAndCompetitor.get(queryCompetitorKey) ?? 0) + 1,
		);
	}

	const totalResponses = responses.length;
	const totalMentionsAcrossEntities = [
		...mentionsByCompetitorId.values(),
	].reduce((sum, mentions) => sum + mentions, 0);

	const competitorSeries = competitorRows.map((competitor) => {
		const mentionsCount = mentionsByCompetitorId.get(competitor.id) ?? 0;
		const mentionRatePct =
			totalResponses > 0 ? (mentionsCount / totalResponses) * 100 : 0;
		const shareOfVoicePct =
			totalMentionsAcrossEntities > 0
				? (mentionsCount / totalMentionsAcrossEntities) * 100
				: 0;

		return {
			entity: competitor.name,
			entityKey: competitor.slug,
			isHighcharts: competitor.is_primary || competitor.slug === "highcharts",
			mentionRatePct: roundTo(mentionRatePct, 2),
			shareOfVoicePct: roundTo(shareOfVoicePct, 2),
		};
	});

	const highchartsCompetitor =
		competitorRows.find((row) => row.is_primary) ??
		competitorRows.find((row) => row.slug === "highcharts") ??
		null;
	const nonHighchartsCompetitors = competitorRows.filter(
		(row) => row.id !== highchartsCompetitor?.id,
	);

	const promptStatus = promptRows.map((queryRow) => {
		const queryResponses = responsesByQuery.get(queryRow.id) ?? [];
		const responseCount = queryResponses.length;
		const runs = runIdsByQuery.get(queryRow.id)?.size ?? 0;
		const inputTokens = queryResponses.reduce(
			(sum, response) => sum + safeTokenInt(response.prompt_tokens),
			0,
		);
		const outputTokens = queryResponses.reduce(
			(sum, response) => sum + safeTokenInt(response.completion_tokens),
			0,
		);
		const totalTokens = queryResponses.reduce((sum, response) => {
			const responseInputTokens = safeTokenInt(response.prompt_tokens);
			const responseOutputTokens = safeTokenInt(response.completion_tokens);
			const responseTotalTokens =
				safeTokenInt(response.total_tokens) ||
				responseInputTokens + responseOutputTokens;
			return sum + responseTotalTokens;
		}, 0);
		const promptCostTotals = queryResponses.reduce(
			(totals, response) => {
				const input = safeTokenInt(response.prompt_tokens);
				const output = safeTokenInt(response.completion_tokens);
				const costs = estimateResponseCostForServer(
					response.model,
					input,
					output,
				);
				totals.inputCostUsd += costs.inputCostUsd;
				totals.outputCostUsd += costs.outputCostUsd;
				totals.totalCostUsd += costs.totalCostUsd;
				if (costs.priced) {
					totals.pricedResponses += 1;
				}
				return totals;
			},
			{
				inputCostUsd: 0,
				outputCostUsd: 0,
				totalCostUsd: 0,
				pricedResponses: 0,
			},
		);

		const competitorRatesAll = competitorRows.map((competitor) => {
			const mentions =
				mentionsByQueryAndCompetitor.get(`${queryRow.id}:${competitor.id}`) ??
				0;
			const ratePct = responseCount > 0 ? (mentions / responseCount) * 100 : 0;
			const isHighcharts = highchartsCompetitor
				? competitor.id === highchartsCompetitor.id
				: competitor.slug === "highcharts";

			return {
				entity: competitor.name,
				entityKey: competitor.slug,
				isHighcharts,
				ratePct,
				mentions,
			};
		});

		const highchartsRateEntry =
			competitorRatesAll.find((entry) => entry.isHighcharts) ?? null;
		const highchartsRatePct = highchartsRateEntry?.ratePct ?? 0;
		const competitorRates = competitorRatesAll.filter(
			(entry) => !entry.isHighcharts,
		);

		const highchartsRank =
			responseCount > 0 && highchartsRateEntry
				? (() => {
						const sortedRates = competitorRatesAll
							.slice()
							.sort((left, right) => {
								if (right.ratePct !== left.ratePct) {
									return right.ratePct - left.ratePct;
								}
								return left.entity.localeCompare(right.entity);
							});
						const index = sortedRates.findIndex((entry) => entry.isHighcharts);
						return index >= 0 ? index + 1 : null;
					})()
				: null;

		const viabilityCount = competitorRates.reduce(
			(sum, entry) => sum + entry.mentions,
			0,
		);
		const viabilityDenominator =
			responseCount * nonHighchartsCompetitors.length;
		const viabilityRatePct =
			viabilityDenominator > 0
				? (viabilityCount / viabilityDenominator) * 100
				: 0;
		const topCompetitor =
			competitorRates
				.slice()
				.sort((left, right) => right.ratePct - left.ratePct)
				.map((entry) => ({
					entity: entry.entity,
					ratePct: roundTo(entry.ratePct, 2),
				}))
				.at(0) ?? null;
		const isDeleted = hasDeletedPromptTag(queryRow.tags);
		const status: PromptStatus["status"] = isDeleted
			? "deleted"
			: runs > 0
				? "tracked"
				: "awaiting_run";

		return {
			query: queryRow.query_text,
			tags: normalizePromptTags(queryRow.tags, queryRow.query_text),
			isPaused: !isDeleted && !queryRow.is_active,
			status,
			runs,
			highchartsRatePct: roundTo(highchartsRatePct, 2),
			highchartsRank,
			highchartsRankOutOf: competitorRows.length,
			viabilityRatePct: roundTo(viabilityRatePct, 2),
			topCompetitor,
			latestRunResponseCount: responseCount,
			latestInputTokens: inputTokens,
			latestOutputTokens: outputTokens,
			latestTotalTokens: totalTokens,
			estimatedInputCostUsd: roundTo(promptCostTotals.inputCostUsd, 6),
			estimatedOutputCostUsd: roundTo(promptCostTotals.outputCostUsd, 6),
			estimatedTotalCostUsd: roundTo(promptCostTotals.totalCostUsd, 6),
			estimatedAvgCostPerResponseUsd:
				promptCostTotals.pricedResponses > 0
					? roundTo(
							promptCostTotals.totalCostUsd / promptCostTotals.pricedResponses,
							6,
						)
					: 0,
			competitorRates: competitorRatesAll.map((entry) => ({
				entity: entry.entity,
				entityKey: entry.entityKey,
				isHighcharts: entry.isHighcharts,
				ratePct: roundTo(entry.ratePct, 2),
				mentions: entry.mentions,
			})),
		};
	});

	const selectedRuns = allRuns.filter((run) => selectedRunIds.has(run.id));
	const runTimestamps = selectedRuns
		.map((run) => pickTimestamp(run.started_at, run.created_at, run.ended_at))
		.filter((value): value is string => Boolean(value))
		.sort((left, right) => Date.parse(left) - Date.parse(right));
	const webSearchStates = new Set(
		selectedRuns
			.map((run) => run.web_search_enabled)
			.filter((value): value is boolean => typeof value === "boolean"),
	);
	const webSearchEnabled =
		webSearchStates.size === 0
			? null
			: webSearchStates.size === 1
				? webSearchStates.has(true)
					? "yes"
					: "no"
				: "mixed";

	const responseRows = responses as Array<Record<string, unknown>>;
	const ownerSummary = buildModelOwnerSummaryFromRows(responseRows);
	const modelStatsSummary = buildModelStatsFromRows(responseRows);
	const models =
		selectedModels.size > 0
			? [...selectedModels].sort((left, right) => left.localeCompare(right))
			: [];
	const highchartsSeries =
		competitorSeries.find((series) => series.isHighcharts) ?? null;
	const overallScore = roundTo(
		0.7 * (highchartsSeries?.mentionRatePct ?? 0) +
			0.3 * (highchartsSeries?.shareOfVoicePct ?? 0),
		2,
	);
	const latestSelectedRun = selectedRuns[0] ?? latestRun;
	const modelOwnerMapString = Object.entries(ownerSummary.modelOwnerMap)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([model, owner]) => `${model}=>${owner}`)
		.join(";");

	const kpi = {
		metric_name: "AI Visibility Overall",
		ai_visibility_overall_score: overallScore,
		score_scale: "0-100",
		queries_count: String(promptRows.length),
		window_start_utc: runTimestamps[0] ?? "",
		window_end_utc: runTimestamps.at(-1) ?? "",
		models: models.join(","),
		model_owners: ownerSummary.modelOwners.join(","),
		model_owner_map: modelOwnerMapString,
		web_search_enabled: webSearchEnabled ?? "",
		run_month: latestSelectedRun.run_month ?? "",
		run_id: latestSelectedRun.id,
	};

	return {
		generatedAt: new Date().toISOString(),
		summary: {
			overallScore,
			queryCount: promptRows.length,
			competitorCount: competitorRows.length,
			totalResponses,
			models,
			modelOwners: ownerSummary.modelOwners,
			modelOwnerMap: ownerSummary.modelOwnerMap,
			modelOwnerStats: ownerSummary.modelOwnerStats,
			modelStats: modelStatsSummary.modelStats,
			tokenTotals: modelStatsSummary.tokenTotals,
			durationTotals: modelStatsSummary.durationTotals,
			runMonth: latestSelectedRun.run_month,
			webSearchEnabled,
			windowStartUtc: runTimestamps[0] ?? null,
			windowEndUtc: runTimestamps.at(-1) ?? null,
		},
		kpi,
		competitorSeries,
		promptStatus,
		comparisonRows: [],
		files: {
			comparisonTablePresent: true,
			competitorChartPresent: true,
			kpiPresent: true,
			llmOutputsPresent: totalResponses > 0,
		},
	};
}

async function fetchDashboardFromSupabaseViewsForServer(
	config: BenchmarkConfig,
) {
	const client = requireSupabaseClient();

	const promptWithTags = await client
		.from("prompt_queries")
		.select("id,query_text,sort_order,is_active,tags")
		.order("sort_order", { ascending: true });
	let promptRowsError = promptWithTags.error;
	let promptRows = (promptWithTags.data ?? []) as Array<{
		id: string;
		query_text: string;
		sort_order: number;
		is_active: boolean;
		tags?: string[] | null;
	}>;
	if (promptRowsError && isMissingColumn(promptRowsError)) {
		const fallbackRows = await client
			.from("prompt_queries")
			.select("id,query_text,sort_order,is_active")
			.order("sort_order", { ascending: true });
		promptRowsError = fallbackRows.error;
		promptRows = (
			(fallbackRows.data ?? []) as Array<{
				id: string;
				query_text: string;
				sort_order: number;
				is_active: boolean;
			}>
		).map((row) => ({ ...row, tags: null }));
	}
	if (promptRowsError) {
		throw asError(
			promptRowsError,
			"Failed to load prompt metadata for dashboard",
		);
	}

	const competitorResult = await client
		.from("competitors")
		.select("id,name,slug,is_primary,sort_order")
		.eq("is_active", true)
		.order("sort_order", { ascending: true });
	if (competitorResult.error) {
		throw asError(
			competitorResult.error,
			"Failed to load competitors for dashboard",
		);
	}
	const competitorRows = (competitorResult.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
	}>;

	const runResult = await fetchAllSupabasePages((from, to) =>
		client
			.from("mv_run_summary")
			.select(
				"run_id,run_month,model,run_kind,cohort_tag,models,models_csv,model_owners,model_owners_csv,model_owner_map,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,competitor_count,input_tokens,output_tokens,total_tokens,total_duration_ms,avg_duration_ms",
			)
			.order("created_at", { ascending: false })
			.range(from, to),
	);

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return emptyDashboardFromConfig(config);
		}
		throw asError(
			runResult.error,
			"Failed to load mv_run_summary for dashboard",
		);
	}

	const selectedRuns = runResult.rows;
	const latestRun = selectDashboardRun(selectedRuns);
	if (!latestRun || selectedRuns.length === 0) {
		return emptyDashboardFromConfig(config);
	}

	const runIds = selectedRuns.map((run) => run.run_id);
	const [mentionRows, modelRows, historicalRunsByQuery] = await Promise.all([
		fetchMentionRateRowsByRunIds(runIds),
		fetchModelPerformanceRowsByRunIds(runIds),
		fetchHistoricalRunsByQueryIds(promptRows.map((row) => row.id)),
	]);

	const modelSummary = buildModelSummaryFromViewRows(modelRows);
	const aggregatedModels = new Set<string>();
	for (const run of selectedRuns) {
		for (const model of resolveRunModels(run)) {
			aggregatedModels.add(model);
		}
	}
	const runModels = [...aggregatedModels].sort((left, right) =>
		left.localeCompare(right),
	);
	const runModelOwners = selectedRuns.flatMap((run) =>
		resolveRunModelOwners(run),
	);
	const ownerMapFromRun = parseModelOwnerMap(
		String(latestRun.model_owner_map ?? ""),
	);
	const modelOwnerMap =
		Object.keys(modelSummary.modelOwnerMap).length > 0
			? { ...modelSummary.modelOwnerMap }
			: { ...ownerMapFromRun };
	for (const model of runModels) {
		if (!modelOwnerMap[model]) {
			modelOwnerMap[model] = inferModelOwnerFromModel(model);
		}
	}
	const modelOwners =
		modelSummary.modelOwners.length > 0
			? modelSummary.modelOwners
			: runModelOwners.length > 0
				? runModelOwners
				: [...new Set(Object.values(modelOwnerMap))].sort((a, b) =>
						a.localeCompare(b),
					);

	const highchartsCompetitor =
		competitorRows.find((row) => row.is_primary) ??
		competitorRows.find((row) => row.slug === "highcharts") ??
		null;
	const nonHighchartsCompetitors = competitorRows.filter(
		(row) => row.id !== highchartsCompetitor?.id,
	);

	let pricedInputTokens = 0;
	let pricedOutputTokens = 0;
	let pricedInputCostUsd = 0;
	let pricedOutputCostUsd = 0;
	for (const row of modelRows) {
		const model = String(row.model ?? "").trim();
		if (!model) continue;
		const inputTokens = Math.max(
			0,
			Math.round(asNumber(row.total_input_tokens)),
		);
		const outputTokens = Math.max(
			0,
			Math.round(asNumber(row.total_output_tokens)),
		);
		const costs = estimateResponseCostForServer(
			model,
			inputTokens,
			outputTokens,
		);
		if (!costs.priced) continue;
		pricedInputTokens += inputTokens;
		pricedOutputTokens += outputTokens;
		pricedInputCostUsd += costs.inputCostUsd;
		pricedOutputCostUsd += costs.outputCostUsd;
	}
	const blendedInputCostPerToken =
		pricedInputTokens > 0 ? pricedInputCostUsd / pricedInputTokens : 0;
	const blendedOutputCostPerToken =
		pricedOutputTokens > 0 ? pricedOutputCostUsd / pricedOutputTokens : 0;

	const runTimestamps = selectedRuns
		.map((run) => pickTimestamp(run.started_at, run.created_at, run.ended_at))
		.filter((value): value is string => Boolean(value))
		.sort((left, right) => Date.parse(left) - Date.parse(right));
	const webSearchStates = new Set(
		selectedRuns
			.map((run) => run.web_search_enabled)
			.filter((value): value is boolean => typeof value === "boolean"),
	);
	const webSearchEnabled =
		webSearchStates.size === 0
			? null
			: webSearchStates.size === 1
				? webSearchStates.has(true)
					? "yes"
					: "no"
				: "mixed";
	const totalsFromRuns = selectedRuns.reduce(
		(totals, run) => {
			totals.responses += Math.max(0, Math.round(asNumber(run.response_count)));
			totals.inputTokens += Math.max(0, Math.round(asNumber(run.input_tokens)));
			totals.outputTokens += Math.max(
				0,
				Math.round(asNumber(run.output_tokens)),
			);
			totals.totalTokens += Math.max(0, Math.round(asNumber(run.total_tokens)));
			totals.totalDurationMs += Math.max(
				0,
				Math.round(asNumber(run.total_duration_ms)),
			);
			return totals;
		},
		{
			responses: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			totalDurationMs: 0,
		},
	);

	const overallMentionsByCompetitorId = new Map<string, number>();
	const fallbackMentionsByCompetitorId = new Map<string, number>();
	const responseCountsByQuery = new Map<string, Map<string, number>>();
	const mentionsByQueryAndCompetitor = new Map<string, number>();
	const queryTokensByRun = new Map<
		string,
		Map<string, { input: number; output: number; total: number }>
	>();

	for (const row of mentionRows) {
		const mentions = Math.max(0, Math.round(asNumber(row.mentions_count)));

		if (row.is_overall_row) {
			overallMentionsByCompetitorId.set(
				row.competitor_id,
				(overallMentionsByCompetitorId.get(row.competitor_id) ?? 0) + mentions,
			);
			continue;
		}

		if (!row.query_id) continue;

		const queryId = row.query_id;
		const runId = row.run_id;
		const queryRunResponseCounts =
			responseCountsByQuery.get(queryId) ?? new Map<string, number>();
		if (!queryRunResponseCounts.has(runId)) {
			queryRunResponseCounts.set(
				runId,
				Math.max(0, Math.round(asNumber(row.response_count))),
			);
			responseCountsByQuery.set(queryId, queryRunResponseCounts);
		}

		const queryCompetitorKey = `${queryId}:${row.competitor_id}`;
		mentionsByQueryAndCompetitor.set(
			queryCompetitorKey,
			(mentionsByQueryAndCompetitor.get(queryCompetitorKey) ?? 0) + mentions,
		);
		fallbackMentionsByCompetitorId.set(
			row.competitor_id,
			(fallbackMentionsByCompetitorId.get(row.competitor_id) ?? 0) + mentions,
		);

		const tokensByRun = queryTokensByRun.get(queryId) ?? new Map();
		const tokenBucket = tokensByRun.get(runId) ?? {
			input: 0,
			output: 0,
			total: 0,
		};
		tokenBucket.input = Math.max(
			tokenBucket.input,
			Math.max(0, Math.round(asNumber(row.input_tokens))),
		);
		tokenBucket.output = Math.max(
			tokenBucket.output,
			Math.max(0, Math.round(asNumber(row.output_tokens))),
		);
		tokenBucket.total = Math.max(
			tokenBucket.total,
			Math.max(0, Math.round(asNumber(row.total_tokens))),
		);
		tokensByRun.set(runId, tokenBucket);
		queryTokensByRun.set(queryId, tokensByRun);
	}

	const competitorSeries = competitorRows.map((competitor) => {
		const mentionsCount =
			overallMentionsByCompetitorId.get(competitor.id) ??
			fallbackMentionsByCompetitorId.get(competitor.id) ??
			0;
		return {
			entity: competitor.name,
			entityKey: competitor.slug,
			isHighcharts: competitor.is_primary || competitor.slug === "highcharts",
			mentionRatePct:
				totalsFromRuns.responses > 0
					? roundTo((mentionsCount / totalsFromRuns.responses) * 100, 2)
					: 0,
			shareOfVoicePct: 0,
			mentionsCount,
		};
	});
	const totalMentionsAcrossEntities = competitorSeries.reduce(
		(sum, series) => sum + series.mentionsCount,
		0,
	);
	for (const series of competitorSeries) {
		series.shareOfVoicePct =
			totalMentionsAcrossEntities > 0
				? roundTo((series.mentionsCount / totalMentionsAcrossEntities) * 100, 2)
				: 0;
	}

	const promptStatus = promptRows.map((queryRow) => {
		const queryResponseCounts =
			responseCountsByQuery.get(queryRow.id) ?? new Map();
		const latestRunResponseCount = [...queryResponseCounts.values()].reduce(
			(sum, value) => sum + value,
			0,
		);
		const tokenTotalsByRun = queryTokensByRun.get(queryRow.id) ?? new Map();
		const latestInputTokens = [...tokenTotalsByRun.values()].reduce(
			(sum, value) => sum + value.input,
			0,
		);
		const latestOutputTokens = [...tokenTotalsByRun.values()].reduce(
			(sum, value) => sum + value.output,
			0,
		);
		const latestTotalTokens = [...tokenTotalsByRun.values()].reduce(
			(sum, value) =>
				sum + (value.total > 0 ? value.total : value.input + value.output),
			0,
		);

		const competitorRatesAll = competitorRows.map((competitor) => {
			const mentions =
				mentionsByQueryAndCompetitor.get(`${queryRow.id}:${competitor.id}`) ??
				0;
			const ratePct =
				latestRunResponseCount > 0
					? roundTo((mentions / latestRunResponseCount) * 100, 2)
					: 0;
			const isHighcharts = highchartsCompetitor
				? competitor.id === highchartsCompetitor.id
				: competitor.slug === "highcharts";
			return {
				entity: competitor.name,
				entityKey: competitor.slug,
				isHighcharts,
				ratePct,
				mentions,
			};
		});

		const competitorRates = competitorRatesAll.filter(
			(entry) => !entry.isHighcharts,
		);
		const highchartsRateEntry =
			competitorRatesAll.find((entry) => entry.isHighcharts) ?? null;
		const highchartsRatePct = highchartsRateEntry?.ratePct ?? 0;

		const highchartsRank =
			latestRunResponseCount > 0 && highchartsRateEntry
				? (() => {
						const sortedRates = competitorRatesAll
							.slice()
							.sort((left, right) => {
								if (right.ratePct !== left.ratePct) {
									return right.ratePct - left.ratePct;
								}
								return left.entity.localeCompare(right.entity);
							});
						const index = sortedRates.findIndex((entry) => entry.isHighcharts);
						return index >= 0 ? index + 1 : null;
					})()
				: null;

		const viabilityCount = competitorRates.reduce(
			(sum, entry) => sum + entry.mentions,
			0,
		);
		const viabilityDenominator =
			latestRunResponseCount * nonHighchartsCompetitors.length;
		const viabilityRatePct =
			viabilityDenominator > 0
				? (viabilityCount / viabilityDenominator) * 100
				: 0;

		const topCompetitor =
			competitorRates
				.slice()
				.sort((left, right) => right.ratePct - left.ratePct)
				.map((entry) => ({
					entity: entry.entity,
					ratePct: roundTo(entry.ratePct, 2),
				}))
				.at(0) ?? null;

		const estimatedInputCostUsd = latestInputTokens * blendedInputCostPerToken;
		const estimatedOutputCostUsd =
			latestOutputTokens * blendedOutputCostPerToken;
		const estimatedTotalCostUsd =
			estimatedInputCostUsd + estimatedOutputCostUsd;
		const runs = historicalRunsByQuery.get(queryRow.id)?.size ?? 0;

		return {
			query: queryRow.query_text,
			tags: normalizePromptTags(queryRow.tags, queryRow.query_text),
			isPaused: !queryRow.is_active,
			status: runs > 0 ? "tracked" : "awaiting_run",
			runs,
			highchartsRatePct: roundTo(highchartsRatePct, 2),
			highchartsRank,
			highchartsRankOutOf: competitorRows.length,
			viabilityRatePct: roundTo(viabilityRatePct, 2),
			topCompetitor,
			latestRunResponseCount,
			latestInputTokens,
			latestOutputTokens,
			latestTotalTokens,
			estimatedInputCostUsd: roundTo(estimatedInputCostUsd, 6),
			estimatedOutputCostUsd: roundTo(estimatedOutputCostUsd, 6),
			estimatedTotalCostUsd: roundTo(estimatedTotalCostUsd, 6),
			estimatedAvgCostPerResponseUsd:
				latestRunResponseCount > 0
					? roundTo(estimatedTotalCostUsd / latestRunResponseCount, 6)
					: 0,
			competitorRates: competitorRatesAll.map((entry) => ({
				entity: entry.entity,
				entityKey: entry.entityKey,
				isHighcharts: entry.isHighcharts,
				ratePct: roundTo(entry.ratePct, 2),
				mentions: entry.mentions,
			})),
		};
	});

	const totalResponses = totalsFromRuns.responses;
	const highchartsSeries =
		competitorSeries.find((series) => series.isHighcharts) ?? null;
	const overallScore = roundTo(
		0.7 * (highchartsSeries?.mentionRatePct ?? 0) +
			0.3 * (highchartsSeries?.shareOfVoicePct ?? 0),
		2,
	);
	const modelOwnerMapString = Object.entries(modelOwnerMap)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([model, owner]) => `${model}=>${owner}`)
		.join(";");
	const summaryTokenTotals =
		modelSummary.tokenTotals.totalTokens > 0
			? modelSummary.tokenTotals
			: {
					inputTokens: totalsFromRuns.inputTokens,
					outputTokens: totalsFromRuns.outputTokens,
					totalTokens: totalsFromRuns.totalTokens,
				};
	const summaryDurationTotals =
		modelSummary.durationTotals.totalDurationMs > 0
			? modelSummary.durationTotals
			: {
					totalDurationMs: totalsFromRuns.totalDurationMs,
					avgDurationMs:
						totalsFromRuns.responses > 0
							? roundTo(
									totalsFromRuns.totalDurationMs / totalsFromRuns.responses,
									2,
								)
							: 0,
				};

	const kpi = {
		metric_name: "AI Visibility Overall",
		ai_visibility_overall_score: overallScore,
		score_scale: "0-100",
		queries_count: String(promptRows.length),
		window_start_utc: runTimestamps[0] ?? "",
		window_end_utc: runTimestamps.at(-1) ?? "",
		models: runModels.join(","),
		model_owners: modelOwners.join(","),
		model_owner_map: modelOwnerMapString,
		web_search_enabled: webSearchEnabled ?? "",
		run_month: latestRun.run_month ?? "",
		run_id: latestRun.run_id,
	};

	return {
		generatedAt: new Date().toISOString(),
		summary: {
			overallScore,
			queryCount: promptRows.length,
			competitorCount: competitorRows.length,
			totalResponses,
			models: runModels,
			modelOwners,
			modelOwnerMap,
			modelOwnerStats: modelSummary.modelOwnerStats,
			modelStats: modelSummary.modelStats,
			tokenTotals: summaryTokenTotals,
			durationTotals: summaryDurationTotals,
			runMonth: latestRun.run_month,
			webSearchEnabled,
			windowStartUtc: runTimestamps[0] ?? null,
			windowEndUtc: runTimestamps.at(-1) ?? null,
		},
		kpi,
		competitorSeries: competitorSeries.map(
			({ mentionsCount, ...series }) => series,
		),
		promptStatus,
		comparisonRows: [],
		files: {
			comparisonTablePresent: true,
			competitorChartPresent: true,
			kpiPresent: true,
			llmOutputsPresent: totalResponses > 0,
		},
	};
}

async function fetchUnderTheHoodFromSupabaseViewsForServer(
	config: BenchmarkConfig,
	rangeInput: UnderTheHoodRange,
) {
	const client = requireSupabaseClient();
	const range = normalizeUnderTheHoodRange(rangeInput);
	const nowMs = Date.now();
	const nowIso = new Date(nowMs).toISOString();
	const rangeStartMs = rangeStartMsForUnderTheHood(range, nowMs);
	const rangeStartIso =
		rangeStartMs !== null ? new Date(rangeStartMs).toISOString() : null;

	let runQuery = client
		.from("mv_run_summary")
		.select(
			"run_id,run_month,model,run_kind,cohort_tag,models,models_csv,model_owners,model_owners_csv,model_owner_map,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,competitor_count,input_tokens,output_tokens,total_tokens,total_duration_ms,avg_duration_ms",
		)
		.order("created_at", { ascending: false })
		.limit(500);
	if (rangeStartIso) {
		runQuery = runQuery.gte("created_at", rangeStartIso);
	}
	const runResult = await runQuery;
	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return {
				generatedAt: new Date().toISOString(),
				range,
				rangeLabel: rangeLabelForUnderTheHood(range),
				rangeStartUtc: rangeStartIso,
				rangeEndUtc: nowIso,
				summary: {
					overallScore: 0,
					queryCount: config.queries.length,
					competitorCount: config.competitors.length,
					totalResponses: 0,
					models: [],
					modelOwners: [],
					modelOwnerMap: {},
					modelOwnerStats: [],
					modelStats: [],
					tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
					durationTotals: { totalDurationMs: 0, avgDurationMs: 0 },
					runMonth: null,
					webSearchEnabled: null,
					windowStartUtc: null,
					windowEndUtc: null,
				},
			};
		}
		throw asError(
			runResult.error,
			"Failed to load mv_run_summary for under-the-hood",
		);
	}

	const selectedRuns = (runResult.data ?? []) as MvRunSummaryRow[];
	if (selectedRuns.length === 0) {
		return {
			generatedAt: new Date().toISOString(),
			range,
			rangeLabel: rangeLabelForUnderTheHood(range),
			rangeStartUtc: rangeStartIso,
			rangeEndUtc: nowIso,
			summary: {
				overallScore: 0,
				queryCount: config.queries.length,
				competitorCount: config.competitors.length,
				totalResponses: 0,
				models: [],
				modelOwners: [],
				modelOwnerMap: {},
				modelOwnerStats: [],
				modelStats: [],
				tokenTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				durationTotals: { totalDurationMs: 0, avgDurationMs: 0 },
				runMonth: null,
				webSearchEnabled: null,
				windowStartUtc: null,
				windowEndUtc: null,
			},
		};
	}

	const runIds = selectedRuns.map((run) => run.run_id);
	const modelRows = await fetchModelPerformanceRowsByRunIds(runIds);
	const modelSummary = buildModelSummaryFromViewRows(modelRows);

	const aggregatedModelOwnerMap = { ...modelSummary.modelOwnerMap };
	const aggregatedModels = new Set<string>();
	for (const run of selectedRuns) {
		for (const model of resolveRunModels(run)) {
			aggregatedModels.add(model);
			if (!aggregatedModelOwnerMap[model]) {
				aggregatedModelOwnerMap[model] = inferModelOwnerFromModel(model);
			}
		}
	}

	const runTimestamps = selectedRuns
		.map((run) => pickTimestamp(run.started_at, run.created_at, run.ended_at))
		.filter((value): value is string => Boolean(value))
		.sort((left, right) => Date.parse(left) - Date.parse(right));

	const latestRun = selectDashboardRun(selectedRuns) ?? selectedRuns[0];
	const webSearchStates = new Set(
		selectedRuns
			.map((run) => run.web_search_enabled)
			.filter((value): value is boolean => typeof value === "boolean"),
	);
	const webSearchEnabled =
		webSearchStates.size === 0
			? null
			: webSearchStates.size === 1
				? webSearchStates.has(true)
					? "yes"
					: "no"
				: "mixed";

	const totalsFromRuns = selectedRuns.reduce(
		(totals, run) => {
			totals.responses += Math.max(0, Math.round(asNumber(run.response_count)));
			totals.inputTokens += Math.max(0, Math.round(asNumber(run.input_tokens)));
			totals.outputTokens += Math.max(
				0,
				Math.round(asNumber(run.output_tokens)),
			);
			totals.totalTokens += Math.max(0, Math.round(asNumber(run.total_tokens)));
			totals.totalDurationMs += Math.max(
				0,
				Math.round(asNumber(run.total_duration_ms)),
			);
			return totals;
		},
		{
			responses: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			totalDurationMs: 0,
		},
	);

	return {
		generatedAt: new Date().toISOString(),
		range,
		rangeLabel: rangeLabelForUnderTheHood(range),
		rangeStartUtc: rangeStartIso,
		rangeEndUtc: nowIso,
		summary: {
			overallScore: roundTo(asNumber(latestRun.overall_score), 2),
			queryCount: config.queries.length,
			competitorCount: config.competitors.length,
			totalResponses: totalsFromRuns.responses,
			models: [...aggregatedModels].sort((a, b) => a.localeCompare(b)),
			modelOwners:
				modelSummary.modelOwners.length > 0
					? modelSummary.modelOwners
					: [...new Set(Object.values(aggregatedModelOwnerMap))].sort((a, b) =>
							a.localeCompare(b),
						),
			modelOwnerMap: aggregatedModelOwnerMap,
			modelOwnerStats: modelSummary.modelOwnerStats,
			modelStats: modelSummary.modelStats,
			tokenTotals:
				modelSummary.tokenTotals.totalTokens > 0
					? modelSummary.tokenTotals
					: {
							inputTokens: totalsFromRuns.inputTokens,
							outputTokens: totalsFromRuns.outputTokens,
							totalTokens: totalsFromRuns.totalTokens,
						},
			durationTotals:
				modelSummary.durationTotals.totalDurationMs > 0
					? modelSummary.durationTotals
					: {
							totalDurationMs: totalsFromRuns.totalDurationMs,
							avgDurationMs:
								totalsFromRuns.responses > 0
									? roundTo(
											totalsFromRuns.totalDurationMs / totalsFromRuns.responses,
											2,
										)
									: 0,
						},
			runMonth: latestRun.run_month,
			webSearchEnabled,
			windowStartUtc: runTimestamps[0] ?? null,
			windowEndUtc: runTimestamps.at(-1) ?? null,
		},
	};
}

async function fetchRunCostsFromSupabaseViewsForServer(limit = 30) {
	const client = requireSupabaseClient();
	const clampedLimit = Math.max(1, Math.min(200, Math.round(limit)));
	const runResult = await client
		.from("mv_run_summary")
		.select(
			"run_id,run_month,model,run_kind,cohort_tag,models,models_csv,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,input_tokens,output_tokens,total_tokens",
		)
		.order("created_at", { ascending: false })
		.limit(clampedLimit);

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return {
				generatedAt: new Date().toISOString(),
				runCount: 0,
				totals: {
					responseCount: 0,
					inputTokens: 0,
					outputTokens: 0,
					totalTokens: 0,
					estimatedInputCostUsd: 0,
					estimatedOutputCostUsd: 0,
					estimatedTotalCostUsd: 0,
				},
				runs: [],
			};
		}
		throw asError(
			runResult.error,
			"Failed to load mv_run_summary for run costs",
		);
	}

	const runRows = (runResult.data ?? []) as MvRunSummaryRow[];
	if (runRows.length === 0) {
		return {
			generatedAt: new Date().toISOString(),
			runCount: 0,
			totals: {
				responseCount: 0,
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				estimatedInputCostUsd: 0,
				estimatedOutputCostUsd: 0,
				estimatedTotalCostUsd: 0,
			},
			runs: [],
		};
	}

	const modelRows = await fetchModelPerformanceRowsByRunIds(
		runRows.map((row) => row.run_id),
	);
	const modelRowsByRun = new Map<string, MvModelPerformanceRow[]>();
	for (const row of modelRows) {
		const bucket = modelRowsByRun.get(row.run_id) ?? [];
		bucket.push(row);
		modelRowsByRun.set(row.run_id, bucket);
	}

	const runs = runRows.map((run) => {
		const rowsForRun = modelRowsByRun.get(run.run_id) ?? [];
		const resolvedModels =
			resolveRunModels(run).length > 0
				? resolveRunModels(run)
				: [...new Set(rowsForRun.map((row) => row.model).filter(Boolean))].sort(
						(a, b) => a.localeCompare(b),
					);

		let estimatedInputCostUsd = 0;
		let estimatedOutputCostUsd = 0;
		let estimatedTotalCostUsd = 0;
		let pricedResponseCount = 0;
		const unpricedModels = new Set<string>();

		for (const row of rowsForRun) {
			const model = String(row.model ?? "").trim();
			if (!model) continue;
			const inputTokens = Math.max(
				0,
				Math.round(asNumber(row.total_input_tokens)),
			);
			const outputTokens = Math.max(
				0,
				Math.round(asNumber(row.total_output_tokens)),
			);
			const responseCount = Math.max(
				0,
				Math.round(asNumber(row.response_count)),
			);
			const costs = estimateResponseCostForServer(
				model,
				inputTokens,
				outputTokens,
			);
			estimatedInputCostUsd += costs.inputCostUsd;
			estimatedOutputCostUsd += costs.outputCostUsd;
			estimatedTotalCostUsd += costs.totalCostUsd;
			if (costs.priced) {
				pricedResponseCount += responseCount;
			} else {
				unpricedModels.add(model);
			}
		}

		return {
			runId: run.run_id,
			runMonth: run.run_month,
			runKind: run.run_kind ?? "full",
			cohortTag: run.cohort_tag ?? null,
			createdAt: run.created_at,
			startedAt: run.started_at,
			endedAt: run.ended_at,
			webSearchEnabled:
				typeof run.web_search_enabled === "boolean"
					? run.web_search_enabled
					: null,
			responseCount: Math.max(0, Math.round(asNumber(run.response_count))),
			models: resolvedModels,
			inputTokens: Math.max(0, Math.round(asNumber(run.input_tokens))),
			outputTokens: Math.max(0, Math.round(asNumber(run.output_tokens))),
			totalTokens: Math.max(0, Math.round(asNumber(run.total_tokens))),
			pricedResponseCount,
			unpricedModels: [...unpricedModels].sort((a, b) => a.localeCompare(b)),
			estimatedInputCostUsd: roundTo(estimatedInputCostUsd, 6),
			estimatedOutputCostUsd: roundTo(estimatedOutputCostUsd, 6),
			estimatedTotalCostUsd: roundTo(estimatedTotalCostUsd, 6),
		};
	});

	const totals = runs.reduce(
		(sum, run) => {
			sum.responseCount += run.responseCount;
			sum.inputTokens += run.inputTokens;
			sum.outputTokens += run.outputTokens;
			sum.totalTokens += run.totalTokens;
			sum.estimatedInputCostUsd += run.estimatedInputCostUsd;
			sum.estimatedOutputCostUsd += run.estimatedOutputCostUsd;
			sum.estimatedTotalCostUsd += run.estimatedTotalCostUsd;
			return sum;
		},
		{
			responseCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			estimatedInputCostUsd: 0,
			estimatedOutputCostUsd: 0,
			estimatedTotalCostUsd: 0,
		},
	);

	return {
		generatedAt: new Date().toISOString(),
		runCount: runs.length,
		totals: {
			responseCount: totals.responseCount,
			inputTokens: totals.inputTokens,
			outputTokens: totals.outputTokens,
			totalTokens: totals.totalTokens,
			estimatedInputCostUsd: roundTo(totals.estimatedInputCostUsd, 6),
			estimatedOutputCostUsd: roundTo(totals.estimatedOutputCostUsd, 6),
			estimatedTotalCostUsd: roundTo(totals.estimatedTotalCostUsd, 6),
		},
		runs,
	};
}

async function fetchTimeseriesFromSupabaseTablesForServer(options = {}) {
	const client = requireSupabaseClient();
	const selectedTags = normalizeSelectedTags(options.tags);
	const selectedProviders = normalizeSelectedProviders(options.providers);
	const selectedProviderSet = new Set(selectedProviders);
	const tagFilterMode = options.mode === "all" ? "all" : "any";
	const selectedTagSet = new Set(selectedTags);

	const competitorResult = await client
		.from("competitors")
		.select("id,name,slug,is_primary,sort_order")
		.eq("is_active", true)
		.order("sort_order", { ascending: true });

	if (competitorResult.error) {
		throw asError(
			competitorResult.error,
			"Failed to load competitors for time series",
		);
	}

	const competitorRows = (competitorResult.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
	}>;
	const competitors = competitorRows.map((row) => row.name);
	if (competitorRows.length === 0) {
		return { ok: true, competitors: [], points: [] };
	}

	const promptResultWithTags = await client
		.from("prompt_queries")
		.select("id,query_text,tags");

	let promptQueryError = promptResultWithTags.error;
	let promptQueryRows = (promptResultWithTags.data ?? []) as Array<{
		id: string;
		query_text: string;
		tags?: string[] | null;
	}>;

	if (promptQueryError && isMissingColumn(promptQueryError)) {
		const fallbackRows = await client
			.from("prompt_queries")
			.select("id,query_text");
		promptQueryError = fallbackRows.error;
		promptQueryRows = (
			(fallbackRows.data ?? []) as Array<{ id: string; query_text: string }>
		).map((row) => ({ ...row, tags: null }));
	}

	if (promptQueryError && !isMissingRelation(promptQueryError)) {
		throw asError(
			promptQueryError,
			"Failed to load prompt metadata for time series tags",
		);
	}

	const tagsByPromptId = new Map<string, string[]>();
	for (const row of promptQueryRows) {
		tagsByPromptId.set(row.id, normalizePromptTags(row.tags, row.query_text));
	}
	const shouldFilterByTags = selectedTagSet.size > 0 && tagsByPromptId.size > 0;

	const runResult = await client
		.from("benchmark_runs")
		.select("id,created_at,run_month,overall_score")
		.order("created_at", { ascending: true })
		.limit(500);

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return { ok: true, competitors, points: [] };
		}
		throw asError(
			runResult.error,
			"Failed to load benchmark_runs for time series",
		);
	}

	const runRows = (runResult.data ?? []) as Array<{
		id: string;
		created_at: string | null;
		run_month: string | null;
		overall_score: number | null;
	}>;
	if (runRows.length === 0) {
		return { ok: true, competitors, points: [] };
	}

	const runIds = runRows.map((row) => row.id);
	const responseRows: Array<{
		id: number;
		run_id: string;
		query_id: string;
		model?: string | null;
		provider?: string | null;
		model_owner?: string | null;
	}> = [];
	const runChunkSize = 100;

	for (let index = 0; index < runIds.length; index += runChunkSize) {
		const runIdChunk = runIds.slice(index, index + runChunkSize);
		let responseOffset = 0;

		while (true) {
			const responseResultWithProvider = await client
				.from("benchmark_responses")
				.select("id,run_id,query_id,model,provider,model_owner")
				.in("run_id", runIdChunk)
				.order("id", { ascending: true })
				.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);

			let responseError = responseResultWithProvider.error;
			let pageRows = (responseResultWithProvider.data ?? []) as Array<{
				id: number;
				run_id: string;
				query_id: string;
				model?: string | null;
				provider?: string | null;
				model_owner?: string | null;
			}>;

			if (responseError && isMissingColumn(responseError)) {
				const responseResultFallback = await client
					.from("benchmark_responses")
					.select("id,run_id,query_id,model")
					.in("run_id", runIdChunk)
					.order("id", { ascending: true })
					.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);
				responseError = responseResultFallback.error;
				pageRows = (
					(responseResultFallback.data ?? []) as Array<{
						id: number;
						run_id: string;
						query_id: string;
						model?: string | null;
					}>
				).map((row) => ({
					...row,
					provider: null,
					model_owner: null,
				}));
			}

			if (responseError) {
				if (isMissingRelation(responseError)) {
					return { ok: true, competitors, points: [] };
				}
				throw asError(
					responseError,
					"Failed to load benchmark_responses for time series",
				);
			}

			if (pageRows.length === 0) {
				break;
			}

			for (const response of pageRows) {
				if (
					selectedProviderSet.size > 0 &&
					!responseMatchesProviderFilter(response, selectedProviderSet)
				) {
					continue;
				}
				if (shouldFilterByTags) {
					const promptTags = tagsByPromptId.get(response.query_id);
					if (
						!promptTags ||
						!promptMatchesTagFilter(promptTags, selectedTagSet, tagFilterMode)
					) {
						continue;
					}
				}
				responseRows.push(response);
			}

			responseOffset += pageRows.length;
		}
	}

	if (responseRows.length === 0) {
		return { ok: true, competitors, points: [] };
	}

	const responseIds = responseRows.map((row) => row.id);
	const responseToRun = new Map<number, string>();
	const totalsByRun = new Map<string, number>();
	for (const response of responseRows) {
		responseToRun.set(response.id, response.run_id);
		totalsByRun.set(
			response.run_id,
			(totalsByRun.get(response.run_id) ?? 0) + 1,
		);
	}

	const mentionRows: Array<{
		response_id: number;
		competitor_id: string;
		mentioned: boolean;
	}> = [];
	for (
		let index = 0;
		index < responseIds.length;
		index += SUPABASE_IN_CLAUSE_CHUNK_SIZE
	) {
		const responseChunk = responseIds.slice(
			index,
			index + SUPABASE_IN_CLAUSE_CHUNK_SIZE,
		);
		let mentionOffset = 0;

		while (true) {
			const mentionResult = await client
				.from("response_mentions")
				.select("response_id,competitor_id,mentioned")
				.in("response_id", responseChunk)
				.order("response_id", { ascending: true })
				.order("competitor_id", { ascending: true })
				.range(mentionOffset, mentionOffset + SUPABASE_PAGE_SIZE - 1);

			if (mentionResult.error) {
				if (isMissingRelation(mentionResult.error)) {
					return { ok: true, competitors, points: [] };
				}
				throw asError(
					mentionResult.error,
					"Failed to load response_mentions for time series",
				);
			}

			const pageRows = (mentionResult.data ?? []) as Array<{
				response_id: number;
				competitor_id: string;
				mentioned: boolean;
			}>;
			if (pageRows.length === 0) {
				break;
			}

			mentionRows.push(...pageRows);
			mentionOffset += pageRows.length;
		}
	}

	const activeCompetitorIds = new Set(competitorRows.map((row) => row.id));
	const mentionsByRun = new Map<string, Map<string, number>>();
	for (const mention of mentionRows) {
		if (!mention.mentioned || !activeCompetitorIds.has(mention.competitor_id)) {
			continue;
		}

		const runId = responseToRun.get(mention.response_id);
		if (!runId) continue;

		const runMentions = mentionsByRun.get(runId) ?? new Map<string, number>();
		runMentions.set(
			mention.competitor_id,
			(runMentions.get(mention.competitor_id) ?? 0) + 1,
		);
		mentionsByRun.set(runId, runMentions);
	}

	const highchartsCompetitor =
		competitorRows.find((row) => row.is_primary) ??
		competitorRows.find((row) => row.slug === "highcharts") ??
		null;
	const rivalCompetitors = competitorRows.filter(
		(row) => row.id !== highchartsCompetitor?.id,
	);

	const points = runRows
		.map((run) => {
			const total = totalsByRun.get(run.id) ?? 0;
			if (total < 1) {
				return null;
			}

			const fallbackDate =
				run.run_month && /^\d{4}-\d{2}$/.test(run.run_month)
					? `${run.run_month}-01`
					: new Date().toISOString().slice(0, 10);
			const timestamp = run.created_at ?? `${fallbackDate}T12:00:00Z`;
			const runMentions = mentionsByRun.get(run.id);
			const highchartsMentions = highchartsCompetitor
				? (runMentions?.get(highchartsCompetitor.id) ?? 0)
				: 0;
			const highchartsRatePct =
				total > 0 ? (highchartsMentions / total) * 100 : 0;
			const totalMentionsAcrossEntities = competitorRows.reduce(
				(sum, competitor) => sum + (runMentions?.get(competitor.id) ?? 0),
				0,
			);
			const highchartsSovPct =
				totalMentionsAcrossEntities > 0
					? (highchartsMentions / totalMentionsAcrossEntities) * 100
					: 0;
			const derivedAiVisibility =
				0.7 * highchartsRatePct + 0.3 * highchartsSovPct;
			const storedAiVisibility =
				selectedTagSet.size === 0 &&
				selectedProviderSet.size === 0 &&
				typeof run.overall_score === "number" &&
				Number.isFinite(run.overall_score)
					? run.overall_score
					: null;
			const rivalMentionCount = rivalCompetitors.reduce(
				(sum, competitor) => sum + (runMentions?.get(competitor.id) ?? 0),
				0,
			);
			const combviDenominator = total * rivalCompetitors.length;
			const combviPct =
				combviDenominator > 0
					? (rivalMentionCount / combviDenominator) * 100
					: 0;

			return {
				date: timestamp.slice(0, 10),
				timestamp,
				total,
				aiVisibilityScore: roundTo(
					storedAiVisibility ?? derivedAiVisibility,
					2,
				),
				combviPct: roundTo(combviPct, 2),
				rates: Object.fromEntries(
					competitorRows.map((competitor) => {
						const mentions = runMentions?.get(competitor.id) ?? 0;
						const mentionRatePct = total > 0 ? (mentions / total) * 100 : 0;
						return [competitor.name, roundTo(mentionRatePct, 2)];
					}),
				),
			};
		})
		.filter((point): point is NonNullable<typeof point> => point !== null)
		.sort((left, right) => {
			const leftMs = Date.parse(left.timestamp ?? `${left.date}T12:00:00Z`);
			const rightMs = Date.parse(right.timestamp ?? `${right.date}T12:00:00Z`);
			return leftMs - rightMs;
		});

	return {
		ok: true,
		competitors,
		points,
	};
}

async function fetchTimeseriesFromSupabaseViewsForServer(options = {}) {
	const client = requireSupabaseClient();
	const selectedTags = normalizeSelectedTags(options.tags);
	const selectedProviderSet = new Set(
		normalizeSelectedProviders(options.providers),
	);
	const selectedTagSet = new Set(selectedTags);
	const tagFilterMode = options.mode === "all" ? "all" : "any";

	const competitorResult = await client
		.from("competitors")
		.select("id,name,slug,is_primary,sort_order")
		.eq("is_active", true)
		.order("sort_order", { ascending: true });

	if (competitorResult.error) {
		throw asError(
			competitorResult.error,
			"Failed to load competitors for time series",
		);
	}

	const competitorRows = (competitorResult.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
	}>;
	const competitors = competitorRows.map((row) => row.name);
	if (competitorRows.length === 0) {
		return { ok: true, competitors: [], points: [] };
	}

	const promptResultWithTags = await client
		.from("prompt_queries")
		.select("id,query_text,tags");

	let promptRowsError = promptResultWithTags.error;
	let promptRows = (promptResultWithTags.data ?? []) as Array<{
		id: string;
		query_text: string;
		tags?: string[] | null;
	}>;
	if (promptRowsError && isMissingColumn(promptRowsError)) {
		const fallbackRows = await client
			.from("prompt_queries")
			.select("id,query_text");
		promptRowsError = fallbackRows.error;
		promptRows = (
			(fallbackRows.data ?? []) as Array<{ id: string; query_text: string }>
		).map((row) => ({ ...row, tags: null }));
	}
	if (promptRowsError && !isMissingRelation(promptRowsError)) {
		throw asError(
			promptRowsError,
			"Failed to load prompt tags for time series",
		);
	}

	const tagsByPromptId = new Map<string, string[]>();
	for (const row of promptRows) {
		tagsByPromptId.set(row.id, normalizePromptTags(row.tags, row.query_text));
	}
	const shouldFilterByTags = selectedTagSet.size > 0 && tagsByPromptId.size > 0;

	const runResult = await client
		.from("mv_run_summary")
		.select("run_id,run_month,run_kind,cohort_tag,created_at,overall_score")
		.order("created_at", { ascending: true })
		.limit(500);

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return { ok: true, competitors, points: [] };
		}
		throw asError(
			runResult.error,
			"Failed to load mv_run_summary for time series",
		);
	}

	const runRows = (runResult.data ?? []) as Array<{
		run_id: string;
		run_month: string | null;
		created_at: string | null;
		overall_score: number | null;
	}>;
	if (runRows.length === 0) {
		return { ok: true, competitors, points: [] };
	}

	const mentionRows = await fetchMentionRateRowsByRunIds(
		runRows.map((row) => row.run_id),
		{ overallOnly: false },
	);

	const highchartsCompetitor =
		competitorRows.find((row) => row.is_primary) ??
		competitorRows.find((row) => row.slug === "highcharts") ??
		null;
	const rivals = competitorRows.filter(
		(row) => row.id !== highchartsCompetitor?.id,
	);

	const runBuckets = new Map<
		string,
		{
			queryTotals: Map<string, number>;
			mentionsByCompetitor: Map<string, number>;
		}
	>();

	for (const row of mentionRows) {
		const queryId = row.query_id;
		if (!queryId) continue;
		if (shouldFilterByTags) {
			const promptTags =
				tagsByPromptId.get(queryId) ?? inferPromptTags(row.query_text);
			if (!promptMatchesTagFilter(promptTags, selectedTagSet, tagFilterMode)) {
				continue;
			}
		}

		const bucket = runBuckets.get(row.run_id) ?? {
			queryTotals: new Map<string, number>(),
			mentionsByCompetitor: new Map<string, number>(),
		};
		if (!bucket.queryTotals.has(queryId)) {
			bucket.queryTotals.set(
				queryId,
				Math.max(0, Math.round(asNumber(row.response_count))),
			);
		}
		bucket.mentionsByCompetitor.set(
			row.competitor_id,
			(bucket.mentionsByCompetitor.get(row.competitor_id) ?? 0) +
				Math.max(0, Math.round(asNumber(row.mentions_count))),
		);
		runBuckets.set(row.run_id, bucket);
	}

	const points = runRows
		.map((run) => {
			const bucket = runBuckets.get(run.run_id);
			if (!bucket) return null;

			const total = [...bucket.queryTotals.values()].reduce(
				(sum, value) => sum + value,
				0,
			);
			if (total <= 0) return null;

			const rates = Object.fromEntries(
				competitorRows.map((competitor) => {
					const mentions = bucket.mentionsByCompetitor.get(competitor.id) ?? 0;
					const mentionRatePct = total > 0 ? (mentions / total) * 100 : 0;
					return [competitor.name, roundTo(mentionRatePct, 2)];
				}),
			);

			const highchartsMentions = highchartsCompetitor
				? (bucket.mentionsByCompetitor.get(highchartsCompetitor.id) ?? 0)
				: 0;
			const highchartsRatePct =
				total > 0 ? (highchartsMentions / total) * 100 : 0;
			const totalMentionsAcrossEntities = competitorRows.reduce(
				(sum, competitor) =>
					sum + (bucket.mentionsByCompetitor.get(competitor.id) ?? 0),
				0,
			);
			const highchartsSovPct =
				totalMentionsAcrossEntities > 0
					? (highchartsMentions / totalMentionsAcrossEntities) * 100
					: 0;
			const derivedAiVisibility =
				0.7 * highchartsRatePct + 0.3 * highchartsSovPct;
			const rivalMentionCount = rivals.reduce(
				(sum, competitor) =>
					sum + (bucket.mentionsByCompetitor.get(competitor.id) ?? 0),
				0,
			);
			const combviDenominator = total * rivals.length;
			const combviPct =
				combviDenominator > 0
					? (rivalMentionCount / combviDenominator) * 100
					: 0;
			const timestamp =
				run.created_at ??
				(run.run_month && /^\d{4}-\d{2}$/.test(run.run_month)
					? `${run.run_month}-01T12:00:00Z`
					: new Date().toISOString());
			const storedAiVisibility =
				selectedTagSet.size === 0 &&
				selectedProviderSet.size === 0 &&
				typeof run.overall_score === "number" &&
				Number.isFinite(run.overall_score)
					? run.overall_score
					: null;

			return {
				date: timestamp.slice(0, 10),
				timestamp,
				total,
				aiVisibilityScore: roundTo(
					storedAiVisibility ?? derivedAiVisibility,
					2,
				),
				combviPct: roundTo(combviPct, 2),
				rates,
			};
		})
		.filter((point): point is NonNullable<typeof point> => point !== null)
		.sort((left, right) => {
			const leftMs = Date.parse(left.timestamp ?? `${left.date}T12:00:00Z`);
			const rightMs = Date.parse(right.timestamp ?? `${right.date}T12:00:00Z`);
			return leftMs - rightMs;
		});

	return {
		ok: true,
		competitors,
		points,
	};
}

async function fetchTimeseriesFromSupabaseForServer(options = {}) {
	const selectedProviders = normalizeSelectedProviders(options.providers);
	if (selectedProviders.length > 0) {
		return fetchTimeseriesFromSupabaseTablesForServer(options);
	}
	return fetchTimeseriesFromSupabaseViewsForServer(options);
}

app.get(
	"/api/benchmark/runs",
	invokeServerlessHandler(benchmarkRunsHandler, { requireTriggerToken: true }),
);
app.post(
	"/api/benchmark/trigger",
	requireWriteAccess,
	invokeServerlessHandler(benchmarkTriggerHandler, {
		requireTriggerToken: true,
	}),
);
app.post(
	"/api/benchmark/stop",
	requireWriteAccess,
	invokeServerlessHandler(benchmarkStopHandler, { requireTriggerToken: true }),
);

app.get("/api/research/gaps", invokeServerlessHandler(researchGapListHandler));
app.get(
	"/api/research/prompt-cohorts",
	invokeServerlessHandler(researchPromptCohortsHandler),
);
app.get(
	"/api/research/prompt-cohorts/:id/progress",
	invokeServerlessHandler(researchPromptCohortProgressHandler, {
		paramIdToQuery: true,
	}),
);

app.post(
	"/api/research/competitors/run",
	requireWriteAccess,
	invokeServerlessHandler(researchCompetitorRunHandler, {
		requireTriggerToken: true,
	}),
);
app.post(
	"/api/research/sitemap/sync",
	requireWriteAccess,
	invokeServerlessHandler(researchSitemapSyncHandler, {
		requireTriggerToken: true,
	}),
);
app.post(
	"/api/research/gaps/refresh",
	requireWriteAccess,
	invokeServerlessHandler(researchGapRefreshHandler, {
		requireTriggerToken: true,
	}),
);
app.post(
	"/api/research/briefs/generate",
	requireWriteAccess,
	invokeServerlessHandler(researchBriefGenerateHandler, {
		requireTriggerToken: true,
	}),
);
app.patch(
	"/api/research/gaps/:id/status",
	requireWriteAccess,
	invokeServerlessHandler(researchGapStatusHandler, {
		requireTriggerToken: true,
		paramIdToQuery: true,
	}),
);
app.post(
	"/api/research/prompt-cohorts",
	requireWriteAccess,
	invokeServerlessHandler(researchPromptCohortsHandler, {
		requireTriggerToken: true,
	}),
);

app.get("/api/health", (_req, res) => {
	res.json({ ok: true, service: "apps-api", repoRoot });
});

app.get(["/api/config", "/api/config/benchmark"], async (_req, res) => {
	try {
		if (shouldUseSupabaseDashboardSource()) {
			try {
				const payload = await fetchConfigFromSupabaseForServer();
				res.json(payload);
				return;
			} catch (error) {
				console.warn(
					"[api.config] Supabase config load failed, using local config.",
					error,
				);
			}
		}

		const [config, stats] = await Promise.all([
			loadConfig(),
			fs.stat(configPath),
		]);
		res.json({
			config,
			meta: {
				source: "config/benchmark/config.json",
				updatedAt: stats.mtime.toISOString(),
				queries: config.queries.length,
				competitors: config.competitors.length,
			},
		});
	} catch (error) {
		sendApiError(res, 500, "Unable to load benchmark config.", error);
	}
});

app.put(
	["/api/config", "/api/config/benchmark"],
	requireWriteAccess,
	async (req, res) => {
		try {
			const parsed = configSchema.parse(req.body);
			const normalized = normalizeConfig(parsed);

			if (shouldUseSupabaseDashboardSource()) {
				try {
					const payload = await updateConfigInSupabaseForServer(normalized);
					res.json(payload);
					return;
				} catch (error) {
					console.warn(
						"[api.config] Supabase config update failed, using local file.",
						error,
					);
				}
			}

			await fs.writeFile(
				configPath,
				`${JSON.stringify(normalized, null, 2)}\n`,
				"utf8",
			);
			const stats = await fs.stat(configPath);
			res.json({
				config: normalized,
				meta: {
					source: "config/benchmark/config.json",
					updatedAt: stats.mtime.toISOString(),
				},
			});
		} catch (error) {
			if (error instanceof z.ZodError) {
				res.status(400).json({
					error: "Invalid config payload.",
					issues: error.issues,
				});
				return;
			}

			sendApiError(res, 500, "Could not save config.", error);
		}
	},
);

app.patch("/api/prompts/toggle", requireWriteAccess, async (req, res) => {
	try {
		const { query, active } = toggleSchema.parse(req.body);

		if (shouldUseSupabaseDashboardSource()) {
			try {
				await togglePromptInSupabaseForServer(query, active);
				res.json({ ok: true, query, active });
				return;
			} catch (error) {
				console.warn(
					"[api.prompts.toggle] Supabase toggle failed, using local file.",
					error,
				);
			}
		}

		const raw = await fs.readFile(configPath, "utf8");
		const config = JSON.parse(raw) as Record<string, unknown>;
		const paused = (config.pausedQueries as string[] | undefined) ?? [];
		const pausedQueries = active
			? paused.filter((q) => q !== query)
			: [...new Set([...paused, query])];
		await fs.writeFile(
			configPath,
			`${JSON.stringify({ ...config, pausedQueries }, null, 2)}\n`,
			"utf8",
		);
		res.json({ ok: true, query, active });
	} catch (error) {
		if (error instanceof z.ZodError) {
			res.status(400).json({ error: "Invalid payload.", issues: error.issues });
			return;
		}
		sendApiError(res, 500, "Failed to toggle prompt.", error);
	}
});

app.post(
	"/api/billing/create-portal-session",
	requireWriteAccess,
	async (req, res) => {
		try {
			const stripeKey = process.env.STRIPE_SECRET_KEY;
			if (!stripeKey) {
				res.status(400).json({
					error: "Stripe key not configured. Missing STRIPE_SECRET_KEY.",
				});
				return;
			}
			const { email, returnUrl } = req.body;
			if (!email) {
				res.status(400).json({ error: "Email is required." });
				return;
			}

			const { default: Stripe } = await import("stripe");
			const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" as any });

			const customers = await stripe.customers.list({ email, limit: 1 });
			let customerId = customers.data.length > 0 ? customers.data[0].id : null;

			if (!customerId) {
				const newCustomer = await stripe.customers.create({ email });
				customerId = newCustomer.id;
			}

			const session = await stripe.billingPortal.sessions.create({
				customer: customerId,
				return_url: returnUrl || req.headers.origin || "http://localhost:5173",
			});

			res.json({ url: session.url });
		} catch (error) {
			sendApiError(res, 500, "Failed to create Stripe portal session.", error);
		}
	},
);

app.post("/api/prompt-lab/run", invokeServerlessHandler(promptLabRunHandler));

app.post("/api/prompt-lab/chatgpt-web", async (req, res) => {
	try {
		const parsed = promptLabChatGptWebSchema.parse(req.body ?? {});
		const query = parsed.query.trim();
		if (!query) {
			res.status(400).json({ error: "query is required." });
			return;
		}

		const startedAt = Date.now();
		const result = await runChatGptWebPromptLabQuery({
			query,
			includeRawHtml: parsed.includeRawHtml === true,
		});

		res.json({
			ok: true,
			model: CHATGPT_WEB_MODEL,
			provider: "chatgpt-web",
			modelOwner: "OpenAI",
			webSearchEnabled: true,
			responseText: result.responseText,
			effectiveQuery: result.effectiveQuery,
			citationRefs: result.citationRefs,
			citations: result.citations,
			rawHtml: result.rawHtml,
			durationMs: Date.now() - startedAt,
			tokens: result.tokens,
			error: null,
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			res.status(400).json({ error: "Invalid payload.", issues: error.issues });
			return;
		}

		const httpError =
			typeof error === "object" && error !== null ? (error as HttpError) : null;
		const statusCode =
			httpError && Number(httpError.statusCode)
				? Number(httpError.statusCode)
				: 500;
		if (statusCode >= 500 && !httpError?.exposeMessage) {
			sendApiError(
				res,
				statusCode,
				"Prompt lab ChatGPT web run failed.",
				error,
			);
			return;
		}
		res
			.status(statusCode)
			.json({ error: error instanceof Error ? error.message : String(error) });
	}
});

app.get(
	["/api/under-the-hood", "/api/analytics/under-the-hood"],
	async (req, res) => {
		try {
			const range = normalizeUnderTheHoodRange(req.query.range);
			if (shouldUseSupabaseDashboardSource()) {
				try {
					const config = await loadConfig();
					const payload = await fetchUnderTheHoodFromSupabaseViewsForServer(
						config,
						range,
					);
					res.json(payload);
					return;
				} catch (error) {
					console.warn(
						"[api.under-the-hood] Supabase snapshot failed, using fixture snapshot.",
						error,
					);
				}
			}

			const nowMs = Date.now();
			const nowIso = new Date(nowMs).toISOString();
			const rangeStartMs = rangeStartMsForUnderTheHood(range, nowMs);
			const rangeStartUtc =
				rangeStartMs !== null ? new Date(rangeStartMs).toISOString() : null;

			const [config, jsonlRows] = await Promise.all([
				loadConfig(),
				readJsonl(dashboardFiles.jsonl),
			]);

			const filteredRows = jsonlRows.filter((row) => {
				if (rangeStartMs === null) return true;
				const rowTs =
					timestampMs(row.timestamp) ??
					timestampMs(row.created_at) ??
					timestampMs(row.run_created_at);
				if (rowTs === null) return false;
				return rowTs >= rangeStartMs && rowTs <= nowMs;
			});

			const inferredWindow = inferWindowFromJsonl(filteredRows);
			const runMonths = filteredRows
				.map((row) => String(row.run_month ?? "").trim())
				.filter(Boolean)
				.sort((a, b) => a.localeCompare(b));
			const latestRunMonth = runMonths.at(-1) ?? null;

			const webSearchStates = new Set(
				filteredRows.map((row) => isTruthyFlag(row.web_search_enabled)),
			);
			const webSearchEnabled =
				webSearchStates.size === 0
					? null
					: webSearchStates.size === 1
						? webSearchStates.has(true)
							? "yes"
							: "no"
						: "mixed";

			res.json({
				generatedAt: new Date().toISOString(),
				range,
				rangeLabel: rangeLabelForUnderTheHood(range),
				rangeStartUtc,
				rangeEndUtc: nowIso,
				summary: {
					overallScore: 0,
					queryCount: config.queries.length,
					competitorCount: config.competitors.length,
					totalResponses: filteredRows.length,
					models: inferredWindow.models,
					modelOwners: inferredWindow.modelOwners,
					modelOwnerMap: inferredWindow.modelOwnerMap,
					modelOwnerStats: inferredWindow.modelOwnerStats,
					modelStats: inferredWindow.modelStats,
					tokenTotals: inferredWindow.tokenTotals,
					durationTotals: inferredWindow.durationTotals,
					runMonth: latestRunMonth,
					webSearchEnabled,
					windowStartUtc: inferredWindow.start,
					windowEndUtc: inferredWindow.end,
				},
			});
		} catch (error) {
			sendApiError(res, 500, "Unable to build under-the-hood response.", error);
		}
	},
);

app.get("/api/run-costs", async (req, res) => {
	try {
		const parsedLimit = Number(req.query.limit);
		const limit = Number.isFinite(parsedLimit)
			? Math.max(1, Math.min(200, Math.round(parsedLimit)))
			: 30;

		if (shouldUseSupabaseDashboardSource()) {
			try {
				const payload = await fetchRunCostsFromSupabaseViewsForServer(limit);
				res.json(payload);
				return;
			} catch (error) {
				console.warn(
					"[api.run-costs] Supabase snapshot failed, using fixture snapshot.",
					error,
				);
			}
		}

		const jsonlRows = await readJsonl(dashboardFiles.jsonl);
		if (jsonlRows.length === 0) {
			res.json({
				generatedAt: new Date().toISOString(),
				runCount: 0,
				totals: {
					responseCount: 0,
					inputTokens: 0,
					outputTokens: 0,
					totalTokens: 0,
					estimatedInputCostUsd: 0,
					estimatedOutputCostUsd: 0,
					estimatedTotalCostUsd: 0,
				},
				runs: [],
			});
			return;
		}

		const buckets = new Map<
			string,
			{
				runId: string;
				runMonth: string | null;
				createdAt: string | null;
				startedAt: string | null;
				endedAt: string | null;
				webSearchValues: Set<boolean>;
				models: Set<string>;
				unpricedModels: Set<string>;
				responseCount: number;
				inputTokens: number;
				outputTokens: number;
				totalTokens: number;
				pricedResponseCount: number;
				estimatedInputCostUsd: number;
				estimatedOutputCostUsd: number;
				estimatedTotalCostUsd: number;
			}
		>();

		for (const row of jsonlRows) {
			const timestampRaw = String(
				row.timestamp ?? row.created_at ?? row.run_created_at ?? "",
			).trim();
			const runIdRaw = String(row.run_id ?? row.runId ?? "").trim();
			const runMonthRaw = String(row.run_month ?? "").trim();
			const runCreatedAtRaw = String(row.run_created_at ?? "").trim();
			const fallbackRunId =
				runMonthRaw && runCreatedAtRaw
					? `${runMonthRaw}-${runCreatedAtRaw}`
					: runCreatedAtRaw
						? `run-${runCreatedAtRaw}`
						: runMonthRaw && timestampRaw
							? `${runMonthRaw}-${timestampRaw.slice(0, 10)}`
							: timestampRaw
								? `run-${timestampRaw.slice(0, 10)}`
								: "run-unknown";
			const runId = runIdRaw || fallbackRunId;

			let bucket = buckets.get(runId);
			if (!bucket) {
				bucket = {
					runId,
					runMonth: runMonthRaw || null,
					createdAt: timestampRaw || null,
					startedAt: timestampRaw || null,
					endedAt: timestampRaw || null,
					webSearchValues: new Set<boolean>(),
					models: new Set<string>(),
					unpricedModels: new Set<string>(),
					responseCount: 0,
					inputTokens: 0,
					outputTokens: 0,
					totalTokens: 0,
					pricedResponseCount: 0,
					estimatedInputCostUsd: 0,
					estimatedOutputCostUsd: 0,
					estimatedTotalCostUsd: 0,
				};
				buckets.set(runId, bucket);
			}

			const modelName = String(row.model ?? "").trim();
			if (modelName) {
				bucket.models.add(modelName);
			}
			if (timestampRaw) {
				if (!bucket.createdAt || timestampRaw < bucket.createdAt)
					bucket.createdAt = timestampRaw;
				if (!bucket.startedAt || timestampRaw < bucket.startedAt)
					bucket.startedAt = timestampRaw;
				if (!bucket.endedAt || timestampRaw > bucket.endedAt)
					bucket.endedAt = timestampRaw;
			}

			bucket.webSearchValues.add(isTruthyFlag(row.web_search_enabled));

			const inputTokens = safeTokenInt(
				row.prompt_tokens ?? row.input_tokens ?? row.usage?.prompt_tokens,
			);
			const outputTokens = safeTokenInt(
				row.completion_tokens ??
					row.output_tokens ??
					row.usage?.completion_tokens,
			);
			const totalTokens =
				safeTokenInt(row.total_tokens ?? row.usage?.total_tokens) ||
				inputTokens + outputTokens;
			bucket.responseCount += 1;
			bucket.inputTokens += inputTokens;
			bucket.outputTokens += outputTokens;
			bucket.totalTokens += totalTokens;

			const costs = estimateResponseCostForServer(
				modelName,
				inputTokens,
				outputTokens,
			);
			bucket.estimatedInputCostUsd += costs.inputCostUsd;
			bucket.estimatedOutputCostUsd += costs.outputCostUsd;
			bucket.estimatedTotalCostUsd += costs.totalCostUsd;
			if (costs.priced) {
				bucket.pricedResponseCount += 1;
			} else if (modelName) {
				bucket.unpricedModels.add(modelName);
			}
		}

		const runs = [...buckets.values()]
			.map((bucket) => ({
				runId: bucket.runId,
				runMonth: bucket.runMonth,
				createdAt: bucket.createdAt,
				startedAt: bucket.startedAt,
				endedAt: bucket.endedAt,
				webSearchEnabled:
					bucket.webSearchValues.size === 1
						? bucket.webSearchValues.has(true)
						: bucket.webSearchValues.size === 0
							? null
							: null,
				responseCount: bucket.responseCount,
				models: [...bucket.models].sort((left, right) =>
					left.localeCompare(right),
				),
				inputTokens: bucket.inputTokens,
				outputTokens: bucket.outputTokens,
				totalTokens: bucket.totalTokens,
				pricedResponseCount: bucket.pricedResponseCount,
				unpricedModels: [...bucket.unpricedModels].sort((left, right) =>
					left.localeCompare(right),
				),
				estimatedInputCostUsd: Number(bucket.estimatedInputCostUsd.toFixed(6)),
				estimatedOutputCostUsd: Number(
					bucket.estimatedOutputCostUsd.toFixed(6),
				),
				estimatedTotalCostUsd: Number(bucket.estimatedTotalCostUsd.toFixed(6)),
			}))
			.sort((left, right) => {
				const leftMs = Date.parse(left.createdAt ?? "");
				const rightMs = Date.parse(right.createdAt ?? "");
				if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
					return rightMs - leftMs;
				}
				if (Number.isFinite(leftMs)) return -1;
				if (Number.isFinite(rightMs)) return 1;
				return right.runId.localeCompare(left.runId);
			})
			.slice(0, limit);

		const totals = runs.reduce(
			(sum, run) => {
				sum.responseCount += run.responseCount;
				sum.inputTokens += run.inputTokens;
				sum.outputTokens += run.outputTokens;
				sum.totalTokens += run.totalTokens;
				sum.estimatedInputCostUsd += run.estimatedInputCostUsd;
				sum.estimatedOutputCostUsd += run.estimatedOutputCostUsd;
				sum.estimatedTotalCostUsd += run.estimatedTotalCostUsd;
				return sum;
			},
			{
				responseCount: 0,
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				estimatedInputCostUsd: 0,
				estimatedOutputCostUsd: 0,
				estimatedTotalCostUsd: 0,
			},
		);

		res.json({
			generatedAt: new Date().toISOString(),
			runCount: runs.length,
			totals: {
				responseCount: totals.responseCount,
				inputTokens: totals.inputTokens,
				outputTokens: totals.outputTokens,
				totalTokens: totals.totalTokens,
				estimatedInputCostUsd: Number(totals.estimatedInputCostUsd.toFixed(6)),
				estimatedOutputCostUsd: Number(
					totals.estimatedOutputCostUsd.toFixed(6),
				),
				estimatedTotalCostUsd: Number(totals.estimatedTotalCostUsd.toFixed(6)),
			},
			runs,
		});
	} catch (error) {
		sendApiError(res, 500, "Unable to build run-costs response.", error);
	}
});

app.get(["/api/dashboard", "/api/analytics/dashboard"], async (req, res) => {
	try {
		const promptDetail =
			String(req.query.prompt_detail ?? "full").toLowerCase() === "summary"
				? "summary"
				: "full";
		const config = await loadConfig();
		if (shouldUseSupabaseDashboardSource()) {
			try {
				const selectedProviders = normalizeSelectedProviders(req.query.providers);
				const payload =
					selectedProviders.length > 0
						? await fetchDashboardFromSupabaseTablesForServer(config, {
								providers: selectedProviders,
							})
						: await fetchDashboardFromSupabaseViewsForServer(config);
				res.json(
					promptDetail === "summary"
						? toDashboardOverviewPayload(payload)
						: payload,
				);
				return;
			} catch (error) {
				console.warn(
					"[api.dashboard] Supabase snapshot failed, using fixture snapshot.",
					error,
				);
			}
		}

		const [comparisonRows, competitorRows, kpiRows, jsonlRows] =
			await Promise.all([
				readCsv(dashboardFiles.comparison),
				readCsv(dashboardFiles.competitorChart),
				readCsv(dashboardFiles.kpi),
				readJsonl(dashboardFiles.jsonl),
			]);

		const overallRow =
			comparisonRows.find((row) => row.query === "OVERALL") ?? null;
		const queryRows = comparisonRows.filter((row) => row.query !== "OVERALL");
		const kpi = kpiRows[0] ?? null;

		const inferredWindow = inferWindowFromJsonl(jsonlRows);
		const entityKeys = overallRow
			? Object.keys(overallRow)
					.filter((column) => column.endsWith("_rate"))
					.map((column) => column.replace(/_rate$/, ""))
					.filter((key) => !key.startsWith("viability_index"))
					.filter((key) => key !== "our_brand")
			: config.competitors.map(slugifyEntity);

		const overallCompetitorRows = competitorRows.filter(
			(row) => asYesNo(row.is_overall_row) === "yes",
		);

		const competitorSeries =
			overallCompetitorRows.length > 0
				? overallCompetitorRows.map((row) => ({
						entity: row.entity,
						entityKey: row.entity_key,
						isHighcharts: asYesNo(row.is_highcharts) === "yes",
						mentionRatePct: Number(
							(asNumber(row.mentions_rate) * 100).toFixed(2),
						),
						shareOfVoicePct: Number(
							(
								asNumber(row.share_of_voice_rate_pct) ||
								asNumber(row.share_of_voice_rate) * 100
							).toFixed(2),
						),
					}))
				: entityKeys.map((entityKey) => ({
						entity:
							config.competitors.find(
								(name) => slugifyEntity(name) === entityKey,
							) ?? entityKey,
						entityKey,
						isHighcharts: entityKey === "highcharts",
						mentionRatePct: Number(
							(asNumber(overallRow?.[`${entityKey}_rate`]) * 100).toFixed(2),
						),
						shareOfVoicePct: 0,
					}));

		const promptLookup = new Map(queryRows.map((row) => [row.query, row]));
		// JSONL artifacts are rewritten per benchmark run, so the full file is the active snapshot.
		const latestRunRows = jsonlRows;

		const responsesByQueryKey = new Map<
			string,
			Array<Record<string, unknown>>
		>();
		for (const row of latestRunRows) {
			const queryText = String(
				row.query ?? row.query_text ?? row.prompt ?? row.prompt_text ?? "",
			).trim();
			if (!queryText) continue;
			const key = queryText.toLowerCase();
			const bucket = responsesByQueryKey.get(key) ?? [];
			bucket.push(row);
			responsesByQueryKey.set(key, bucket);
		}
		const queryTags = normalizeQueryTagsMap(config.queries, config.queryTags);

		const pausedSet = new Set(config.pausedQueries ?? []);
		const promptStatus = config.queries.map((query) => {
			const row = promptLookup.get(query);
			const queryResponses =
				responsesByQueryKey.get(query.trim().toLowerCase()) ?? [];
			const latestRunResponseCount = row
				? Math.max(0, Math.round(asNumber(row.runs)))
				: 0;
			const latestInputTokens = queryResponses.reduce(
				(sum, responseRow) =>
					sum +
					safeTokenInt(
						responseRow.prompt_tokens ??
							responseRow.input_tokens ??
							responseRow.usage?.prompt_tokens,
					),
				0,
			);
			const latestOutputTokens = queryResponses.reduce(
				(sum, responseRow) =>
					sum +
					safeTokenInt(
						responseRow.completion_tokens ??
							responseRow.output_tokens ??
							responseRow.usage?.completion_tokens,
					),
				0,
			);
			const latestTotalTokens = queryResponses.reduce((sum, responseRow) => {
				const inputTokens = safeTokenInt(
					responseRow.prompt_tokens ??
						responseRow.input_tokens ??
						responseRow.usage?.prompt_tokens,
				);
				const outputTokens = safeTokenInt(
					responseRow.completion_tokens ??
						responseRow.output_tokens ??
						responseRow.usage?.completion_tokens,
				);
				const totalTokens =
					safeTokenInt(
						responseRow.total_tokens ?? responseRow.usage?.total_tokens,
					) || inputTokens + outputTokens;
				return sum + totalTokens;
			}, 0);
			const promptCostTotals = queryResponses.reduce(
				(totals, responseRow) => {
					const modelName = String(responseRow.model ?? "");
					const inputTokens = safeTokenInt(
						responseRow.prompt_tokens ??
							responseRow.input_tokens ??
							responseRow.usage?.prompt_tokens,
					);
					const outputTokens = safeTokenInt(
						responseRow.completion_tokens ??
							responseRow.output_tokens ??
							responseRow.usage?.completion_tokens,
					);
					const costs = estimateResponseCostForServer(
						modelName,
						inputTokens,
						outputTokens,
					);
					totals.inputCostUsd += costs.inputCostUsd;
					totals.outputCostUsd += costs.outputCostUsd;
					totals.totalCostUsd += costs.totalCostUsd;
					if (costs.priced) {
						totals.pricedResponses += 1;
					}
					return totals;
				},
				{
					inputCostUsd: 0,
					outputCostUsd: 0,
					totalCostUsd: 0,
					pricedResponses: 0,
				},
			);

			const competitorRatesAll = config.competitors.map((name) => {
				const entityKey = slugifyEntity(name);
				return {
					entity: name,
					entityKey,
					isHighcharts: name.toLowerCase() === "highcharts",
					mentions: Math.max(
						0,
						Math.round(asNumber(row?.[`${entityKey}_count`])),
					),
					ratePct: Number(
						(asNumber(row?.[`${entityKey}_rate`]) * 100).toFixed(2),
					),
				};
			});

			const highchartsRatePct =
				competitorRatesAll.find((entry) => entry.isHighcharts)?.ratePct ?? 0;
			const competitorRates = competitorRatesAll.filter(
				(entry) => !entry.isHighcharts,
			);
			const highchartsRank =
				row && latestRunResponseCount > 0
					? competitorRatesAll
							.slice()
							.sort((a, b) => {
								if (b.ratePct !== a.ratePct) {
									return b.ratePct - a.ratePct;
								}
								return a.entity.localeCompare(b.entity);
							})
							.findIndex((entry) => entry.isHighcharts) + 1
					: null;
			const topCompetitor =
				competitorRates
					.slice()
					.sort((a, b) => b.ratePct - a.ratePct)
					.at(0) ?? null;
			const rivalMentionCount = competitorRates.reduce(
				(sum, entry) => sum + entry.mentions,
				0,
			);
			const viabilityDenominator =
				latestRunResponseCount * competitorRates.length;
			const viabilityRatePct =
				viabilityDenominator > 0
					? (rivalMentionCount / viabilityDenominator) * 100
					: 0;

			return {
				query,
				tags: queryTags[query] ?? inferPromptTags(query),
				isPaused: pausedSet.has(query),
				status: row ? "tracked" : "awaiting_run",
				runs: asNumber(row?.runs),
				highchartsRatePct,
				highchartsRank:
					highchartsRank && highchartsRank > 0 ? highchartsRank : null,
				highchartsRankOutOf: config.competitors.length,
				viabilityRatePct: Number(viabilityRatePct.toFixed(2)),
				topCompetitor,
				latestRunResponseCount,
				latestInputTokens,
				latestOutputTokens,
				latestTotalTokens,
				estimatedInputCostUsd: Number(promptCostTotals.inputCostUsd.toFixed(6)),
				estimatedOutputCostUsd: Number(
					promptCostTotals.outputCostUsd.toFixed(6),
				),
				estimatedTotalCostUsd: Number(promptCostTotals.totalCostUsd.toFixed(6)),
				estimatedAvgCostPerResponseUsd:
					promptCostTotals.pricedResponses > 0
						? Number(
								(
									promptCostTotals.totalCostUsd /
									promptCostTotals.pricedResponses
								).toFixed(6),
							)
						: 0,
				competitorRates: competitorRatesAll.map((entry) => ({
					entity: entry.entity,
					entityKey: entry.entityKey,
					isHighcharts: entry.isHighcharts,
					ratePct: entry.ratePct,
					mentions: entry.mentions,
				})),
			};
		});

		const models = kpi
			? splitCsvish(String(kpi.models ?? ""))
			: inferredWindow.models;
		const parsedModelOwners = kpi
			? splitCsvish(String(kpi.model_owners ?? ""))
			: [];
		const fallbackModelOwnerMap = Object.fromEntries(
			models.map((modelName) => [
				modelName,
				inferModelOwnerFromModel(modelName),
			]),
		);
		const modelOwnerMap =
			kpi && String(kpi.model_owner_map ?? "").trim()
				? parseModelOwnerMap(String(kpi.model_owner_map ?? ""))
				: Object.keys(inferredWindow.modelOwnerMap).length > 0
					? inferredWindow.modelOwnerMap
					: fallbackModelOwnerMap;
		const modelOwners =
			parsedModelOwners.length > 0
				? parsedModelOwners
				: inferredWindow.modelOwners.length > 0
					? inferredWindow.modelOwners
					: [...new Set(Object.values(modelOwnerMap))].sort((a, b) =>
							a.localeCompare(b),
						);
		const windowStartUtc = kpi?.window_start_utc ?? inferredWindow.start;
		const windowEndUtc = kpi?.window_end_utc ?? inferredWindow.end;
		const tokenTotals = inferredWindow.tokenTotals;
		const durationTotals = inferredWindow.durationTotals;
		const modelStats = inferredWindow.modelStats;

		const payload = {
			generatedAt: new Date().toISOString(),
			summary: {
				overallScore: Number(
					asNumber(kpi?.ai_visibility_overall_score).toFixed(2),
				),
				queryCount: config.queries.length,
				competitorCount: config.competitors.length,
				totalResponses: jsonlRows.length,
				models,
				modelOwners,
				modelOwnerMap,
				modelOwnerStats: inferredWindow.modelOwnerStats,
				modelStats,
				tokenTotals,
				durationTotals,
				runMonth: kpi?.run_month ?? null,
				webSearchEnabled: kpi?.web_search_enabled ?? null,
				windowStartUtc,
				windowEndUtc,
			},
			kpi,
			competitorSeries,
			promptStatus,
			comparisonRows: queryRows,
			files: {
				comparisonTablePresent: comparisonRows.length > 0,
				competitorChartPresent: competitorRows.length > 0,
				kpiPresent: kpi !== null,
				llmOutputsPresent: jsonlRows.length > 0,
			},
		};
		res.json(
			promptDetail === "summary"
				? toDashboardOverviewPayload(payload)
				: payload,
		);
	} catch (error) {
		sendApiError(res, 500, "Unable to build dashboard response.", error);
	}
});

app.get(["/api/timeseries", "/api/analytics/timeseries"], async (req, res) => {
		try {
			const selectedTags = normalizeSelectedTags(req.query.tags);
			const selectedProviders = normalizeSelectedProviders(req.query.providers);
			const tagFilterMode: "any" | "all" =
				String(req.query.mode ?? "any").toLowerCase() === "all" ? "all" : "any";

			if (shouldUseSupabaseDashboardSource()) {
				try {
					const payload = await fetchTimeseriesFromSupabaseForServer({
						tags: selectedTags,
						mode: tagFilterMode,
						providers: selectedProviders,
					});
					res.json(payload);
					return;
				} catch (error) {
					console.warn(
						"[api.timeseries] Supabase snapshot failed, using fixture snapshot.",
						error,
					);
				}
			}

		const [config, jsonlRows] = await Promise.all([
			loadConfig(),
			readJsonl(dashboardFiles.jsonl),
		]);

		const selectedTagSet = new Set(selectedTags);
		const shouldFilterByTags = selectedTagSet.size > 0;
		const queryTags = normalizeQueryTagsMap(config.queries, config.queryTags);
		const tagsByQuery = new Map(
			Object.entries(queryTags).map(([query, tags]) => [
				query.trim().toLowerCase(),
				tags,
			]),
		);

		if (jsonlRows.length === 0) {
			res.json({ ok: true, competitors: config.competitors, points: [] });
			return;
		}

		// Build per-competitor alias patterns (lowercase)
		const competitorPatterns = config.competitors.map((name) => ({
			name,
			patterns: uniqueNonEmpty([name, ...(config.aliases[name] ?? [])]).map(
				(a) => a.toLowerCase(),
			),
			mentionKeys: uniqueNonEmpty([slugifyEntity(name)]),
		}));

		type DayBucket = { total: number; mentions: Record<string, number> };
		const byDate = new Map<string, DayBucket>();

		for (const row of jsonlRows) {
			if (shouldFilterByTags) {
				const queryText = String(
					row.query ?? row.query_text ?? row.prompt ?? row.prompt_text ?? "",
				).trim();
				if (!queryText) {
					continue;
				}

				const promptTags =
					tagsByQuery.get(queryText.toLowerCase()) ??
					inferPromptTags(queryText);
				if (
					!promptMatchesTagFilter(promptTags, selectedTagSet, tagFilterMode)
				) {
					continue;
				}
			}

			const ts = String(row.timestamp ?? "");
			const date = ts.length >= 10 ? ts.slice(0, 10) : null;
			if (!date) continue;

			const mentionMap =
				typeof row.mentions === "object" &&
				row.mentions !== null &&
				!Array.isArray(row.mentions)
					? (row.mentions as Record<string, unknown>)
					: null;

			// Try various field names for the raw LLM response text
			const responseText = String(
				row.response_text ??
					row.response ??
					row.text ??
					row.content ??
					row.completion ??
					row.output ??
					"",
			).toLowerCase();

			const entry = byDate.get(date) ?? { total: 0, mentions: {} };
			entry.total++;

			for (const { name, patterns, mentionKeys } of competitorPatterns) {
				const mentionedFromMap = mentionMap
					? mentionKeys.some((key) => isTruthyFlag(mentionMap[key]))
					: false;
				const mentionedFromText = patterns.some((p) =>
					responseText.includes(p),
				);
				if (mentionedFromMap || (!mentionMap && mentionedFromText)) {
					entry.mentions[name] = (entry.mentions[name] ?? 0) + 1;
				}
			}

			byDate.set(date, entry);
		}

		const points = Array.from(byDate.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, { total, mentions }]) => ({
				date,
				total,
				rates: Object.fromEntries(
					config.competitors.map((name) => [
						name,
						total > 0
							? Number((((mentions[name] ?? 0) / total) * 100).toFixed(2))
							: 0,
					]),
				),
			}));

		res.json({ ok: true, competitors: config.competitors, points });
	} catch (error) {
		sendApiError(res, 500, "Failed to build time series.", error);
	}
});

app.get("/api/research/competitor-blogs", async (req, res) => {
	try {
		const client = requireSupabaseClient();
		const limit = Math.max(
			1,
			Math.min(Number(req.query.limit ?? 500) || 500, 1000),
		);
		const result = await client
			.from("competitor_blog_posts")
			.select(
				"id,source,source_slug,title,content_theme,description,author,link,publish_date,published_at,created_at",
			)
			.order("publish_date", { ascending: false, nullsFirst: false })
			.order("published_at", { ascending: false, nullsFirst: false })
			.order("created_at", { ascending: false })
			.limit(limit);

		if (result.error) {
			if (isMissingRelation(result.error)) {
				res.json({
					generatedAt: new Date().toISOString(),
					totalPosts: 0,
					sourceTotals: [],
					typeTotals: [],
					posts: [],
					timeline: [],
				});
				return;
			}
			throw asError(
				result.error,
				"Failed to load competitor_blog_posts from Supabase",
			);
		}

		const posts = ((result.data ?? []) as Array<Record<string, unknown>>)
			.filter(
				(row) =>
					String(row.title ?? "").trim() && String(row.link ?? "").trim(),
			)
			.map((row) => {
				const source = String(row.source ?? "").trim() || "Unknown";
				const sourceKey =
					String(row.source_slug ?? "").trim() ||
					slugifyEntity(source) ||
					"unknown";
				const type = String(row.content_theme ?? "").trim() || "General";
				const publishDate = String(row.publish_date ?? "").trim() || null;
				const publishedAt = String(row.published_at ?? "").trim() || null;
				return {
					id: String(row.id ?? ""),
					title: String(row.title ?? "").trim(),
					type,
					source,
					sourceKey,
					description: String(row.description ?? "").trim(),
					author: String(row.author ?? "").trim() || null,
					link: String(row.link ?? "").trim(),
					publishDate,
					publishedAt,
				};
			});

		const sourceTotals = new Map<
			string,
			{ source: string; sourceKey: string; count: number }
		>();
		const typeTotals = new Map<string, number>();
		const timelineBuckets = new Map<
			string,
			{ total: number; bySource: Map<string, number> }
		>();

		for (const post of posts) {
			const sourceEntry = sourceTotals.get(post.sourceKey);
			if (sourceEntry) {
				sourceEntry.count += 1;
			} else {
				sourceTotals.set(post.sourceKey, {
					source: post.source,
					sourceKey: post.sourceKey,
					count: 1,
				});
			}

			typeTotals.set(post.type, (typeTotals.get(post.type) ?? 0) + 1);

			const monthKey = monthKeyFromDate(post.publishDate ?? post.publishedAt);
			if (!monthKey) continue;

			const monthBucket = timelineBuckets.get(monthKey) ?? {
				total: 0,
				bySource: new Map<string, number>(),
			};
			monthBucket.total += 1;
			monthBucket.bySource.set(
				post.source,
				(monthBucket.bySource.get(post.source) ?? 0) + 1,
			);
			timelineBuckets.set(monthKey, monthBucket);
		}

		const sortedSourceTotals = [...sourceTotals.values()].sort(
			(left, right) => {
				if (right.count !== left.count) return right.count - left.count;
				return left.source.localeCompare(right.source);
			},
		);
		const sourceOrder = sortedSourceTotals.map((entry) => entry.source);
		const timeline = [...timelineBuckets.entries()]
			.sort(([leftMonth], [rightMonth]) => leftMonth.localeCompare(rightMonth))
			.map(([month, bucket]) => {
				const bySource: Record<string, number> = {};
				for (const source of sourceOrder) {
					bySource[source] = bucket.bySource.get(source) ?? 0;
				}
				return {
					month,
					label: formatMonthLabel(month),
					total: bucket.total,
					bySource,
				};
			});

		res.json({
			generatedAt: new Date().toISOString(),
			totalPosts: posts.length,
			sourceTotals: sortedSourceTotals,
			typeTotals: [...typeTotals.entries()]
				.map(([type, count]) => ({ type, count }))
				.sort(
					(left, right) =>
						right.count - left.count || left.type.localeCompare(right.type),
				),
			posts,
			timeline,
		});
	} catch (error) {
		const message = String(
			error instanceof Error ? error.message : error ?? "",
		).toLowerCase();
		if (
			message.includes("fetch failed") ||
			message.includes("failed to fetch") ||
			message.includes("supabase is not configured") ||
			message.includes("missing supabase env config") ||
			message.includes("enotfound") ||
			message.includes("econnrefused")
		) {
			res.json({
				generatedAt: new Date().toISOString(),
				totalPosts: 0,
				sourceTotals: [],
				typeTotals: [],
				posts: [],
				timeline: [],
			});
			return;
		}
		sendApiError(res, 500, "Failed to load competitor blogs.", error);
	}
});

app.get(
	["/api/prompts/drilldown", "/api/benchmark/prompt-drilldown"],
	async (req, res) => {
		try {
			const client = requireSupabaseClient();
			const queryText = String(req.query.query ?? "").trim();
			if (!queryText) {
				res.status(400).json({ error: "Prompt query is required." });
				return;
			}

			const promptResult = await client
				.from("prompt_queries")
				.select("id,query_text,sort_order,is_active,created_at,updated_at")
				.eq("query_text", queryText)
				.limit(1);

			if (promptResult.error) {
				throw asError(promptResult.error, "Failed to load prompt details");
			}

			const prompt = ((promptResult.data ?? [])[0] ?? null) as Record<
				string,
				unknown
			> | null;
			if (!prompt) {
				res.status(404).json({ error: `Prompt not found: ${queryText}` });
				return;
			}

			const competitorResult = await client
				.from("competitors")
				.select("id,name,slug,is_primary,sort_order,is_active")
				.order("sort_order", { ascending: true });

			if (competitorResult.error) {
				throw asError(
					competitorResult.error,
					"Failed to load competitors for prompt drilldown",
				);
			}

			const competitors = (competitorResult.data ?? []) as Array<
				Record<string, unknown>
			>;
			const responseResultWithStats = await client
				.from("benchmark_responses")
				.select(
					"id,run_id,run_iteration,model,provider,model_owner,web_search_enabled,response_text,citations,error,created_at,duration_ms,prompt_tokens,completion_tokens,total_tokens",
				)
				.eq("query_id", String(prompt.id ?? ""))
				.order("created_at", { ascending: false })
				.limit(500);

			let responseRowsError = responseResultWithStats.error;
			let responses = (responseResultWithStats.data ?? []) as Array<
				Record<string, unknown>
			>;
			if (responseRowsError && isMissingColumn(responseRowsError)) {
				const responseResultFallback = await client
					.from("benchmark_responses")
					.select(
						"id,run_id,run_iteration,model,web_search_enabled,response_text,citations,error,created_at",
					)
					.eq("query_id", String(prompt.id ?? ""))
					.order("created_at", { ascending: false })
					.limit(500);
				responseRowsError = responseResultFallback.error;
				responses = (
					(responseResultFallback.data ?? []) as Array<Record<string, unknown>>
				).map((row) => ({
					...row,
					provider: null,
					model_owner: null,
					duration_ms: 0,
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				}));
			}

			if (responseRowsError) {
				if (isMissingRelation(responseRowsError)) {
					res.json({
						generatedAt: new Date().toISOString(),
						prompt: {
							id: String(prompt.id ?? ""),
							query: String(prompt.query_text ?? ""),
							sortOrder: Number(prompt.sort_order ?? 0),
							isPaused: !prompt.is_active,
							createdAt: String(prompt.created_at ?? "") || null,
							updatedAt: String(prompt.updated_at ?? "") || null,
						},
						summary: {
							totalResponses: 0,
							trackedRuns: 0,
							highchartsRatePct: 0,
							viabilityRatePct: 0,
							leadPct: 0,
							topCompetitor: null,
							lastRunAt: null,
						},
						competitors: [],
						runPoints: [],
						responses: [],
					});
					return;
				}
				throw asError(responseRowsError, "Failed to load prompt responses");
			}

			const responseIds = responses
				.map((row) => Number(row.id ?? 0))
				.filter((id) => id > 0);
			const runIds = [
				...new Set(
					responses.map((row) => String(row.run_id ?? "")).filter(Boolean),
				),
			];
			const runRows: Array<Record<string, unknown>> = [];
			if (runIds.length > 0) {
				const runResult = await client
					.from("benchmark_runs")
					.select(
						"id,run_month,model,web_search_enabled,started_at,ended_at,overall_score,created_at",
					)
					.in("id", runIds);
				if (runResult.error) {
					if (!isMissingRelation(runResult.error)) {
						throw asError(
							runResult.error,
							"Failed to load benchmark runs for prompt drilldown",
						);
					}
				} else {
					runRows.push(
						...((runResult.data ?? []) as Array<Record<string, unknown>>),
					);
				}
			}

			const mentionRows: Array<{
				response_id: number;
				competitor_id: string;
				mentioned: boolean;
			}> = [];
			if (responseIds.length > 0) {
				let mentionsTableMissing = false;
				for (let index = 0; index < responseIds.length; index += 500) {
					if (mentionsTableMissing) break;
					const chunk = responseIds.slice(index, index + 500);
					let mentionOffset = 0;
					while (true) {
						const mentionResult = await client
							.from("response_mentions")
							.select("response_id,competitor_id,mentioned")
							.in("response_id", chunk)
							.order("response_id", { ascending: true })
							.order("competitor_id", { ascending: true })
							.range(mentionOffset, mentionOffset + SUPABASE_PAGE_SIZE - 1);

						if (mentionResult.error) {
							if (isMissingRelation(mentionResult.error)) {
								mentionsTableMissing = true;
								break;
							}
							throw asError(
								mentionResult.error,
								"Failed to load prompt mentions",
							);
						}

						const pageRows = (mentionResult.data ?? []) as Array<{
							response_id: number;
							competitor_id: string;
							mentioned: boolean;
						}>;
						if (pageRows.length === 0) break;
						mentionRows.push(...pageRows);
						mentionOffset += pageRows.length;
						if (pageRows.length < SUPABASE_PAGE_SIZE) break;
					}
				}
			}

			const runById = new Map(
				runRows.map((row) => [String(row.id ?? ""), row]),
			);
			const competitorById = new Map(
				competitors.map((row) => [String(row.id ?? ""), row]),
			);
			const mentionsByResponse = new Map<number, Set<string>>();
			for (const mention of mentionRows) {
				if (!mention.mentioned) continue;
				const bucket =
					mentionsByResponse.get(mention.response_id) ?? new Set<string>();
				bucket.add(mention.competitor_id);
				mentionsByResponse.set(mention.response_id, bucket);
			}

			const mentionCountByCompetitor = new Map<string, number>();
			for (const responseId of responseIds) {
				const mentionSet = mentionsByResponse.get(responseId);
				if (!mentionSet) continue;
				for (const competitorId of mentionSet) {
					mentionCountByCompetitor.set(
						competitorId,
						(mentionCountByCompetitor.get(competitorId) ?? 0) + 1,
					);
				}
			}

			const visibleCompetitors = competitors.filter(
				(row) =>
					Boolean(row.is_active) ||
					mentionCountByCompetitor.has(String(row.id ?? "")),
			);
			const primaryCompetitor =
				visibleCompetitors.find((row) => Boolean(row.is_primary)) ??
				visibleCompetitors.find(
					(row) => String(row.slug ?? "") === "highcharts",
				) ??
				null;

			const totalResponses = responses.length;
			const competitorStats = visibleCompetitors.map((competitor) => {
				const mentionCount =
					mentionCountByCompetitor.get(String(competitor.id ?? "")) ?? 0;
				const mentionRatePct =
					totalResponses > 0 ? (mentionCount / totalResponses) * 100 : 0;
				const isHighcharts = primaryCompetitor
					? String(competitor.id ?? "") === String(primaryCompetitor.id ?? "")
					: String(competitor.slug ?? "") === "highcharts";
				return {
					id: String(competitor.id ?? ""),
					entity: String(competitor.name ?? ""),
					entityKey: String(competitor.slug ?? ""),
					isHighcharts,
					isActive: Boolean(competitor.is_active),
					mentionCount,
					mentionRatePct: Number(mentionRatePct.toFixed(2)),
				};
			});

			const rivalStats = competitorStats.filter((entry) => !entry.isHighcharts);
			const topCompetitor =
				totalResponses > 0
					? (rivalStats
							.slice()
							.sort((left, right) => right.mentionRatePct - left.mentionRatePct)
							.map((entry) => ({
								entity: entry.entity,
								ratePct: Number(entry.mentionRatePct.toFixed(2)),
							}))
							.at(0) ?? null)
					: null;
			const highchartsRatePct =
				competitorStats.find((entry) => entry.isHighcharts)?.mentionRatePct ??
				0;
			const rivalMentionCount = rivalStats.reduce(
				(sum, row) => sum + row.mentionCount,
				0,
			);
			const viabilityDenominator = totalResponses * rivalStats.length;
			const viabilityRatePct =
				viabilityDenominator > 0
					? Number(
							((rivalMentionCount / viabilityDenominator) * 100).toFixed(2),
						)
					: 0;

			const responsesByRun = new Map<string, Array<Record<string, unknown>>>();
			for (const response of responses) {
				const runId = String(response.run_id ?? "");
				const bucket = responsesByRun.get(runId) ?? [];
				bucket.push(response);
				responsesByRun.set(runId, bucket);
			}

			const runPoints = Array.from(responsesByRun.entries())
				.map(([runId, runResponses]) => {
					const run = runById.get(runId);
					const mentionCountByCompetitorForRun = new Map<string, number>();

					for (const response of runResponses) {
						const mentionSet = mentionsByResponse.get(Number(response.id ?? 0));
						if (!mentionSet) continue;
						for (const competitorId of mentionSet) {
							mentionCountByCompetitorForRun.set(
								competitorId,
								(mentionCountByCompetitorForRun.get(competitorId) ?? 0) + 1,
							);
						}
					}

					const runTotal = runResponses.length;
					const rates = Object.fromEntries(
						competitorStats.map((competitor) => {
							const mentions =
								mentionCountByCompetitorForRun.get(
									String(competitor.id ?? ""),
								) ?? 0;
							const pct = runTotal > 0 ? (mentions / runTotal) * 100 : 0;
							return [competitor.entity, Number(pct.toFixed(2))];
						}),
					);

					const runHighchartsCount = primaryCompetitor
						? (mentionCountByCompetitorForRun.get(
								String(primaryCompetitor.id ?? ""),
							) ?? 0)
						: 0;
					const runHighchartsRate =
						runTotal > 0 ? (runHighchartsCount / runTotal) * 100 : 0;
					const runRivals = competitorStats.filter(
						(competitor) => !competitor.isHighcharts,
					);
					const runRivalMentionCount = runRivals.reduce(
						(sum, competitor) =>
							sum +
							(mentionCountByCompetitorForRun.get(
								String(competitor.id ?? ""),
							) ?? 0),
						0,
					);
					const runViabilityDenominator = runTotal * runRivals.length;
					const runViabilityRate =
						runViabilityDenominator > 0
							? (runRivalMentionCount / runViabilityDenominator) * 100
							: 0;
					const runTopCompetitor =
						runRivals
							.map((competitor) => {
								const mentions =
									mentionCountByCompetitorForRun.get(
										String(competitor.id ?? ""),
									) ?? 0;
								const ratePct = runTotal > 0 ? (mentions / runTotal) * 100 : 0;
								return {
									entity: competitor.entity,
									ratePct: Number(ratePct.toFixed(2)),
								};
							})
							.sort((left, right) => right.ratePct - left.ratePct)
							.at(0) ?? null;

					const firstResponseTimestamp = runResponses
						.map((response) => String(response.created_at ?? ""))
						.find((value) => Boolean(pickTimestamp(value)));
					const fallbackRunMonthTimestamp =
						run?.run_month && /^\d{4}-\d{2}$/.test(String(run.run_month))
							? `${String(run.run_month)}-01T12:00:00Z`
							: null;
					const timestamp =
						pickTimestamp(
							String(run?.created_at ?? ""),
							String(run?.started_at ?? ""),
							firstResponseTimestamp,
							fallbackRunMonthTimestamp,
						) ?? new Date().toISOString();

					return {
						runId,
						runMonth: String(run?.run_month ?? "") || null,
						timestamp,
						date: timestamp.slice(0, 10),
						totalResponses: runTotal,
						highchartsRatePct: Number(runHighchartsRate.toFixed(2)),
						viabilityRatePct: Number(runViabilityRate.toFixed(2)),
						topCompetitor: runTopCompetitor,
						rates,
					};
				})
				.sort(
					(left, right) =>
						Date.parse(left.timestamp) - Date.parse(right.timestamp),
				);

			const responseItems = responses.map((response) => {
				const run = runById.get(String(response.run_id ?? ""));
				const mentionIds = [
					...(mentionsByResponse.get(Number(response.id ?? 0)) ??
						new Set<string>()),
				];
				const mentions = mentionIds
					.map((id) => String(competitorById.get(id)?.name ?? ""))
					.filter(Boolean)
					.sort((left, right) => left.localeCompare(right));
				const citationProvider = normalizeCitationProvider(
					response.provider ?? response.model_owner ?? response.model,
					"openai",
				);
				const citationRefs = normalizeCitationRefs(
					response.citations,
					citationProvider,
				);
				const citations = normalizeCitations(citationRefs, citationProvider);
				return {
					id: Number(response.id ?? 0),
					runId: String(response.run_id ?? ""),
					runMonth: String(run?.run_month ?? "") || null,
					runCreatedAt: pickTimestamp(
						String(run?.created_at ?? ""),
						String(run?.started_at ?? ""),
					),
					createdAt: String(response.created_at ?? "") || null,
					runIteration: Number(response.run_iteration ?? 0),
					model: String(response.model ?? ""),
					provider: String(response.provider ?? "") || null,
					modelOwner:
						String(response.model_owner ?? "") ||
						inferModelOwnerFromModel(String(response.model ?? "")),
					webSearchEnabled: Boolean(response.web_search_enabled),
					error: String(response.error ?? "") || null,
					durationMs: Math.max(
						0,
						Math.round(Number(response.duration_ms ?? 0)),
					),
					promptTokens: Math.max(
						0,
						Math.round(Number(response.prompt_tokens ?? 0)),
					),
					completionTokens: Math.max(
						0,
						Math.round(Number(response.completion_tokens ?? 0)),
					),
					totalTokens:
						Math.max(0, Math.round(Number(response.total_tokens ?? 0))) ||
						Math.max(
							0,
							Math.round(
								Number(response.prompt_tokens ?? 0) +
									Number(response.completion_tokens ?? 0),
							),
						),
					responseText: String(response.response_text ?? ""),
					citationRefs,
					citations:
						citations.length > 0
							? citations
							: normalizeCitations(response.citations, citationProvider),
					mentions,
				};
			});

			res.json({
				generatedAt: new Date().toISOString(),
				prompt: {
					id: String(prompt.id ?? ""),
					query: String(prompt.query_text ?? ""),
					sortOrder: Number(prompt.sort_order ?? 0),
					isPaused: !prompt.is_active,
					createdAt: String(prompt.created_at ?? "") || null,
					updatedAt: String(prompt.updated_at ?? "") || null,
				},
				summary: {
					totalResponses,
					trackedRuns: runPoints.length,
					highchartsRatePct: Number(highchartsRatePct.toFixed(2)),
					viabilityRatePct,
					leadPct: Number(
						(highchartsRatePct - (topCompetitor?.ratePct ?? 0)).toFixed(2),
					),
					topCompetitor,
					lastRunAt:
						runPoints.length > 0
							? runPoints[runPoints.length - 1].timestamp
							: null,
				},
				competitors: competitorStats.sort(
					(left, right) => right.mentionRatePct - left.mentionRatePct,
				),
				runPoints,
				responses: responseItems,
		});
		} catch (error) {
			const message = String(
				error instanceof Error ? error.message : error ?? "",
			).toLowerCase();
			if (
				message.includes("fetch failed") ||
				message.includes("failed to fetch") ||
				message.includes("supabase is not configured") ||
				message.includes("missing supabase env config") ||
				message.includes("enotfound") ||
				message.includes("econnrefused")
			) {
				try {
					const queryText = String(req.query.query ?? "").trim();
					const config = await loadConfig();
					const promptIndex = config.queries.findIndex(
						(query) => query.trim().toLowerCase() === queryText.toLowerCase(),
					);
					const promptQuery =
						promptIndex >= 0 ? config.queries[promptIndex] : queryText;
					res.json({
						generatedAt: new Date().toISOString(),
						prompt: {
							id: String(promptIndex >= 0 ? promptIndex + 1 : promptQuery || ""),
							query: promptQuery,
							sortOrder: promptIndex >= 0 ? promptIndex + 1 : 0,
							isPaused: (config.pausedQueries ?? []).some(
								(value) =>
									value.trim().toLowerCase() === promptQuery.toLowerCase(),
							),
							createdAt: null,
							updatedAt: null,
						},
						summary: {
							totalResponses: 0,
							trackedRuns: 0,
							highchartsRatePct: 0,
							viabilityRatePct: 0,
							leadPct: 0,
							topCompetitor: null,
							lastRunAt: null,
						},
						competitors: config.competitors.map((name, index) => ({
							id: slugifyEntity(name) || `competitor-${index + 1}`,
							entity: name,
							entityKey: slugifyEntity(name) || `competitor-${index + 1}`,
							isHighcharts: name.toLowerCase() === "highcharts",
							isActive: true,
							mentionCount: 0,
							mentionRatePct: 0,
						})),
						runPoints: [],
						responses: [],
					});
					return;
				} catch (fallbackError) {
					console.warn(
						"[api.prompts.drilldown] snapshot fallback failed.",
						fallbackError,
					);
				}
			}
			sendApiError(res, 500, "Failed to build prompt drilldown.", error);
		}
	},
);

app.get("/api/analytics/citation-links", async (req, res) => {
	try {
		const client = requireSupabaseClient();
		const runsResult = await client
			.from("benchmark_runs")
			.select("id,run_month,web_search_enabled,created_at")
			.order("created_at", { ascending: false })
			.limit(20);

		if (runsResult.error) {
			if (isMissingRelation(runsResult.error)) {
				res.json({
					generatedAt: new Date().toISOString(),
					runId: null,
					runMonth: null,
					availableRuns: [],
					totalResponses: 0,
					responsesWithCitations: 0,
					totalCitations: 0,
					uniqueSources: 0,
					sources: [],
				});
				return;
			}
			throw asError(
				runsResult.error,
				"Failed to load benchmark runs for citation links",
			);
		}

		const availableRuns = (
			(runsResult.data ?? []) as Array<Record<string, unknown>>
		).map((run) => ({
			id: String(run.id ?? ""),
			runMonth: String(run.run_month ?? "") || null,
			createdAt: String(run.created_at ?? "") || null,
			webSearchEnabled:
				typeof run.web_search_enabled === "boolean"
					? run.web_search_enabled
					: null,
		}));
		const targetRunId =
			String(req.query.runId ?? "").trim() || availableRuns[0]?.id || null;

		if (!targetRunId) {
			res.json({
				generatedAt: new Date().toISOString(),
				runId: null,
				runMonth: null,
				availableRuns,
				totalResponses: 0,
				responsesWithCitations: 0,
				totalCitations: 0,
				uniqueSources: 0,
				sources: [],
			});
			return;
		}

		const targetRun =
			availableRuns.find((run) => run.id === targetRunId) ?? null;
		const responseRows: Array<Record<string, unknown>> = [];
		let offset = 0;
		while (true) {
			const result = await client
				.from("benchmark_responses")
				.select(
					"id,run_id,model,provider,model_owner,web_search_enabled,citations",
				)
				.eq("run_id", targetRunId)
				.range(offset, offset + SUPABASE_PAGE_SIZE - 1);

			if (result.error) {
				if (isMissingRelation(result.error)) break;
				throw asError(
					result.error,
					"Failed to load benchmark responses for citation links",
				);
			}

			const page = (result.data ?? []) as Array<Record<string, unknown>>;
			if (page.length === 0) break;
			responseRows.push(...page);
			offset += page.length;
			if (page.length < SUPABASE_PAGE_SIZE) break;
		}

		const selectedProviderSet = new Set(
			normalizeSelectedProviders(req.query.providers),
		);
		const filteredRows =
			selectedProviderSet.size > 0
				? responseRows.filter((row) =>
						responseMatchesProviderFilter(
							{
								provider: String(row.provider ?? "") || null,
								model_owner: String(row.model_owner ?? "") || null,
								model: String(row.model ?? "") || null,
							},
							selectedProviderSet,
						),
					)
				: responseRows;

		const parsed = filteredRows.map((row) => ({
			responseId: String(row.id ?? ""),
			citationRefs: normalizeCitationRefs(
				row.citations,
				normalizeCitationProvider(
					row.provider ?? row.model_owner ?? row.model,
					"openai",
				),
			),
		}));
		const sources = aggregateCitationSources(parsed);
		const responsesWithCitations = parsed.filter(
			(entry) => entry.citationRefs.length > 0,
		).length;
		const totalCitations = sources.reduce(
			(sum, source) => sum + source.citationCount,
			0,
		);

		res.json({
			generatedAt: new Date().toISOString(),
			runId: targetRunId,
			runMonth: targetRun?.runMonth ?? null,
			availableRuns,
			totalResponses: filteredRows.length,
			responsesWithCitations,
			totalCitations,
			uniqueSources: sources.length,
			sources,
		});
	} catch (error) {
		const message = String(
			error instanceof Error ? error.message : error ?? "",
		).toLowerCase();
		if (
			message.includes("fetch failed") ||
			message.includes("failed to fetch") ||
			message.includes("supabase is not configured") ||
			message.includes("missing supabase env config") ||
			message.includes("enotfound") ||
			message.includes("econnrefused")
		) {
			res.json({
				generatedAt: new Date().toISOString(),
				runId: null,
				runMonth: null,
				availableRuns: [],
				totalResponses: 0,
				responsesWithCitations: 0,
				totalCitations: 0,
				uniqueSources: 0,
				sources: [],
			});
			return;
		}
		sendApiError(res, 500, "Failed to load citation links.", error);
	}
});

app.get("/api/analytics/askill", async (req, res) => {
	try {
		const client = requireSupabaseClient();
		const runsResult = await client
			.from("benchmark_runs")
			.select("id,run_month,web_search_enabled,created_at")
			.order("created_at", { ascending: false })
			.limit(20);

		if (runsResult.error) {
			throw asError(
				runsResult.error,
				"Failed to load benchmark runs for Askill",
			);
		}

		const availableRuns = (
			(runsResult.data ?? []) as Array<Record<string, unknown>>
		).map((run) => ({
			id: String(run.id ?? ""),
			runMonth: String(run.run_month ?? "") || null,
			createdAt: String(run.created_at ?? "") || null,
			webSearchEnabled:
				typeof run.web_search_enabled === "boolean"
					? run.web_search_enabled
					: null,
		}));
		const targetRunId =
			String(req.query.runId ?? "").trim() || availableRuns[0]?.id || null;

		const emptyPayload = {
			generatedAt: new Date().toISOString(),
			runId: null,
			runMonth: null,
			availableRuns,
			highchartsName: "Highcharts",
			totalResponses: 0,
			highchartsMentions: 0,
			mentionRatePct: 0,
			totalCitations: 0,
			uniqueUrls: 0,
			uniqueDomains: 0,
			queries: [],
			urls: [],
		};

		if (!targetRunId) {
			res.json(emptyPayload);
			return;
		}

		const targetRun =
			availableRuns.find((run) => run.id === targetRunId) ?? null;
		const competitorResult = await client
			.from("competitors")
			.select("id,name")
			.eq("is_primary", true)
			.limit(1);

		if (competitorResult.error) {
			throw asError(
				competitorResult.error,
				"Failed to load primary competitor for Askill",
			);
		}

		const highchartsRow = ((competitorResult.data ?? [])[0] ?? null) as Record<
			string,
			unknown
		> | null;
		if (!highchartsRow) {
			res.json({
				...emptyPayload,
				runId: targetRunId,
				runMonth: targetRun?.runMonth ?? null,
			});
			return;
		}

		const responseRows: Array<Record<string, unknown>> = [];
		let offset = 0;
		while (true) {
			const result = await client
				.from("benchmark_responses")
				.select(
					"id,run_id,query_id,model,provider,model_owner,web_search_enabled,citations,error",
				)
				.eq("run_id", targetRunId)
				.range(offset, offset + SUPABASE_PAGE_SIZE - 1);

			if (result.error) {
				if (isMissingRelation(result.error)) break;
				throw asError(
					result.error,
					"Failed to load benchmark responses for Askill",
				);
			}

			const page = (result.data ?? []) as Array<Record<string, unknown>>;
			if (page.length === 0) break;
			responseRows.push(...page);
			offset += page.length;
			if (page.length < SUPABASE_PAGE_SIZE) break;
		}

		const selectedProviderSet = new Set(
			normalizeSelectedProviders(req.query.providers),
		);
		const filteredRows =
			selectedProviderSet.size > 0
				? responseRows.filter((row) =>
						responseMatchesProviderFilter(
							{
								provider: String(row.provider ?? "") || null,
								model_owner: String(row.model_owner ?? "") || null,
								model: String(row.model ?? "") || null,
							},
							selectedProviderSet,
						),
					)
				: responseRows;

		const responseIds = filteredRows
			.map((row) => Number(row.id ?? 0))
			.filter((id) => id > 0);
		const mentionedResponseIds = new Set<number>();
		if (responseIds.length > 0) {
			for (let index = 0; index < responseIds.length; index += 500) {
				const chunk = responseIds.slice(index, index + 500);
				let mentionOffset = 0;
				while (true) {
					const mentionResult = await client
						.from("response_mentions")
						.select("response_id,mentioned")
						.in("response_id", chunk)
						.eq("competitor_id", String(highchartsRow.id ?? ""))
						.eq("mentioned", true)
						.range(mentionOffset, mentionOffset + SUPABASE_PAGE_SIZE - 1);

					if (mentionResult.error) {
						if (isMissingRelation(mentionResult.error)) break;
						throw asError(
							mentionResult.error,
							"Failed to load response mentions for Askill",
						);
					}

					const page = (mentionResult.data ?? []) as Array<{
						response_id: number;
						mentioned: boolean;
					}>;
					if (page.length === 0) break;
					page.forEach((row) => {
						if (row.mentioned)
							mentionedResponseIds.add(Number(row.response_id));
					});
					mentionOffset += page.length;
					if (page.length < SUPABASE_PAGE_SIZE) break;
				}
			}
		}

		const queryIds = [
			...new Set(
				filteredRows
					.map((row) => String(row.query_id ?? ""))
					.filter((value) => value && value !== "null"),
			),
		];
		const queryTextMap = new Map<string, string>();
		if (queryIds.length > 0) {
			for (let index = 0; index < queryIds.length; index += 500) {
				const chunk = queryIds.slice(index, index + 500);
				const queryResult = await client
					.from("prompt_queries")
					.select("id,query_text")
					.in("id", chunk);
				if (!queryResult.error) {
					const rows = (queryResult.data ?? []) as Array<{
						id: string;
						query_text: string;
					}>;
					for (const row of rows) {
						queryTextMap.set(row.id, row.query_text);
					}
				}
			}
		}

		const citationInputs: Array<{
			responseId: string;
			citationRefs: Array<Record<string, unknown>>;
		}> = [];
		for (const row of filteredRows) {
			if (!mentionedResponseIds.has(Number(row.id ?? 0))) continue;
			citationInputs.push({
				responseId: String(row.id ?? ""),
				citationRefs: normalizeCitationRefs(
					row.citations,
					normalizeCitationProvider(
						row.provider ?? row.model_owner ?? row.model,
						"openai",
					),
				),
			});
		}

		const queryMap = new Map<
			string,
			{
				queryId: string;
				queryText: string;
				responseCount: number;
				mentionCount: number;
				totalCitations: number;
				urlSet: Set<string>;
			}
		>();
		for (const row of filteredRows) {
			const queryId = String(row.query_id ?? "__unknown__");
			if (!queryMap.has(queryId)) {
				queryMap.set(queryId, {
					queryId,
					queryText: queryTextMap.get(queryId) ?? queryId,
					responseCount: 0,
					mentionCount: 0,
					totalCitations: 0,
					urlSet: new Set<string>(),
				});
			}
			const accum = queryMap.get(queryId);
			if (!accum) {
				continue;
			}
			accum.responseCount += 1;

			if (mentionedResponseIds.has(Number(row.id ?? 0))) {
				accum.mentionCount += 1;
				const refs = normalizeCitationRefs(
					row.citations,
					normalizeCitationProvider(
						row.provider ?? row.model_owner ?? row.model,
						"openai",
					),
				);
				accum.totalCitations += refs.length;
				for (const ref of refs) {
					accum.urlSet.add(String(ref.url ?? "").trim());
				}
			}
		}

		const queries = [...queryMap.values()]
			.map((accum) => ({
				queryId: accum.queryId,
				queryText: accum.queryText,
				responseCount: accum.responseCount,
				mentionCount: accum.mentionCount,
				mentionRatePct:
					accum.responseCount > 0
						? Math.round((accum.mentionCount / accum.responseCount) * 100)
						: 0,
				totalCitations: accum.totalCitations,
				uniqueSources: accum.urlSet.size,
			}))
			.sort(
				(left, right) =>
					right.mentionCount - left.mentionCount ||
					left.queryText.localeCompare(right.queryText),
			);

		const urls = aggregateUrlStats(citationInputs);
		const totalCitations = urls.reduce(
			(sum, url) => sum + url.citationCount,
			0,
		);
		const uniqueDomains = new Set(urls.map((url) => url.host)).size;

		res.json({
			generatedAt: new Date().toISOString(),
			runId: targetRunId,
			runMonth: targetRun?.runMonth ?? null,
			availableRuns,
			highchartsName: String(highchartsRow.name ?? "Highcharts"),
			totalResponses: filteredRows.length,
			highchartsMentions: mentionedResponseIds.size,
			mentionRatePct:
				filteredRows.length > 0
					? Math.round((mentionedResponseIds.size / filteredRows.length) * 100)
					: 0,
			totalCitations,
			uniqueUrls: urls.length,
			uniqueDomains,
			queries,
			urls,
		});
	} catch (error) {
		const message = String(
			error instanceof Error ? error.message : error ?? "",
		).toLowerCase();
		if (
			message.includes("fetch failed") ||
			message.includes("failed to fetch") ||
			message.includes("supabase is not configured") ||
			message.includes("missing supabase env config") ||
			message.includes("enotfound") ||
			message.includes("econnrefused")
		) {
			res.json({
				generatedAt: new Date().toISOString(),
				runId: null,
				runMonth: null,
				availableRuns: [],
				highchartsName: "Highcharts",
				totalResponses: 0,
				highchartsMentions: 0,
				mentionRatePct: 0,
				totalCitations: 0,
				uniqueUrls: 0,
				uniqueDomains: 0,
				queries: [],
				urls: [],
			});
			return;
		}
		sendApiError(res, 500, "Failed to load Askill analytics.", error);
	}
});

const port = Number(process.env.API_PORT ?? 8787);

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	app.listen(port, () => {
		console.log(`[apps-api] listening on http://localhost:${port}`);
	});
}

export { app };
export default app;
