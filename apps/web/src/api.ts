import { createApiClient } from "@easy-llm-benchmarker/api-client";
import { createClient } from "@supabase/supabase-js";
import type {
	AskillResponse,
	AskillUrlStat,
	BenchmarkConfig,
	BenchmarkModelsResponse,
	BenchmarkRunCostsResponse,
	BenchmarkRunsResponse,
	BenchmarkStopResponse,
	BenchmarkTriggerResponse,
	CitationLinksResponse,
	CitationRef,
	CompetitorBlogsResponse,
	ConfigResponse,
	ContentGapItem,
	ContentGapStatus,
	DashboardModelStat,
	DashboardOverviewResponse,
	DashboardResponse,
	DiagnosticsCheck,
	DiagnosticsResponse,
	DiagnosticsStatus,
	HealthResponse,
	KpiRow,
	ModelOwnerStat,
	PromptDrilldownResponse,
	PromptLabRunResponse,
	PromptResearchCohort,
	PromptResearchProgress,
	PromptStatus,
	TimeSeriesResponse,
	UnderTheHoodRange,
	UnderTheHoodResponse,
} from "./types";
import { aggregateCitationSources } from "./utils/citationSources";
import {
	calculateTokenCostUsd,
	getResolvedModelPricing,
} from "./utils/modelPricing";

const BASE = "/api";
const TRIGGER_TOKEN_STORAGE_KEY = "benchmark_trigger_token";
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_CLAUSE_CHUNK_SIZE = 500;
const DASHBOARD_RECENT_RUN_SCAN_LIMIT = 25;
const bffClient = createApiClient();

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY =
	(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
	(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

export const supabase =
	SUPABASE_URL && SUPABASE_ANON_KEY
		? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
				auth: {
					persistSession: true,
					autoRefreshToken: true,
					detectSessionInUrl: true,
				},
			})
		: null;

type PromptQueryRow = {
	id: string;
	query_text: string;
	sort_order: number;
	is_active: boolean;
	tags?: string[] | null;
	updated_at?: string | null;
};

type CompetitorRow = {
	id: string;
	name: string;
	slug: string;
	is_primary: boolean;
	sort_order: number;
	is_active: boolean;
	updated_at?: string | null;
	competitor_aliases?: Array<{ alias: string }>;
};

type BenchmarkRunRow = {
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
};

type BenchmarkResponseRow = {
	id: number;
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
};

const COMPETITOR_CITATION_DOMAINS_SETTING_KEY = "competitor_citation_domains";

type RunCostResponseRow = {
	id: number;
	run_id: string;
	model: string;
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	total_tokens?: number | null;
};

type ResponseMentionRow = {
	response_id: number;
	competitor_id: string;
	mentioned: boolean;
};

type TimeSeriesRunRow = {
	id: string;
	created_at: string | null;
	run_month: string | null;
	overall_score: number | null;
};

type TimeSeriesResponseRow = {
	id: number;
	run_id: string;
	query_id: string;
	model?: string | null;
	provider?: string | null;
	model_owner?: string | null;
};

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
	created_at?: string | null;
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
	created_at?: string | null;
};

type MvVisibilityScoreRow = {
	run_id: string;
	query_id: string | null;
	query_key: string;
	query_text: string;
	is_overall_row: boolean;
	ai_visibility_score: number | null;
	created_at: string | null;
};

type TimeSeriesOptions = {
	tags?: string[];
	mode?: "any" | "all";
	providers?: string[];
};

type DashboardOptions = {
	providers?: string[];
};

type PromptDrilldownPromptRow = {
	id: string;
	query_text: string;
	sort_order: number;
	is_active: boolean;
	created_at: string | null;
	updated_at: string | null;
};

type PromptDrilldownResponseRow = {
	id: number;
	run_id: string;
	run_iteration: number;
	model: string;
	web_search_enabled: boolean;
	response_text: string;
	citations: unknown;
	error: string | null;
	created_at: string | null;
	provider?: string | null;
	model_owner?: string | null;
	duration_ms?: number | null;
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	total_tokens?: number | null;
};

type PromptDrilldownRunRow = {
	id: string;
	run_month: string | null;
	model: string | null;
	web_search_enabled: boolean | null;
	started_at: string | null;
	ended_at: string | null;
	overall_score: number | null;
	created_at: string | null;
};

type CompetitorBlogPostRow = {
	id: string;
	source: string | null;
	source_slug: string | null;
	title: string | null;
	content_theme: string | null;
	description: string | null;
	author: string | null;
	link: string | null;
	publish_date: string | null;
	published_at: string | null;
	created_at: string | null;
};

function uniqueNonEmpty(values: string[]): string[] {
	const normalized = values.map((value) => value.trim()).filter(Boolean);
	return [...new Set(normalized)];
}

function toFiniteNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsvList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return uniqueNonEmpty(value.map((item) => String(item)));
	}
	if (typeof value === "string") {
		return uniqueNonEmpty(value.split(",").map((item) => item.trim()));
	}
	return [];
}

function parseModelOwnerMap(value: unknown): Record<string, string> {
	if (typeof value !== "string" || !value.trim()) {
		return {};
	}

	const output: Record<string, string> = {};
	for (const pair of value.split(";")) {
		const [modelRaw, ownerRaw] = pair.split("=>");
		const model = String(modelRaw ?? "").trim();
		const owner = String(ownerRaw ?? "").trim();
		if (!model || !owner) continue;
		output[model] = owner;
	}
	return output;
}

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

const LEGACY_PROMPT_TAG = "legacy";
const DELETED_PROMPT_TAG_ALIASES = new Set([
	LEGACY_PROMPT_TAG,
	"_deleted",
	"__deleted__",
]);

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
	return parsePromptTagList(rawTags).some((tag) =>
		DELETED_PROMPT_TAG_ALIASES.has(tag),
	);
}

function withDeletedPromptTag(_rawTags: unknown, _query: string): string[] {
	return [LEGACY_PROMPT_TAG];
}

function normalizePromptTags(rawTags: unknown, query: string): string[] {
	const normalized = parsePromptTagList(rawTags).filter(
		(tag) => !DELETED_PROMPT_TAG_ALIASES.has(tag),
	);
	return normalized.length > 0 ? normalized : inferPromptTags(query);
}

function normalizePromptTagsForStatus(
	rawTags: unknown,
	query: string,
): string[] {
	if (hasDeletedPromptTag(rawTags)) {
		return [LEGACY_PROMPT_TAG];
	}
	return normalizePromptTags(rawTags, query);
}

function normalizeQueryTagsMap(
	queries: string[],
	rawQueryTags: BenchmarkConfig["queryTags"],
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

function normalizeSelectedTags(tags?: string[]): string[] {
	return uniqueNonEmpty((tags ?? []).map((tag) => tag.toLowerCase()));
}

function promptMatchesTagFilter(
	promptTags: string[],
	selectedTagSet: Set<string>,
	mode: "any" | "all",
): boolean {
	if (selectedTagSet.size === 0) return true;

	const promptTagSet = new Set(promptTags.map((tag) => tag.toLowerCase()));
	if (mode === "all") {
		for (const tag of selectedTagSet) {
			if (!promptTagSet.has(tag)) return false;
		}
		return true;
	}

	for (const tag of selectedTagSet) {
		if (promptTagSet.has(tag)) return true;
	}
	return false;
}

function toValidTimestamp(value: string | null | undefined): string | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? value : null;
}

function pickTimestamp(
	...values: Array<string | null | undefined>
): string | null {
	for (const value of values) {
		const valid = toValidTimestamp(value);
		if (valid) return valid;
	}
	return null;
}

function normalizeCitationProvider(
	value: unknown,
	fallback: CitationRef["provider"] = "openai",
): CitationRef["provider"] {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) return fallback;
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
	return fallback;
}

function normalizeCitationHost(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) return "";
	const fromUrl = (value: string): string =>
		value.toLowerCase().replace(/^www\./, "");
	try {
		return fromUrl(new URL(trimmed).hostname);
	} catch {
		const host = trimmed
			.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
			.split("/")[0]
			.split("?")[0]
			.split("#")[0]
			.split("@")
			.at(-1)
			?.split(":")[0]
			?.trim();
		return host ? fromUrl(host) : "";
	}
}

function normalizeCitationBound(value: unknown): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	const rounded = Math.round(parsed);
	return rounded >= 0 ? rounded : null;
}

function buildCitationRef(
	candidate: unknown,
	fallbackProvider: CitationRef["provider"],
	sourceText = "",
): Omit<CitationRef, "id"> | null {
	if (!candidate || typeof candidate !== "object") return null;
	const entry = candidate as {
		url?: unknown;
		uri?: unknown;
		href?: unknown;
		source?: unknown;
		link?: unknown;
		title?: unknown;
		snippet?: unknown;
		text?: unknown;
		excerpt?: unknown;
		start_index?: unknown;
		startIndex?: unknown;
		end_index?: unknown;
		endIndex?: unknown;
		anchorText?: unknown;
		anchor_text?: unknown;
		provider?: unknown;
	};
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
	let anchorText: string | null =
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
	fallbackProvider: CitationRef["provider"] = "openai",
): CitationRef[] {
	const refs: CitationRef[] = [];
	const seen = new Set<string>();
	let nextId = 1;

	const parseStringValue = (value: string): unknown => {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
			try {
				return JSON.parse(trimmed) as unknown;
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
			normalized.title.toLowerCase(),
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
			const parsed = parseStringValue(value);
			walk(parsed);
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
				? ((outputItem as { content: unknown[] }).content ?? [])
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
					const nested = (annotation as { url_citation?: unknown })
						.url_citation;
					append(nested, sourceText);
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
				? ((grounding as { groundingChunks: unknown[] }).groundingChunks ?? [])
				: [];
			for (const chunk of chunks) {
				if (!chunk || typeof chunk !== "object") continue;
				append(chunk);
				const webChunk = (chunk as { web?: unknown }).web;
				append(webChunk);
			}
			const citationSources = Array.isArray(
				(grounding as { citationMetadata?: { citationSources?: unknown } })
					.citationMetadata?.citationSources,
			)
				? (((
						grounding as { citationMetadata?: { citationSources?: unknown[] } }
					).citationMetadata?.citationSources as unknown[]) ?? [])
				: [];
			for (const source of citationSources) append(source);
		}

		append(payload);
	};

	walk(rawCitations);

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

function normalizeCitations(
	rawCitations: unknown,
	fallbackProvider: CitationRef["provider"] = "openai",
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

function normalizePromptLabRunPayload(
	payload: PromptLabRunResponse,
): PromptLabRunResponse {
	const normalizeResult = (result: PromptLabRunResponse["results"][number]) => {
		const provider = normalizeCitationProvider(result.provider, "openai");
		const citationRefs = normalizeCitationRefs(
			result.citationRefs && result.citationRefs.length > 0
				? result.citationRefs
				: result.citations,
			provider,
		);
		const citations = normalizeCitations(citationRefs, provider);
		return {
			...result,
			effectiveQuery: result.effectiveQuery || payload.query,
			citationRefs,
			citations:
				citations.length > 0
					? citations
					: normalizeCitations(result.citations, provider),
		};
	};

	const normalizedResults = Array.isArray(payload.results)
		? payload.results.map(normalizeResult)
		: [];
	const primaryProvider = normalizeCitationProvider(payload.provider, "openai");
	const primaryRefs = normalizeCitationRefs(
		payload.citationRefs && payload.citationRefs.length > 0
			? payload.citationRefs
			: payload.citations,
		primaryProvider,
	);
	const primaryCitations = normalizeCitations(primaryRefs, primaryProvider);

	return {
		...payload,
		results: normalizedResults,
		effectiveQuery: payload.effectiveQuery || payload.query,
		citationRefs: primaryRefs,
		citations:
			primaryCitations.length > 0
				? primaryCitations
				: normalizeCitations(payload.citations, primaryProvider),
	};
}

function normalizePromptDrilldownPayload(
	payload: PromptDrilldownResponse,
): PromptDrilldownResponse {
	return {
		...payload,
		responses: (payload.responses ?? []).map((response) => {
			const provider = normalizeCitationProvider(response.provider, "openai");
			const citationRefs = normalizeCitationRefs(
				response.citationRefs && response.citationRefs.length > 0
					? response.citationRefs
					: response.citations,
				provider,
			);
			const citations = normalizeCitations(citationRefs, provider);
			return {
				...response,
				citationRefs,
				citations:
					citations.length > 0
						? citations
						: normalizeCitations(response.citations, provider),
			};
		}),
	};
}

function slugifyEntity(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function inferModelOwnerFromModel(model: string): string {
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

function normalizeSelectedProviders(providers?: string[]): LlmProviderKey[] {
	if (!Array.isArray(providers) || providers.length === 0) return [];
	return [
		...new Set(
			providers
				.map((provider) => normalizeProviderKey(provider))
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

function buildModelOwnerSummaryFromModels(models: string[]): {
	modelOwners: string[];
	modelOwnerMap: Record<string, string>;
} {
	const modelOwnerMap = Object.fromEntries(
		models.map((model) => [model, inferModelOwnerFromModel(model)]),
	);
	const modelOwners = [...new Set(Object.values(modelOwnerMap))].sort((a, b) =>
		a.localeCompare(b),
	);
	return { modelOwners, modelOwnerMap };
}

function buildModelOwnerStatsFromResponses(
	responses: BenchmarkResponseRow[],
): ModelOwnerStat[] {
	const counts = new Map<string, number>();
	const modelsByOwner = new Map<string, Set<string>>();

	for (const response of responses) {
		const model = String(response.model ?? "").trim();
		if (!model) continue;
		const owner = inferModelOwnerFromModel(model);
		counts.set(owner, (counts.get(owner) ?? 0) + 1);
		const ownerModels = modelsByOwner.get(owner) ?? new Set<string>();
		ownerModels.add(model);
		modelsByOwner.set(owner, ownerModels);
	}

	return [...counts.entries()]
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
}

function percentile(values: number[], target: number): number {
	if (values.length === 0) return 0;
	const sorted = values.slice().sort((left, right) => left - right);
	const clamped = Math.max(0, Math.min(1, target));
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(clamped * sorted.length) - 1),
	);
	return sorted[index] ?? 0;
}

function buildModelStatsFromResponses(responses: BenchmarkResponseRow[]): {
	modelStats: DashboardModelStat[];
	tokenTotals: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	durationTotals: { totalDurationMs: number; avgDurationMs: number };
} {
	const modelBuckets = new Map<
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

	for (const response of responses) {
		const model = String(response.model ?? "").trim();
		if (!model) continue;
		const owner =
			String(response.model_owner ?? "").trim() ||
			inferModelOwnerFromModel(model);
		const hasError = Boolean(String(response.error ?? "").trim());
		const durationMs = Math.max(
			0,
			Math.round(Number(response.duration_ms ?? 0)),
		);
		const inputTokens = Math.max(
			0,
			Math.round(Number(response.prompt_tokens ?? 0)),
		);
		const outputTokens = Math.max(
			0,
			Math.round(Number(response.completion_tokens ?? 0)),
		);
		const rowTotalTokens = Math.max(
			0,
			Math.round(Number(response.total_tokens ?? 0)) ||
				inputTokens + outputTokens,
		);

		let bucket = modelBuckets.get(model);
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
			modelBuckets.set(model, bucket);
		}

		bucket.responseCount += 1;
		if (hasError) {
			bucket.failureCount += 1;
		} else {
			bucket.successCount += 1;
		}
		if (response.web_search_enabled) {
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

	const modelStats: DashboardModelStat[] = [...modelBuckets.entries()]
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
				responses.length > 0
					? Number((totalDurationMs / responses.length).toFixed(2))
					: 0,
		},
	};
}

function safeTokenInt(value: unknown): number {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.max(0, Math.round(parsed));
}

function estimateResponseCostUsd(
	model: string,
	inputTokens: number,
	outputTokens: number,
): {
	inputCostUsd: number;
	outputCostUsd: number;
	totalCostUsd: number;
	priced: boolean;
} {
	const pricing = getResolvedModelPricing(model);
	if (!pricing) {
		return {
			inputCostUsd: 0,
			outputCostUsd: 0,
			totalCostUsd: 0,
			priced: false,
		};
	}
	const costs = calculateTokenCostUsd(inputTokens, outputTokens, pricing);
	return {
		inputCostUsd: costs.inputCostUsd,
		outputCostUsd: costs.outputCostUsd,
		totalCostUsd: costs.totalCostUsd,
		priced: true,
	};
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

const UNDER_THE_HOOD_RANGE_OPTIONS: UnderTheHoodRange[] = [
	"1d",
	"7d",
	"30d",
	"all",
];

function normalizeUnderTheHoodRange(
	value: string | UnderTheHoodRange | undefined,
): UnderTheHoodRange {
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

function timestampMs(value: string | null | undefined): number | null {
	const valid = toValidTimestamp(value);
	if (!valid) return null;
	const parsed = Date.parse(valid);
	return Number.isFinite(parsed) ? parsed : null;
}

function hasSupabaseConfig() {
	return Boolean(supabase);
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
		const maybeMessage = (error as { message?: string }).message;
		if (maybeMessage) {
			return new Error(`${context}: ${maybeMessage}`);
		}
	}
	return new Error(`${context}: ${String(error)}`);
}

type DiagnosticResult = {
	status: DiagnosticsStatus;
	details: string;
};

async function runCheck(
	id: string,
	name: string,
	check: () => Promise<DiagnosticResult>,
): Promise<DiagnosticsCheck> {
	const startedAt = Date.now();
	try {
		const result = await check();
		return {
			id,
			name,
			status: result.status,
			details: result.details,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		return {
			id,
			name,
			status: "fail",
			details: asError(error, name).message,
			durationMs: Date.now() - startedAt,
		};
	}
}

function emptyDashboard(config: BenchmarkConfig): DashboardResponse {
	const queryTags = normalizeQueryTagsMap(config.queries, config.queryTags);

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
			tokenTotals: {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			},
			durationTotals: {
				totalDurationMs: 0,
				avgDurationMs: 0,
			},
			runMonth: null,
			webSearchEnabled: null,
			windowStartUtc: null,
			windowEndUtc: null,
		},
		kpi: null,
		competitorSeries: config.competitors.map((name) => ({
			entity: name,
			entityKey: slugifyEntity(name),
			isHighcharts: name.toLowerCase() === "highcharts",
			mentionRatePct: 0,
			shareOfVoicePct: 0,
		})),
		promptStatus: config.queries.map((query) => ({
			query,
			tags: queryTags[query] ?? inferPromptTags(query),
			isPaused: false,
			status: "awaiting_run",
			runs: 0,
			highchartsRatePct: 0,
			highchartsRank: null,
			highchartsRankOutOf: config.competitors.length,
			viabilityRatePct: 0,
			topCompetitor: null,
			latestRunResponseCount: 0,
			competitorRates: config.competitors.map((name) => ({
				entity: name,
				entityKey: slugifyEntity(name),
				isHighcharts: name.toLowerCase() === "highcharts",
				ratePct: 0,
				mentions: 0,
			})),
		})),
		comparisonRows: [],
		files: {
			comparisonTablePresent: false,
			competitorChartPresent: false,
			kpiPresent: false,
			llmOutputsPresent: false,
		},
	};
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const headers = new Headers(init?.headers ?? {});
	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers,
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
	}
	return res.json() as Promise<T>;
}

type SupabasePagedResult<T> = {
	data: T[] | null;
	error: unknown;
};

async function fetchAllSupabasePages<T>(
	fetchPage: (from: number, to: number) => PromiseLike<SupabasePagedResult<T>>,
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

function canUseSessionStorage(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.sessionStorage !== "undefined"
	);
}

function readStoredTriggerToken(): string {
	if (!canUseSessionStorage()) {
		return "";
	}
	return window.sessionStorage.getItem(TRIGGER_TOKEN_STORAGE_KEY)?.trim() ?? "";
}

function withOptionalTriggerToken(
	triggerToken?: string,
): Record<string, string> | undefined {
	const trimmed = triggerToken?.trim() ?? "";
	if (!trimmed) {
		return undefined;
	}
	return { Authorization: `Bearer ${trimmed}` };
}

async function fetchSupabaseConfigRows(): Promise<{
	promptRows: PromptQueryRow[];
	competitorRows: CompetitorRow[];
}> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const [promptResultWithTags, competitorResult] = await Promise.all([
		fetchAllSupabasePages<PromptQueryRow>((from, to) =>
			supabase
				.from("prompt_queries")
				.select("id,query_text,sort_order,is_active,tags,updated_at")
				.eq("is_active", true)
				.order("sort_order", { ascending: true })
				.range(from, to),
		),
		fetchAllSupabasePages<CompetitorRow>((from, to) =>
			supabase
				.from("competitors")
				.select(
					"id,name,slug,is_primary,sort_order,is_active,updated_at,competitor_aliases(alias)",
				)
				.eq("is_active", true)
				.order("sort_order", { ascending: true })
				.range(from, to),
		),
	]);

	let promptRows = promptResultWithTags.rows;
	let promptError = promptResultWithTags.error;

	// Backward compatibility while Supabase migration for tags rolls out.
	if (promptError && isMissingColumn(promptError)) {
		const promptResultFallback = await fetchAllSupabasePages<PromptQueryRow>(
			(from, to) =>
				supabase
					.from("prompt_queries")
					.select("id,query_text,sort_order,is_active,updated_at")
					.eq("is_active", true)
					.order("sort_order", { ascending: true })
					.range(from, to),
		);
		promptRows = promptResultFallback.rows.map((row) => ({
			...row,
			tags: null,
		}));
		promptError = promptResultFallback.error;
	}

	if (promptError) {
		throw asError(promptError, "Failed to read prompt_queries from Supabase");
	}
	if (competitorResult.error) {
		throw asError(
			competitorResult.error,
			"Failed to read competitors from Supabase",
		);
	}

	return {
		promptRows,
		competitorRows: competitorResult.rows,
	};
}

async function fetchConfigFromSupabase(): Promise<ConfigResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}
	const { promptRows, competitorRows } = await fetchSupabaseConfigRows();

	const queries = promptRows.map((row) => row.query_text);
	const queryTags = Object.fromEntries(
		promptRows.map((row) => [
			row.query_text,
			normalizePromptTags(row.tags, row.query_text),
		]),
	);
	const competitors = competitorRows.map((row) => row.name);

	const aliases: Record<string, string[]> = {};
	for (const row of competitorRows) {
		const aliasValues = (row.competitor_aliases ?? []).map(
			(aliasRow) => aliasRow.alias,
		);
		aliases[row.name] = uniqueNonEmpty([row.name, ...aliasValues]);
	}

	let competitorCitationDomains = defaultCompetitorCitationDomains();
	const appSettingsResult = await supabase
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
		...promptRows.map((row) => row.updated_at).filter(Boolean),
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
		},
		meta: {
			path: "supabase://public.prompt_queries+public.competitors+public.competitor_aliases+public.app_settings",
			updatedAt: updatedAt ?? new Date().toISOString(),
			queries: queries.length,
			competitors: competitors.length,
		},
	};
}

async function updateConfigInSupabase(
	config: BenchmarkConfig,
): Promise<ConfigResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const queries = uniqueNonEmpty(config.queries);
	const competitors = uniqueNonEmpty(config.competitors);

	if (queries.length === 0) {
		throw new Error("Config must include at least one query.");
	}
	if (competitors.length === 0) {
		throw new Error("Config must include at least one competitor.");
	}
	if (!competitors.some((value) => value.toLowerCase() === "highcharts")) {
		throw new Error('Config competitors must include "Highcharts".');
	}

	const aliasesByName: Record<string, string[]> = {};
	for (const competitor of competitors) {
		aliasesByName[competitor] = uniqueNonEmpty([
			competitor,
			...(config.aliases[competitor] ??
				config.aliases[competitor.toLowerCase()] ??
				[]),
		]);
	}

	const queryTags = normalizeQueryTagsMap(queries, config.queryTags);

	const promptPayload = queries.map((queryText, index) => ({
		query_text: queryText,
		sort_order: index + 1,
		is_active: true,
		tags: queryTags[queryText] ?? inferPromptTags(queryText),
	}));

	let promptUpsert = await supabase
		.from("prompt_queries")
		.upsert(promptPayload, { onConflict: "query_text" });
	// Backward compatibility while Supabase migration for tags rolls out.
	if (promptUpsert.error && isMissingColumn(promptUpsert.error)) {
		const promptPayloadWithoutTags = promptPayload.map(
			({ tags: _tags, ...rest }) => rest,
		);
		promptUpsert = await supabase
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
		supabase
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
			supabase
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

	const activeQuerySet = new Set(queries);
	for (const row of allPromptRowsData) {
		const shouldBeActive = activeQuerySet.has(row.query_text);

		const shouldMarkDeleted =
			promptTagsColumnAvailable &&
			!shouldBeActive &&
			!hasDeletedPromptTag(row.tags);

		if (row.is_active !== shouldBeActive || shouldMarkDeleted) {
			const promptUpdatePayload: Record<string, unknown> = {
				is_active: shouldBeActive,
			};
			if (promptTagsColumnAvailable && !shouldBeActive) {
				promptUpdatePayload.tags = withDeletedPromptTag(
					row.tags,
					row.query_text,
				);
			}

			const updateResult = await supabase
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

	const competitorUpsert = await supabase
		.from("competitors")
		.upsert(competitorPayload, { onConflict: "slug" });
	if (competitorUpsert.error) {
		throw asError(
			competitorUpsert.error,
			"Unable to save competitors. Check RLS write policy for competitors",
		);
	}

	const allCompetitors = await supabase
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
			const updateResult = await supabase
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

	const activeCompetitors = await supabase
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
			const aliasUpsert = await supabase.from("competitor_aliases").upsert(
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

		const existingAliases = await supabase
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
			const deleteResult = await supabase
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
		Object.hasOwn(config, "competitorCitationDomains") &&
		config.competitorCitationDomains !== undefined
	) {
		const normalizedDomains = normalizeCompetitorCitationDomains(
			config.competitorCitationDomains,
		);
		const upsertResult = await supabase.from("app_settings").upsert(
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

	return fetchConfigFromSupabase();
}

async function togglePromptInSupabase(
	query: string,
	active: boolean,
): Promise<void> {
	if (!supabase) throw new Error("Supabase is not configured.");

	const promptRowWithTags = await supabase
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
		const fallbackRow = await supabase
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

	const updateResult = await supabase
		.from("prompt_queries")
		.update(updatePayload)
		.eq("id", promptRow.id);

	if (updateResult.error) {
		throw asError(updateResult.error, "Failed to toggle prompt active state");
	}
}

async function fetchDashboardFromSupabase(
	options: DashboardOptions = {},
): Promise<DashboardResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const configResponse = await fetchConfigFromSupabase();
	const config = configResponse.config;
	const selectedProviders = normalizeSelectedProviders(options.providers);
	const selectedProviderSet = new Set(selectedProviders);

	// Fetch ALL queries (active and paused) so we can show isPaused state in the grid
	const activeQueryResultWithTags = await fetchAllSupabasePages<PromptQueryRow>(
		(from, to) =>
			supabase
				.from("prompt_queries")
				.select("id,query_text,sort_order,is_active,tags")
				.order("sort_order", { ascending: true })
				.range(from, to),
	);

	let activeQueryError = activeQueryResultWithTags.error;
	let activeQueryRows = activeQueryResultWithTags.rows;

	// Backward compatibility while Supabase migration for tags rolls out.
	if (activeQueryError && isMissingColumn(activeQueryError)) {
		const fallbackRows = await fetchAllSupabasePages<PromptQueryRow>(
			(from, to) =>
				supabase
					.from("prompt_queries")
					.select("id,query_text,sort_order,is_active")
					.order("sort_order", { ascending: true })
					.range(from, to),
		);
		activeQueryError = fallbackRows.error;
		activeQueryRows = fallbackRows.rows.map((row) => ({
			...row,
			tags: null,
		}));
	}

	if (activeQueryError) {
		throw asError(
			activeQueryError,
			"Failed to load query metadata from Supabase",
		);
	}

	const activeCompetitorRows = await supabase
		.from("competitors")
		.select("id,name,slug,is_primary,sort_order")
		.eq("is_active", true)
		.order("sort_order", { ascending: true });

	if (activeCompetitorRows.error) {
		throw asError(
			activeCompetitorRows.error,
			"Failed to load competitor metadata from Supabase",
		);
	}

	const queryRows = activeQueryRows as Array<{
		id: string;
		query_text: string;
		sort_order: number;
		is_active: boolean;
		tags?: string[] | null;
	}>;
	const competitorRows = (activeCompetitorRows.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
	}>;

	const historicalRunsByQuery = new Map<string, Set<string>>();
	if (queryRows.length > 0) {
		const historyRows: Array<{ query_id: string; run_id: string }> = [];
		const queryIds = queryRows.map((row) => row.id);
		let historyOffset = 0;

		while (true) {
			const historyResult = await supabase
				.from("benchmark_responses")
				.select("query_id,run_id")
				.in("query_id", queryIds)
				.order("id", { ascending: true })
				.range(historyOffset, historyOffset + SUPABASE_PAGE_SIZE - 1);

			if (historyResult.error) {
				if (isMissingRelation(historyResult.error)) {
					return emptyDashboard(config);
				}
				throw asError(
					historyResult.error,
					"Failed to load historical benchmark_responses",
				);
			}

			const pageRows = (historyResult.data ?? []) as Array<{
				query_id: string;
				run_id: string;
			}>;
			if (pageRows.length === 0) {
				break;
			}

			historyRows.push(...pageRows);
			historyOffset += pageRows.length;
		}

		for (const row of historyRows) {
			let runSet = historicalRunsByQuery.get(row.query_id);
			if (!runSet) {
				runSet = new Set<string>();
				historicalRunsByQuery.set(row.query_id, runSet);
			}
			runSet.add(row.run_id);
		}
	}

	const latestRunResult = await supabase
		.from("benchmark_runs")
		.select(
			"id,run_month,model,run_kind,cohort_tag,web_search_enabled,started_at,ended_at,overall_score,created_at",
		)
		.order("created_at", { ascending: false })
		.limit(1);

	if (latestRunResult.error) {
		if (isMissingRelation(latestRunResult.error)) {
			return emptyDashboard(config);
		}
		throw asError(
			latestRunResult.error,
			"Failed to load benchmark_runs from Supabase",
		);
	}

	const latestRun = ((latestRunResult.data ?? [])[0] ??
		null) as BenchmarkRunRow | null;
	if (!latestRun) {
		return emptyDashboard(config);
	}

	const responseResultWithStats = await supabase
		.from("benchmark_responses")
		.select(
			"id,query_id,run_iteration,model,provider,model_owner,web_search_enabled,error,duration_ms,prompt_tokens,completion_tokens,total_tokens",
		)
		.eq("run_id", latestRun.id);

	let responseRowsError = responseResultWithStats.error;
	let responseRows = (responseResultWithStats.data ??
		[]) as BenchmarkResponseRow[];

	if (responseRowsError && isMissingColumn(responseRowsError)) {
		const responseResultFallback = await supabase
			.from("benchmark_responses")
			.select("id,query_id,run_iteration,model,web_search_enabled,error")
			.eq("run_id", latestRun.id);
		responseRowsError = responseResultFallback.error;
		responseRows = (
			(responseResultFallback.data ?? []) as BenchmarkResponseRow[]
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
			return emptyDashboard(config);
		}
		throw asError(
			responseRowsError,
			"Failed to load benchmark_responses from Supabase",
		);
	}

	const responses =
		selectedProviderSet.size > 0
			? responseRows.filter((response) =>
					responseMatchesProviderFilter(response, selectedProviderSet),
				)
			: responseRows;
	const responseIds = responses.map((row) => row.id);

	const mentionRows: ResponseMentionRow[] = [];
	if (responseIds.length > 0) {
		for (
			let index = 0;
			index < responseIds.length;
			index += SUPABASE_IN_CLAUSE_CHUNK_SIZE
		) {
			const chunk = responseIds.slice(
				index,
				index + SUPABASE_IN_CLAUSE_CHUNK_SIZE,
			);
			let mentionOffset = 0;

			while (true) {
				const mentionResult = await supabase
					.from("response_mentions")
					.select("response_id,competitor_id,mentioned")
					.in("response_id", chunk)
					.order("response_id", { ascending: true })
					.order("competitor_id", { ascending: true })
					.range(mentionOffset, mentionOffset + SUPABASE_PAGE_SIZE - 1);

				if (mentionResult.error) {
					if (isMissingRelation(mentionResult.error)) {
						return emptyDashboard(config);
					}
					throw asError(
						mentionResult.error,
						"Failed to load response_mentions from Supabase",
					);
				}

				const pageRows = (mentionResult.data ?? []) as ResponseMentionRow[];
				if (pageRows.length === 0) {
					break;
				}

				mentionRows.push(...pageRows);
				mentionOffset += pageRows.length;
			}
		}
	}

	const competitorById = new Map(competitorRows.map((row) => [row.id, row]));
	const queryById = new Map(queryRows.map((row) => [row.id, row]));
	const mentionsByResponse = new Map<number, Map<string, boolean>>();

	for (const mention of mentionRows) {
		let bucket = mentionsByResponse.get(mention.response_id);
		if (!bucket) {
			bucket = new Map<string, boolean>();
			mentionsByResponse.set(mention.response_id, bucket);
		}
		bucket.set(mention.competitor_id, Boolean(mention.mentioned));
	}

	const totalResponses = responses.length;
	const totalMentionsAcrossEntities = competitorRows.reduce(
		(sum, competitor) => {
			const mentionsForCompetitor = responses.reduce((count, response) => {
				const mentionMap = mentionsByResponse.get(response.id);
				return count + (mentionMap?.get(competitor.id) ? 1 : 0);
			}, 0);
			return sum + mentionsForCompetitor;
		},
		0,
	);

	const competitorSeries = competitorRows.map((competitor) => {
		const mentionsCount = responses.reduce((count, response) => {
			const mentionMap = mentionsByResponse.get(response.id);
			return count + (mentionMap?.get(competitor.id) ? 1 : 0);
		}, 0);

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
			mentionRatePct: Number(mentionRatePct.toFixed(2)),
			shareOfVoicePct: Number(shareOfVoicePct.toFixed(2)),
		};
	});

	const highchartsCompetitor =
		competitorRows.find((row) => row.is_primary) ??
		competitorRows.find((row) => row.slug === "highcharts") ??
		null;

	const nonHighchartsCompetitors = competitorRows.filter(
		(row) => row.id !== highchartsCompetitor?.id,
	);

	const promptStatus = queryRows.map((queryRow) => {
		const queryResponses = responses.filter(
			(response) => response.query_id === queryRow.id,
		);
		const latestRunResponseCount = queryResponses.length;
		const runs = historicalRunsByQuery.get(queryRow.id)?.size ?? 0;
		const latestInputTokens = queryResponses.reduce(
			(sum, response) => sum + safeTokenInt(response.prompt_tokens),
			0,
		);
		const latestOutputTokens = queryResponses.reduce(
			(sum, response) => sum + safeTokenInt(response.completion_tokens),
			0,
		);
		const latestTotalTokens = queryResponses.reduce((sum, response) => {
			const inputTokens = safeTokenInt(response.prompt_tokens);
			const outputTokens = safeTokenInt(response.completion_tokens);
			const totalTokens =
				safeTokenInt(response.total_tokens) || inputTokens + outputTokens;
			return sum + totalTokens;
		}, 0);
		const promptCostTotals = queryResponses.reduce(
			(totals, response) => {
				const inputTokens = safeTokenInt(response.prompt_tokens);
				const outputTokens = safeTokenInt(response.completion_tokens);
				const costs = estimateResponseCostUsd(
					response.model,
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

		const competitorRatesAll = competitorRows.map((competitor) => {
			const mentions = queryResponses.reduce((count, response) => {
				const mentionMap = mentionsByResponse.get(response.id);
				return count + (mentionMap?.get(competitor.id) ? 1 : 0);
			}, 0);
			const ratePct =
				latestRunResponseCount > 0
					? (mentions / latestRunResponseCount) * 100
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

		const highchartsRateEntry =
			competitorRatesAll.find((entry) => entry.isHighcharts) ?? null;
		const highchartsRatePct = highchartsRateEntry?.ratePct ?? 0;
		const competitorRates = competitorRatesAll.filter(
			(entry) => !entry.isHighcharts,
		);

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
					ratePct: Number(entry.ratePct.toFixed(2)),
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
			tags: normalizePromptTagsForStatus(queryRow.tags, queryRow.query_text),
			isPaused: !isDeleted && !queryRow.is_active,
			status,
			runs,
			highchartsRatePct: Number(highchartsRatePct.toFixed(2)),
			highchartsRank,
			highchartsRankOutOf: competitorRows.length,
			viabilityRatePct: Number(viabilityRatePct.toFixed(2)),
			topCompetitor,
			latestRunResponseCount,
			latestInputTokens,
			latestOutputTokens,
			latestTotalTokens,
			estimatedInputCostUsd: Number(promptCostTotals.inputCostUsd.toFixed(6)),
			estimatedOutputCostUsd: Number(promptCostTotals.outputCostUsd.toFixed(6)),
			estimatedTotalCostUsd: Number(promptCostTotals.totalCostUsd.toFixed(6)),
			estimatedAvgCostPerResponseUsd:
				promptCostTotals.pricedResponses > 0
					? Number(
							(
								promptCostTotals.totalCostUsd / promptCostTotals.pricedResponses
							).toFixed(6),
						)
					: 0,
			competitorRates: competitorRatesAll.map((entry) => ({
				entity: entry.entity,
				entityKey: entry.entityKey,
				isHighcharts: entry.isHighcharts,
				ratePct: Number(entry.ratePct.toFixed(2)),
				mentions: entry.mentions,
			})),
		};
	});

	const responseModelSet = [
		...new Set(responses.map((row) => row.model).filter(Boolean)),
	];
	const models =
		responseModelSet.length > 0
			? responseModelSet
			: selectedProviderSet.size === 0 && latestRun.model
				? [latestRun.model]
				: [];
	const { modelOwners, modelOwnerMap } =
		buildModelOwnerSummaryFromModels(models);
	const modelOwnerStats = buildModelOwnerStatsFromResponses(responses);
	const modelStatsSummary = buildModelStatsFromResponses(responses);
	const highchartsSeries =
		competitorSeries.find((series) => series.isHighcharts) ?? null;
	const derivedOverallScore =
		0.7 * (highchartsSeries?.mentionRatePct ?? 0) +
		0.3 * (highchartsSeries?.shareOfVoicePct ?? 0);
	const overallScore =
		selectedProviderSet.size > 0
			? Number(derivedOverallScore.toFixed(2))
			: Number((latestRun.overall_score ?? 0).toFixed(2));
	const modelOwnerMapString = Object.entries(modelOwnerMap)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([model, owner]) => `${model}=>${owner}`)
		.join(";");

	const kpi: KpiRow = {
		metric_name: "AI Visibility Overall",
		ai_visibility_overall_score: overallScore,
		score_scale: "0-100",
		queries_count: String(queryRows.length),
		window_start_utc: latestRun.started_at ?? "",
		window_end_utc: latestRun.ended_at ?? "",
		models: models.join(","),
		model_owners: modelOwners.join(","),
		model_owner_map: modelOwnerMapString,
		web_search_enabled: latestRun.web_search_enabled ? "yes" : "no",
		run_month: latestRun.run_month ?? "",
		run_id: latestRun.id,
	};

	return {
		generatedAt: new Date().toISOString(),
		summary: {
			overallScore,
			queryCount: queryRows.length,
			competitorCount: competitorRows.length,
			totalResponses,
			models,
			modelOwners,
			modelOwnerMap,
			modelOwnerStats,
			modelStats: modelStatsSummary.modelStats,
			tokenTotals: modelStatsSummary.tokenTotals,
			durationTotals: modelStatsSummary.durationTotals,
			runMonth: latestRun.run_month,
			webSearchEnabled: latestRun.web_search_enabled ? "yes" : "no",
			windowStartUtc: latestRun.started_at,
			windowEndUtc: latestRun.ended_at,
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

function underTheHoodEmptySummary(
	config: BenchmarkConfig,
): UnderTheHoodResponse["summary"] {
	return {
		overallScore: 0,
		queryCount: config.queries.length,
		competitorCount: config.competitors.length,
		totalResponses: 0,
		models: [],
		modelOwners: [],
		modelOwnerMap: {},
		modelOwnerStats: [],
		modelStats: [],
		tokenTotals: {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
		},
		durationTotals: {
			totalDurationMs: 0,
			avgDurationMs: 0,
		},
		runMonth: null,
		webSearchEnabled: null,
		windowStartUtc: null,
		windowEndUtc: null,
	};
}

async function fetchUnderTheHoodFromSupabase(
	rangeInput: UnderTheHoodRange = "all",
): Promise<UnderTheHoodResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const range = normalizeUnderTheHoodRange(rangeInput);
	const nowMs = Date.now();
	const nowIso = new Date(nowMs).toISOString();
	const rangeStartMs = rangeStartMsForUnderTheHood(range, nowMs);
	const rangeStartIso =
		rangeStartMs !== null ? new Date(rangeStartMs).toISOString() : null;

	const configResponse = await fetchConfigFromSupabase();
	const config = configResponse.config;

	const runResult = await fetchAllSupabasePages<BenchmarkRunRow>((from, to) => {
		let query = supabase
			.from("benchmark_runs")
			.select(
				"id,run_month,model,run_kind,cohort_tag,web_search_enabled,started_at,ended_at,overall_score,created_at",
			)
			.order("created_at", { ascending: false })
			.range(from, to);

		// Push range filtering into the database to avoid scanning all historical runs.
		if (rangeStartIso) {
			query = query.gte("created_at", rangeStartIso);
		}

		return query;
	});

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return {
				generatedAt: new Date().toISOString(),
				range,
				rangeLabel: rangeLabelForUnderTheHood(range),
				rangeStartUtc: rangeStartIso,
				rangeEndUtc: nowIso,
				summary: underTheHoodEmptySummary(config),
			};
		}
		throw asError(
			runResult.error,
			"Failed to load benchmark_runs for under-the-hood",
		);
	}

	const allRuns = runResult.rows;
	const selectedRuns = allRuns
		.map((run) => {
			const runMs =
				timestampMs(run.created_at) ??
				timestampMs(run.started_at) ??
				timestampMs(run.ended_at);
			return {
				run,
				runMs,
			};
		})
		.filter((entry) => {
			if (rangeStartMs === null) return true;
			if (entry.runMs === null) return false;
			return entry.runMs >= rangeStartMs && entry.runMs <= nowMs;
		})
		.sort((left, right) => {
			const leftMs = left.runMs ?? 0;
			const rightMs = right.runMs ?? 0;
			return rightMs - leftMs;
		});

	if (selectedRuns.length === 0) {
		return {
			generatedAt: new Date().toISOString(),
			range,
			rangeLabel: rangeLabelForUnderTheHood(range),
			rangeStartUtc: rangeStartIso,
			rangeEndUtc: nowIso,
			summary: underTheHoodEmptySummary(config),
		};
	}

	const selectedRunRows = selectedRuns.map((entry) => entry.run);
	const selectedRunIds = selectedRunRows.map((run) => run.id);
	const responseRows: BenchmarkResponseRow[] = [];

	const runChunkSize = 100;
	for (let index = 0; index < selectedRunIds.length; index += runChunkSize) {
		const runIdChunk = selectedRunIds.slice(index, index + runChunkSize);
		let responseOffset = 0;

		while (true) {
			const responseResultWithStats = await supabase
				.from("benchmark_responses")
				.select(
					"id,query_id,run_iteration,model,provider,model_owner,web_search_enabled,error,duration_ms,prompt_tokens,completion_tokens,total_tokens",
				)
				.in("run_id", runIdChunk)
				.order("id", { ascending: true })
				.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);

			let responseError = responseResultWithStats.error;
			let pageRows = (responseResultWithStats.data ??
				[]) as BenchmarkResponseRow[];

			if (responseError && isMissingColumn(responseError)) {
				const responseResultFallback = await supabase
					.from("benchmark_responses")
					.select("id,query_id,run_iteration,model,web_search_enabled,error")
					.in("run_id", runIdChunk)
					.order("id", { ascending: true })
					.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);
				responseError = responseResultFallback.error;
				pageRows = (
					(responseResultFallback.data ?? []) as BenchmarkResponseRow[]
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
					return {
						generatedAt: new Date().toISOString(),
						range,
						rangeLabel: rangeLabelForUnderTheHood(range),
						rangeStartUtc: rangeStartIso,
						rangeEndUtc: nowIso,
						summary: underTheHoodEmptySummary(config),
					};
				}
				throw asError(
					responseError,
					"Failed to load benchmark_responses for under-the-hood",
				);
			}

			if (pageRows.length === 0) {
				break;
			}

			responseRows.push(...pageRows);
			responseOffset += pageRows.length;
		}
	}

	const modelStatsSummary = buildModelStatsFromResponses(responseRows);
	const models = [
		...new Set(responseRows.map((row) => row.model).filter(Boolean)),
	];
	const { modelOwners, modelOwnerMap } =
		buildModelOwnerSummaryFromModels(models);
	const modelOwnerStats = buildModelOwnerStatsFromResponses(responseRows);

	const runTimestamps = selectedRunRows
		.map((run) => pickTimestamp(run.started_at, run.created_at, run.ended_at))
		.filter((value): value is string => Boolean(toValidTimestamp(value)))
		.sort((left, right) => Date.parse(left) - Date.parse(right));

	const latestRun = selectedRunRows[0] ?? null;
	const webSearchStates = new Set(
		selectedRunRows.map((run) => Boolean(run.web_search_enabled)),
	);
	const webSearchEnabled =
		webSearchStates.size === 0
			? null
			: webSearchStates.size === 1
				? webSearchStates.has(true)
					? "yes"
					: "no"
				: "mixed";

	return {
		generatedAt: new Date().toISOString(),
		range,
		rangeLabel: rangeLabelForUnderTheHood(range),
		rangeStartUtc: rangeStartIso,
		rangeEndUtc: nowIso,
		summary: {
			overallScore: Number((latestRun?.overall_score ?? 0).toFixed(2)),
			queryCount: config.queries.length,
			competitorCount: config.competitors.length,
			totalResponses: responseRows.length,
			models,
			modelOwners,
			modelOwnerMap,
			modelOwnerStats,
			modelStats: modelStatsSummary.modelStats,
			tokenTotals: modelStatsSummary.tokenTotals,
			durationTotals: modelStatsSummary.durationTotals,
			runMonth: latestRun?.run_month ?? null,
			webSearchEnabled,
			windowStartUtc: runTimestamps[0] ?? null,
			windowEndUtc: runTimestamps.at(-1) ?? null,
		},
	};
}

async function fetchRunCostsFromSupabase(
	limit = 30,
): Promise<BenchmarkRunCostsResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const clampedLimit = Math.max(1, Math.min(200, Math.round(limit)));
	const runResult = await supabase
		.from("benchmark_runs")
		.select(
			"id,run_month,run_kind,cohort_tag,created_at,started_at,ended_at,web_search_enabled",
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
			"Failed to load benchmark_runs for run costs",
		);
	}

	const runRows = (runResult.data ?? []) as Array<{
		id: string;
		run_month: string | null;
		run_kind?: "full" | "cohort" | null;
		cohort_tag?: string | null;
		created_at: string | null;
		started_at: string | null;
		ended_at: string | null;
		web_search_enabled: boolean | null;
	}>;

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

	const runIds = runRows.map((run) => run.id);
	const responseRows: RunCostResponseRow[] = [];
	const runChunkSize = 100;

	for (let index = 0; index < runIds.length; index += runChunkSize) {
		const runIdChunk = runIds.slice(index, index + runChunkSize);
		let responseOffset = 0;

		while (true) {
			const responseResultWithStats = await supabase
				.from("benchmark_responses")
				.select("id,run_id,model,prompt_tokens,completion_tokens,total_tokens")
				.in("run_id", runIdChunk)
				.order("id", { ascending: true })
				.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);

			let responseError = responseResultWithStats.error;
			let pageRows = (responseResultWithStats.data ??
				[]) as RunCostResponseRow[];

			if (responseError && isMissingColumn(responseError)) {
				const responseResultFallback = await supabase
					.from("benchmark_responses")
					.select("id,run_id,model")
					.in("run_id", runIdChunk)
					.order("id", { ascending: true })
					.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);
				responseError = responseResultFallback.error;
				pageRows = (
					(responseResultFallback.data ?? []) as RunCostResponseRow[]
				).map((row) => ({
					...row,
					prompt_tokens: 0,
					completion_tokens: 0,
					total_tokens: 0,
				}));
			}

			if (responseError) {
				if (isMissingRelation(responseError)) {
					break;
				}
				throw asError(
					responseError,
					"Failed to load benchmark_responses for run costs",
				);
			}

			if (pageRows.length === 0) {
				break;
			}

			responseRows.push(...pageRows);
			responseOffset += pageRows.length;
		}
	}

	const responsesByRunId = new Map<string, RunCostResponseRow[]>();
	for (const response of responseRows) {
		const bucket = responsesByRunId.get(response.run_id) ?? [];
		bucket.push(response);
		responsesByRunId.set(response.run_id, bucket);
	}

	const runs = runRows.map((run) => {
		const runResponses = responsesByRunId.get(run.id) ?? [];
		const modelSet = new Set<string>();
		const unpricedModelSet = new Set<string>();

		let inputTokens = 0;
		let outputTokens = 0;
		let totalTokens = 0;
		let pricedResponseCount = 0;
		let estimatedInputCostUsd = 0;
		let estimatedOutputCostUsd = 0;
		let estimatedTotalCostUsd = 0;

		for (const response of runResponses) {
			modelSet.add(response.model);
			const responseInputTokens = safeTokenInt(response.prompt_tokens);
			const responseOutputTokens = safeTokenInt(response.completion_tokens);
			const responseTotalTokens =
				safeTokenInt(response.total_tokens) ||
				responseInputTokens + responseOutputTokens;
			inputTokens += responseInputTokens;
			outputTokens += responseOutputTokens;
			totalTokens += responseTotalTokens;

			const costs = estimateResponseCostUsd(
				response.model,
				responseInputTokens,
				responseOutputTokens,
			);
			estimatedInputCostUsd += costs.inputCostUsd;
			estimatedOutputCostUsd += costs.outputCostUsd;
			estimatedTotalCostUsd += costs.totalCostUsd;
			if (costs.priced) {
				pricedResponseCount += 1;
			} else {
				unpricedModelSet.add(response.model);
			}
		}

		return {
			runId: run.id,
			runMonth: run.run_month,
			runKind: run.run_kind ?? "full",
			cohortTag: run.cohort_tag ?? null,
			createdAt: run.created_at,
			startedAt: run.started_at,
			endedAt: run.ended_at,
			webSearchEnabled: run.web_search_enabled,
			responseCount: runResponses.length,
			uniquePrompts: 0,
			models: [...modelSet].sort((left, right) => left.localeCompare(right)),
			inputTokens,
			outputTokens,
			totalTokens,
			pricedResponseCount,
			unpricedModels: [...unpricedModelSet].sort((left, right) =>
				left.localeCompare(right),
			),
			estimatedInputCostUsd: Number(estimatedInputCostUsd.toFixed(6)),
			estimatedOutputCostUsd: Number(estimatedOutputCostUsd.toFixed(6)),
			estimatedTotalCostUsd: Number(estimatedTotalCostUsd.toFixed(6)),
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
			estimatedInputCostUsd: Number(totals.estimatedInputCostUsd.toFixed(6)),
			estimatedOutputCostUsd: Number(totals.estimatedOutputCostUsd.toFixed(6)),
			estimatedTotalCostUsd: Number(totals.estimatedTotalCostUsd.toFixed(6)),
		},
		runs,
	};
}

async function fetchTimeseriesFromSupabase(
	options: TimeSeriesOptions = {},
): Promise<TimeSeriesResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const selectedTags = normalizeSelectedTags(options.tags);
	const selectedProviders = normalizeSelectedProviders(options.providers);
	const selectedProviderSet = new Set(selectedProviders);
	const tagFilterMode: "any" | "all" = options.mode === "all" ? "all" : "any";
	const selectedTagSet = new Set(selectedTags);

	const competitorResult = await supabase
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

	const promptResultWithTags = await supabase
		.from("prompt_queries")
		.select("id,query_text,tags");

	let promptQueryError = promptResultWithTags.error;
	let promptQueryRows = (promptResultWithTags.data ?? []) as Array<{
		id: string;
		query_text: string;
		tags?: string[] | null;
	}>;

	if (promptQueryError && isMissingColumn(promptQueryError)) {
		const fallbackRows = await supabase
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

	const runResult = await supabase
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

	const runRows = (runResult.data ?? []) as TimeSeriesRunRow[];
	if (runRows.length === 0) {
		return { ok: true, competitors, points: [] };
	}

	const runIds = runRows.map((row) => row.id);
	const responseRows: TimeSeriesResponseRow[] = [];
	const runChunkSize = 100;

	for (let index = 0; index < runIds.length; index += runChunkSize) {
		const runIdChunk = runIds.slice(index, index + runChunkSize);
		let responseOffset = 0;

		while (true) {
			const responseResultWithProvider = await supabase
				.from("benchmark_responses")
				.select("id,run_id,query_id,model,provider,model_owner")
				.in("run_id", runIdChunk)
				.order("id", { ascending: true })
				.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);

			let responseError = responseResultWithProvider.error;
			let pageRows = (responseResultWithProvider.data ??
				[]) as TimeSeriesResponseRow[];

			if (responseError && isMissingColumn(responseError)) {
				const responseResultFallback = await supabase
					.from("benchmark_responses")
					.select("id,run_id,query_id,model")
					.in("run_id", runIdChunk)
					.order("id", { ascending: true })
					.range(responseOffset, responseOffset + SUPABASE_PAGE_SIZE - 1);
				responseError = responseResultFallback.error;
				pageRows = (
					(responseResultFallback.data ?? []) as TimeSeriesResponseRow[]
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

	const mentionRows: ResponseMentionRow[] = [];
	const responseChunkSize = SUPABASE_IN_CLAUSE_CHUNK_SIZE;
	for (let index = 0; index < responseIds.length; index += responseChunkSize) {
		const responseChunk = responseIds.slice(index, index + responseChunkSize);
		let mentionOffset = 0;

		while (true) {
			const mentionResult = await supabase
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

			const pageRows = (mentionResult.data ?? []) as ResponseMentionRow[];
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

		let runMentions = mentionsByRun.get(runId);
		if (!runMentions) {
			runMentions = new Map<string, number>();
			mentionsByRun.set(runId, runMentions);
		}
		runMentions.set(
			mention.competitor_id,
			(runMentions.get(mention.competitor_id) ?? 0) + 1,
		);
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
			// `overall_score` is global per run, not tag- or provider-scoped. When segmentation
			// is active we must use the derived value from filtered mentions.
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
				aiVisibilityScore: Number(
					(storedAiVisibility ?? derivedAiVisibility).toFixed(2),
				),
				combviPct: Number(combviPct.toFixed(2)),
				rates: Object.fromEntries(
					competitorRows.map((competitor) => {
						const mentions = runMentions?.get(competitor.id) ?? 0;
						const mentionRatePct = total > 0 ? (mentions / total) * 100 : 0;
						return [competitor.name, Number(mentionRatePct.toFixed(2))];
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

function roundTo(value: number, decimals = 2): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function hasRunResponses(responseCount: unknown): boolean {
	return Math.max(0, Math.round(toFiniteNumber(responseCount))) > 0;
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

function resolveRunModels(row: MvRunSummaryRow): string[] {
	if (Array.isArray(row.models)) {
		const fromArray = parseCsvList(row.models);
		if (fromArray.length > 0) return fromArray;
	}

	const fromCsv = parseCsvList(row.models_csv);
	if (fromCsv.length > 0) return fromCsv;
	return parseCsvList(row.model);
}

function resolveRunModelOwners(row: MvRunSummaryRow): string[] {
	if (Array.isArray(row.model_owners)) {
		const fromArray = parseCsvList(row.model_owners);
		if (fromArray.length > 0) return fromArray;
	}
	return parseCsvList(row.model_owners_csv);
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
	modelOwnerStats: ModelOwnerStat[];
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
				Math.round(toFiniteNumber(row.response_count)),
			);
			const successCount = Math.max(
				0,
				Math.round(toFiniteNumber(row.success_count)),
			);
			const failureCount = Math.max(
				0,
				Math.round(toFiniteNumber(row.failure_count)),
			);
			const webSearchEnabledCount = Math.max(
				0,
				Math.round(toFiniteNumber(row.web_search_enabled_count)),
			);
			const modelTotalDurationMs = Math.max(
				0,
				Math.round(toFiniteNumber(row.total_duration_ms)),
			);
			const modelInputTokens = Math.max(
				0,
				Math.round(toFiniteNumber(row.total_input_tokens)),
			);
			const modelOutputTokens = Math.max(
				0,
				Math.round(toFiniteNumber(row.total_output_tokens)),
			);
			const modelTotalTokens = Math.max(
				0,
				Math.round(toFiniteNumber(row.total_tokens)),
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
				avgDurationMs: roundTo(toFiniteNumber(row.avg_duration_ms), 2),
				p95DurationMs: roundTo(toFiniteNumber(row.p95_duration_ms), 2),
				totalInputTokens: modelInputTokens,
				totalOutputTokens: modelOutputTokens,
				totalTokens: modelTotalTokens,
				avgInputTokens: roundTo(toFiniteNumber(row.avg_input_tokens), 2),
				avgOutputTokens: roundTo(toFiniteNumber(row.avg_output_tokens), 2),
				avgTotalTokens: roundTo(toFiniteNumber(row.avg_total_tokens), 2),
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
	if (!supabase || runIds.length === 0) {
		return [];
	}

	const rows: MvModelPerformanceRow[] = [];
	const chunkSize = 100;
	for (let index = 0; index < runIds.length; index += chunkSize) {
		const runIdChunk = runIds.slice(index, index + chunkSize);
		let offset = 0;
		while (true) {
			const result = await supabase
				.from("mv_model_performance")
				.select(
					"run_id,model,owner,response_count,success_count,failure_count,web_search_enabled_count,total_duration_ms,avg_duration_ms,p95_duration_ms,total_input_tokens,total_output_tokens,total_tokens,avg_input_tokens,avg_output_tokens,avg_total_tokens,created_at",
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
	if (!supabase || runIds.length === 0) {
		return [];
	}

	const rows: MvCompetitorMentionRateRow[] = [];
	const chunkSize = 100;
	for (let index = 0; index < runIds.length; index += chunkSize) {
		const runIdChunk = runIds.slice(index, index + chunkSize);
		let offset = 0;
		while (true) {
			let query = supabase
				.from("mv_competitor_mention_rates")
				.select(
					"run_id,query_id,query_key,query_text,competitor_id,entity,entity_key,is_highcharts,is_overall_row,response_count,input_tokens,output_tokens,total_tokens,total_duration_ms,mentions_count,mentions_rate_pct,share_of_voice_rate_pct,created_at",
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
	if (!supabase || queryIds.length === 0) {
		return runsByQuery;
	}

	let offset = 0;
	while (true) {
		const result = await supabase
			.from("mv_competitor_mention_rates")
			.select("run_id,query_id")
			.eq("is_overall_row", false)
			.in("query_id", queryIds)
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

	return runsByQuery;
}

function emptyCompetitorBlogsResponse(): CompetitorBlogsResponse {
	return {
		generatedAt: new Date().toISOString(),
		totalPosts: 0,
		sourceTotals: [],
		typeTotals: [],
		posts: [],
		timeline: [],
	};
}

async function fetchCompetitorBlogsFromSupabase(
	limit = 500,
): Promise<CompetitorBlogsResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const clampedLimit = Math.max(1, Math.min(limit, 1000));
	const result = await supabase
		.from("competitor_blog_posts")
		.select(
			"id,source,source_slug,title,content_theme,description,author,link,publish_date,published_at,created_at",
		)
		.order("publish_date", { ascending: false, nullsFirst: false })
		.order("published_at", { ascending: false, nullsFirst: false })
		.order("created_at", { ascending: false })
		.limit(clampedLimit);

	if (result.error) {
		if (isMissingRelation(result.error)) {
			return emptyCompetitorBlogsResponse();
		}
		throw asError(
			result.error,
			"Failed to load competitor_blog_posts from Supabase",
		);
	}

	const rows = (result.data ?? []) as CompetitorBlogPostRow[];
	if (rows.length === 0) {
		return emptyCompetitorBlogsResponse();
	}

	const posts = rows
		.filter((row) => {
			const title = String(row.title ?? "").trim();
			const link = String(row.link ?? "").trim();
			return Boolean(title && link);
		})
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
				id: row.id,
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
		if (!monthKey) {
			continue;
		}

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

	const sortedSourceTotals = [...sourceTotals.values()].sort((left, right) => {
		if (right.count !== left.count) return right.count - left.count;
		return left.source.localeCompare(right.source);
	});

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

	return {
		generatedAt: new Date().toISOString(),
		totalPosts: posts.length,
		sourceTotals: sortedSourceTotals,
		typeTotals: [...typeTotals.entries()]
			.map(([type, count]) => ({ type, count }))
			.sort((left, right) => {
				if (right.count !== left.count) return right.count - left.count;
				return left.type.localeCompare(right.type);
			}),
		posts,
		timeline,
	};
}

async function fetchPromptDrilldownFromSupabase(
	queryText: string,
): Promise<PromptDrilldownResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const query = queryText.trim();
	if (!query) {
		throw new Error("Prompt query is required.");
	}

	const promptResult = await supabase
		.from("prompt_queries")
		.select("id,query_text,sort_order,is_active,created_at,updated_at")
		.eq("query_text", query)
		.limit(1);

	if (promptResult.error) {
		throw asError(
			promptResult.error,
			"Failed to load prompt details from Supabase",
		);
	}

	const prompt = ((promptResult.data ?? [])[0] ??
		null) as PromptDrilldownPromptRow | null;
	if (!prompt) {
		throw new Error(`Prompt not found: ${query}`);
	}

	const competitorResult = await supabase
		.from("competitors")
		.select("id,name,slug,is_primary,sort_order,is_active")
		.order("sort_order", { ascending: true });

	if (competitorResult.error) {
		throw asError(
			competitorResult.error,
			"Failed to load competitors for prompt drilldown",
		);
	}

	const competitors = (competitorResult.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
		is_active: boolean;
	}>;

	const responseResultWithStats = await supabase
		.from("benchmark_responses")
		.select(
			"id,run_id,run_iteration,model,provider,model_owner,web_search_enabled,response_text,citations,error,created_at,duration_ms,prompt_tokens,completion_tokens,total_tokens",
		)
		.eq("query_id", prompt.id)
		.order("created_at", { ascending: false })
		.limit(500);

	let responseRowsError = responseResultWithStats.error;
	let responseRows = (responseResultWithStats.data ??
		[]) as PromptDrilldownResponseRow[];

	if (responseRowsError && isMissingColumn(responseRowsError)) {
		const responseResultFallback = await supabase
			.from("benchmark_responses")
			.select(
				"id,run_id,run_iteration,model,web_search_enabled,response_text,citations,error,created_at",
			)
			.eq("query_id", prompt.id)
			.order("created_at", { ascending: false })
			.limit(500);
		responseRowsError = responseResultFallback.error;
		responseRows = (
			(responseResultFallback.data ?? []) as PromptDrilldownResponseRow[]
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
			return {
				generatedAt: new Date().toISOString(),
				prompt: {
					id: prompt.id,
					query: prompt.query_text,
					sortOrder: prompt.sort_order,
					isPaused: !prompt.is_active,
					createdAt: prompt.created_at,
					updatedAt: prompt.updated_at,
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
			};
		}
		throw asError(
			responseRowsError,
			"Failed to load prompt responses from Supabase",
		);
	}

	const responses = responseRows;
	const responseIds = responses.map((row) => row.id);
	const runIds = [...new Set(responses.map((row) => row.run_id))];

	const runRows: PromptDrilldownRunRow[] = [];
	if (runIds.length > 0) {
		const runResult = await supabase
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
			runRows.push(...((runResult.data ?? []) as PromptDrilldownRunRow[]));
		}
	}

	const mentionRows: ResponseMentionRow[] = [];
	if (responseIds.length > 0) {
		let mentionsTableMissing = false;
		for (
			let index = 0;
			index < responseIds.length;
			index += SUPABASE_IN_CLAUSE_CHUNK_SIZE
		) {
			if (mentionsTableMissing) {
				break;
			}
			const chunk = responseIds.slice(
				index,
				index + SUPABASE_IN_CLAUSE_CHUNK_SIZE,
			);
			let mentionOffset = 0;

			while (true) {
				const mentionResult = await supabase
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
						"Failed to load prompt mentions from Supabase",
					);
				}

				const pageRows = (mentionResult.data ?? []) as ResponseMentionRow[];
				if (pageRows.length === 0) {
					break;
				}

				mentionRows.push(...pageRows);
				mentionOffset += pageRows.length;
			}
		}
	}

	const runById = new Map(runRows.map((row) => [row.id, row]));
	const competitorById = new Map(competitors.map((row) => [row.id, row]));
	const mentionsByResponse = new Map<number, Set<string>>();

	for (const mention of mentionRows) {
		if (!mention.mentioned) continue;
		let bucket = mentionsByResponse.get(mention.response_id);
		if (!bucket) {
			bucket = new Set<string>();
			mentionsByResponse.set(mention.response_id, bucket);
		}
		bucket.add(mention.competitor_id);
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
		(row) => row.is_active || mentionCountByCompetitor.has(row.id),
	);
	const primaryCompetitor =
		visibleCompetitors.find((row) => row.is_primary) ??
		visibleCompetitors.find((row) => row.slug === "highcharts") ??
		null;

	const totalResponses = responses.length;
	const competitorStats = visibleCompetitors.map((competitor) => {
		const mentionCount = mentionCountByCompetitor.get(competitor.id) ?? 0;
		const mentionRatePct =
			totalResponses > 0 ? (mentionCount / totalResponses) * 100 : 0;
		const isHighcharts = primaryCompetitor
			? competitor.id === primaryCompetitor.id
			: competitor.slug === "highcharts";

		return {
			id: competitor.id,
			entity: competitor.name,
			entityKey: competitor.slug,
			isHighcharts,
			isActive: competitor.is_active,
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
		competitorStats.find((entry) => entry.isHighcharts)?.mentionRatePct ?? 0;
	const rivalMentionCount = rivalStats.reduce(
		(sum, row) => sum + row.mentionCount,
		0,
	);
	const viabilityDenominator = totalResponses * rivalStats.length;
	const viabilityRatePct =
		viabilityDenominator > 0
			? Number(((rivalMentionCount / viabilityDenominator) * 100).toFixed(2))
			: 0;

	const responsesByRun = new Map<string, PromptDrilldownResponseRow[]>();
	for (const response of responses) {
		const bucket = responsesByRun.get(response.run_id) ?? [];
		bucket.push(response);
		responsesByRun.set(response.run_id, bucket);
	}

	const runPoints = Array.from(responsesByRun.entries())
		.map(([runId, runResponses]) => {
			const run = runById.get(runId);
			const mentionCountByCompetitorForRun = new Map<string, number>();

			for (const response of runResponses) {
				const mentionSet = mentionsByResponse.get(response.id);
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
						mentionCountByCompetitorForRun.get(competitor.id) ?? 0;
					const pct = runTotal > 0 ? (mentions / runTotal) * 100 : 0;
					return [competitor.entity, Number(pct.toFixed(2))];
				}),
			);

			const runHighchartsCount = primaryCompetitor
				? (mentionCountByCompetitorForRun.get(primaryCompetitor.id) ?? 0)
				: 0;
			const runHighchartsRate =
				runTotal > 0 ? (runHighchartsCount / runTotal) * 100 : 0;

			const runRivals = competitorStats.filter(
				(competitor) => !competitor.isHighcharts,
			);
			const runRivalMentionCount = runRivals.reduce(
				(sum, competitor) =>
					sum + (mentionCountByCompetitorForRun.get(competitor.id) ?? 0),
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
							mentionCountByCompetitorForRun.get(competitor.id) ?? 0;
						const ratePct = runTotal > 0 ? (mentions / runTotal) * 100 : 0;
						return {
							entity: competitor.entity,
							ratePct: Number(ratePct.toFixed(2)),
						};
					})
					.sort((left, right) => right.ratePct - left.ratePct)
					.at(0) ?? null;

			const firstResponseTimestamp = runResponses
				.map((response) => response.created_at)
				.find((value) => Boolean(toValidTimestamp(value)));
			const fallbackRunMonthTimestamp =
				run?.run_month && /^\d{4}-\d{2}$/.test(run.run_month)
					? `${run.run_month}-01T12:00:00Z`
					: null;
			const timestamp =
				pickTimestamp(
					run?.created_at,
					run?.started_at,
					firstResponseTimestamp,
					fallbackRunMonthTimestamp,
				) ?? new Date().toISOString();

			return {
				runId,
				runMonth: run?.run_month ?? null,
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
			(left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
		);

	const responseItems = responses.map((response) => {
		const run = runById.get(response.run_id);
		const mentionIds = [
			...(mentionsByResponse.get(response.id) ?? new Set<string>()),
		];
		const mentions = mentionIds
			.map((id) => competitorById.get(id)?.name)
			.filter((name): name is string => Boolean(name))
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
			id: response.id,
			runId: response.run_id,
			runMonth: run?.run_month ?? null,
			runCreatedAt: pickTimestamp(run?.created_at, run?.started_at),
			createdAt: response.created_at,
			runIteration: response.run_iteration,
			model: response.model,
			provider: response.provider ?? null,
			modelOwner:
				response.model_owner ?? inferModelOwnerFromModel(response.model),
			webSearchEnabled: response.web_search_enabled,
			error: response.error,
			durationMs: Math.max(0, Math.round(Number(response.duration_ms ?? 0))),
			promptTokens: Math.max(
				0,
				Math.round(Number(response.prompt_tokens ?? 0)),
			),
			completionTokens: Math.max(
				0,
				Math.round(Number(response.completion_tokens ?? 0)),
			),
			totalTokens: Math.max(
				0,
				Math.round(Number(response.total_tokens ?? 0)) ||
					Math.round(
						Number(response.prompt_tokens ?? 0) +
							Number(response.completion_tokens ?? 0),
					),
			),
			responseText: response.response_text ?? "",
			citationRefs,
			citations:
				citations.length > 0
					? citations
					: normalizeCitations(response.citations, citationProvider),
			mentions,
		};
	});

	const lastRunAt =
		runPoints.length > 0 ? runPoints[runPoints.length - 1].timestamp : null;

	return {
		generatedAt: new Date().toISOString(),
		prompt: {
			id: prompt.id,
			query: prompt.query_text,
			sortOrder: prompt.sort_order,
			isPaused: !prompt.is_active,
			createdAt: prompt.created_at,
			updatedAt: prompt.updated_at,
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
			lastRunAt,
		},
		competitors: competitorStats.sort(
			(left, right) => right.mentionRatePct - left.mentionRatePct,
		),
		runPoints,
		responses: responseItems,
	};
}

async function fetchDashboardFromSupabaseViews(): Promise<DashboardResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const configResponse = await fetchConfigFromSupabase();
	const config = configResponse.config;

	const queryResultWithTags = await fetchAllSupabasePages<PromptQueryRow>(
		(from, to) =>
			supabase
				.from("prompt_queries")
				.select("id,query_text,sort_order,is_active,tags")
				.order("sort_order", { ascending: true })
				.range(from, to),
	);

	let queryRowsError = queryResultWithTags.error;
	let queryRows = queryResultWithTags.rows;
	if (queryRowsError && isMissingColumn(queryRowsError)) {
		const fallbackRows = await fetchAllSupabasePages<PromptQueryRow>(
			(from, to) =>
				supabase
					.from("prompt_queries")
					.select("id,query_text,sort_order,is_active")
					.order("sort_order", { ascending: true })
					.range(from, to),
		);
		queryRowsError = fallbackRows.error;
		queryRows = fallbackRows.rows.map((row) => ({ ...row, tags: null }));
	}
	if (queryRowsError) {
		throw asError(
			queryRowsError,
			"Failed to load prompt metadata for dashboard",
		);
	}

	const competitorResult = await supabase
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

	const runResult = await fetchAllSupabasePages<MvRunSummaryRow>((from, to) => {
		return supabase
			.from("mv_run_summary")
			.select(
				"run_id,run_month,model,run_kind,cohort_tag,models,models_csv,model_owners,model_owners_csv,model_owner_map,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,competitor_count,input_tokens,output_tokens,total_tokens,total_duration_ms,avg_duration_ms",
			)
			.order("created_at", { ascending: false })
			.range(from, to);
	});

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return emptyDashboard(config);
		}
		throw asError(
			runResult.error,
			"Failed to load mv_run_summary for dashboard",
		);
	}

	const selectedRuns = runResult.rows;
	const latestRun = selectDashboardRun(selectedRuns);
	if (!latestRun || selectedRuns.length === 0) {
		return emptyDashboard(config);
	}

	const runIds = selectedRuns.map((run) => run.run_id);
	const allQueryRows = queryRows as Array<{
		id: string;
		query_text: string;
		sort_order: number;
		is_active: boolean;
		tags?: string[] | null;
	}>;
	const competitorRows = (competitorResult.data ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
		is_primary: boolean;
		sort_order: number;
	}>;

	const [mentionRows, modelRows, historicalRunsByQuery] = await Promise.all([
		fetchMentionRateRowsByRunIds(runIds),
		fetchModelPerformanceRowsByRunIds(runIds),
		fetchHistoricalRunsByQueryIds(allQueryRows.map((row) => row.id)),
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
	const ownerMapFromRun = parseModelOwnerMap(latestRun.model_owner_map);
	const modelOwnerMap =
		Object.keys(modelSummary.modelOwnerMap).length > 0
			? modelSummary.modelOwnerMap
			: ownerMapFromRun;

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
			Math.round(toFiniteNumber(row.total_input_tokens)),
		);
		const outputTokens = Math.max(
			0,
			Math.round(toFiniteNumber(row.total_output_tokens)),
		);
		const costs = estimateResponseCostUsd(model, inputTokens, outputTokens);
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
		.filter((value): value is string => Boolean(toValidTimestamp(value)))
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
			totals.responses += Math.max(
				0,
				Math.round(toFiniteNumber(run.response_count)),
			);
			totals.inputTokens += Math.max(
				0,
				Math.round(toFiniteNumber(run.input_tokens)),
			);
			totals.outputTokens += Math.max(
				0,
				Math.round(toFiniteNumber(run.output_tokens)),
			);
			totals.totalTokens += Math.max(
				0,
				Math.round(toFiniteNumber(run.total_tokens)),
			);
			totals.totalDurationMs += Math.max(
				0,
				Math.round(toFiniteNumber(run.total_duration_ms)),
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
		const mentions = Math.max(
			0,
			Math.round(toFiniteNumber(row.mentions_count)),
		);

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
				Math.max(0, Math.round(toFiniteNumber(row.response_count))),
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
			Math.max(0, Math.round(toFiniteNumber(row.input_tokens))),
		);
		tokenBucket.output = Math.max(
			tokenBucket.output,
			Math.max(0, Math.round(toFiniteNumber(row.output_tokens))),
		);
		tokenBucket.total = Math.max(
			tokenBucket.total,
			Math.max(0, Math.round(toFiniteNumber(row.total_tokens))),
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

	const promptStatus = allQueryRows.map((queryRow) => {
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
		const isDeleted = hasDeletedPromptTag(queryRow.tags);
		const runs = historicalRunsByQuery.get(queryRow.id)?.size ?? 0;
		const status: PromptStatus["status"] = isDeleted
			? "deleted"
			: runs > 0
				? "tracked"
				: "awaiting_run";

		return {
			query: queryRow.query_text,
			tags: normalizePromptTagsForStatus(queryRow.tags, queryRow.query_text),
			isPaused: !isDeleted && !queryRow.is_active,
			status,
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

	const kpi: KpiRow = {
		metric_name: "AI Visibility Overall",
		ai_visibility_overall_score: overallScore,
		score_scale: "0-100",
		queries_count: String(allQueryRows.length),
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
			queryCount: allQueryRows.length,
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

async function fetchUnderTheHoodFromSupabaseViews(
	rangeInput: UnderTheHoodRange = "all",
): Promise<UnderTheHoodResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const range = normalizeUnderTheHoodRange(rangeInput);
	const nowMs = Date.now();
	const nowIso = new Date(nowMs).toISOString();
	const rangeStartMs = rangeStartMsForUnderTheHood(range, nowMs);
	const rangeStartIso =
		rangeStartMs !== null ? new Date(rangeStartMs).toISOString() : null;

	const configResponse = await fetchConfigFromSupabase();
	const config = configResponse.config;

	const runResult = await fetchAllSupabasePages<MvRunSummaryRow>((from, to) => {
		let query = supabase
			.from("mv_run_summary")
			.select(
				"run_id,run_month,model,run_kind,cohort_tag,models,models_csv,model_owners,model_owners_csv,model_owner_map,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,competitor_count,input_tokens,output_tokens,total_tokens,total_duration_ms,avg_duration_ms",
			)
			.order("created_at", { ascending: false })
			.range(from, to);
		if (rangeStartIso) {
			query = query.gte("created_at", rangeStartIso);
		}
		return query;
	});

	if (runResult.error) {
		if (isMissingRelation(runResult.error)) {
			return {
				generatedAt: new Date().toISOString(),
				range,
				rangeLabel: rangeLabelForUnderTheHood(range),
				rangeStartUtc: rangeStartIso,
				rangeEndUtc: nowIso,
				summary: underTheHoodEmptySummary(config),
			};
		}
		throw asError(
			runResult.error,
			"Failed to load mv_run_summary for under-the-hood",
		);
	}

	const selectedRuns = runResult.rows
		.map((run) => ({
			run,
			runMs:
				timestampMs(run.created_at) ??
				timestampMs(run.started_at) ??
				timestampMs(run.ended_at),
		}))
		.filter((entry) => {
			if (rangeStartMs === null) return true;
			if (entry.runMs === null) return false;
			return entry.runMs >= rangeStartMs && entry.runMs <= nowMs;
		})
		.sort((left, right) => (right.runMs ?? 0) - (left.runMs ?? 0))
		.map((entry) => entry.run);

	if (selectedRuns.length === 0) {
		return {
			generatedAt: new Date().toISOString(),
			range,
			rangeLabel: rangeLabelForUnderTheHood(range),
			rangeStartUtc: rangeStartIso,
			rangeEndUtc: nowIso,
			summary: underTheHoodEmptySummary(config),
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
		.filter((value): value is string => Boolean(toValidTimestamp(value)))
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
			totals.responses += Math.max(
				0,
				Math.round(toFiniteNumber(run.response_count)),
			);
			totals.inputTokens += Math.max(
				0,
				Math.round(toFiniteNumber(run.input_tokens)),
			);
			totals.outputTokens += Math.max(
				0,
				Math.round(toFiniteNumber(run.output_tokens)),
			);
			totals.totalTokens += Math.max(
				0,
				Math.round(toFiniteNumber(run.total_tokens)),
			);
			totals.totalDurationMs += Math.max(
				0,
				Math.round(toFiniteNumber(run.total_duration_ms)),
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
			overallScore: roundTo(toFiniteNumber(latestRun.overall_score), 2),
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

async function fetchRunCostsFromSupabaseViews(
	limit = 30,
): Promise<BenchmarkRunCostsResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const clampedLimit = Math.max(1, Math.min(200, Math.round(limit)));
	const runResult = await supabase
		.from("mv_run_summary")
		.select(
			"run_id,run_month,model,run_kind,cohort_tag,models,models_csv,web_search_enabled,overall_score,created_at,started_at,ended_at,response_count,query_count,input_tokens,output_tokens,total_tokens",
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
				Math.round(toFiniteNumber(row.total_input_tokens)),
			);
			const outputTokens = Math.max(
				0,
				Math.round(toFiniteNumber(row.total_output_tokens)),
			);
			const responseCount = Math.max(
				0,
				Math.round(toFiniteNumber(row.response_count)),
			);
			const costs = estimateResponseCostUsd(model, inputTokens, outputTokens);
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
			responseCount: Math.max(
				0,
				Math.round(toFiniteNumber(run.response_count)),
			),
			uniquePrompts: Math.max(0, Math.round(toFiniteNumber(run.query_count))),
			models: resolvedModels,
			inputTokens: Math.max(0, Math.round(toFiniteNumber(run.input_tokens))),
			outputTokens: Math.max(0, Math.round(toFiniteNumber(run.output_tokens))),
			totalTokens: Math.max(0, Math.round(toFiniteNumber(run.total_tokens))),
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

async function fetchTimeseriesFromSupabaseViews(
	options: TimeSeriesOptions = {},
): Promise<TimeSeriesResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const selectedTags = normalizeSelectedTags(options.tags);
	const selectedTagSet = new Set(selectedTags);
	const tagFilterMode: "any" | "all" = options.mode === "all" ? "all" : "any";

	const competitorResult = await supabase
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

	const promptResultWithTags = await supabase
		.from("prompt_queries")
		.select("id,query_text,tags");

	let promptRowsError = promptResultWithTags.error;
	let promptRows = (promptResultWithTags.data ?? []) as Array<{
		id: string;
		query_text: string;
		tags?: string[] | null;
	}>;
	if (promptRowsError && isMissingColumn(promptRowsError)) {
		const fallbackRows = await supabase
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

	const runResult = await supabase
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
	const runMetaById = new Map(runRows.map((row) => [row.run_id, row]));

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
				Math.max(0, Math.round(toFiniteNumber(row.response_count))),
			);
		}
		bucket.mentionsByCompetitor.set(
			row.competitor_id,
			(bucket.mentionsByCompetitor.get(row.competitor_id) ?? 0) +
				Math.max(0, Math.round(toFiniteNumber(row.mentions_count))),
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
				(run.run_month && /^\\d{4}-\\d{2}$/.test(run.run_month)
					? `${run.run_month}-01T12:00:00Z`
					: new Date().toISOString());

			return {
				date: timestamp.slice(0, 10),
				timestamp,
				total,
				aiVisibilityScore:
					selectedTagSet.size === 0 &&
					Number.isFinite(toFiniteNumber(run.overall_score, NaN))
						? roundTo(toFiniteNumber(run.overall_score), 2)
						: roundTo(derivedAiVisibility, 2),
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

async function healthViaSupabase(): Promise<HealthResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const result = await supabase.from("prompt_queries").select("id").limit(1);
	return {
		ok: !result.error,
		repoRoot: "supabase",
	};
}

async function diagnosticsViaSupabase(): Promise<DiagnosticsResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const checks: DiagnosticsCheck[] = [];
	const supabaseHost = new URL(SUPABASE_URL ?? "").hostname;

	checks.push(
		await runCheck("supabase_env", "Supabase environment", async () => ({
			status: "pass",
			details: `Using project ${supabaseHost}`,
		})),
	);

	const tableChecks = await Promise.all([
		runCheck("table_prompt_queries", "prompt_queries table", async () => {
			const result = await supabase
				.from("prompt_queries")
				.select("*", { count: "exact", head: true });
			if (result.error) {
				return {
					status: "fail",
					details: asError(result.error, "Unable to read prompt_queries")
						.message,
				};
			}
			const count = result.count ?? 0;
			if (count < 1) {
				return {
					status: "fail",
					details:
						"No prompt rows found. Add prompts in Configuration or SQL Editor.",
				};
			}
			return { status: "pass", details: `${count} rows available` };
		}),

		runCheck("table_competitors", "competitors table", async () => {
			const result = await supabase
				.from("competitors")
				.select("*", { count: "exact", head: true });
			if (result.error) {
				return {
					status: "fail",
					details: asError(result.error, "Unable to read competitors").message,
				};
			}
			const count = result.count ?? 0;
			if (count < 1) {
				return {
					status: "fail",
					details:
						"No competitors found. Add competitors in Configuration or SQL Editor.",
				};
			}
			return { status: "pass", details: `${count} rows available` };
		}),

		runCheck(
			"table_competitor_aliases",
			"competitor_aliases table",
			async () => {
				const result = await supabase
					.from("competitor_aliases")
					.select("*", { count: "exact", head: true });
				if (result.error) {
					return {
						status: "fail",
						details: asError(result.error, "Unable to read competitor_aliases")
							.message,
					};
				}
				const count = result.count ?? 0;
				if (count < 1) {
					return {
						status: "warn",
						details:
							"No aliases found yet. Optional, but recommended for better mention matching.",
					};
				}
				return { status: "pass", details: `${count} rows available` };
			},
		),

		runCheck("table_benchmark_runs", "benchmark_runs table", async () => {
			const result = await supabase
				.from("benchmark_runs")
				.select("*", { count: "exact", head: true });
			if (result.error) {
				if (isMissingRelation(result.error)) {
					return {
						status: "warn",
						details:
							"Table missing. Run the Supabase schema SQL migration for benchmark tables.",
					};
				}
				return {
					status: "fail",
					details: asError(result.error, "Unable to read benchmark_runs")
						.message,
				};
			}
			const count = result.count ?? 0;
			if (count < 1) {
				return {
					status: "warn",
					details:
						"No benchmark runs yet. Run the benchmark pipeline to populate results.",
				};
			}
			return { status: "pass", details: `${count} rows available` };
		}),

		runCheck(
			"table_benchmark_responses",
			"benchmark_responses table",
			async () => {
				const result = await supabase
					.from("benchmark_responses")
					.select("*", { count: "exact", head: true });
				if (result.error) {
					if (isMissingRelation(result.error)) {
						return {
							status: "warn",
							details:
								"Table missing. Run the Supabase schema SQL migration for benchmark tables.",
						};
					}
					return {
						status: "fail",
						details: asError(result.error, "Unable to read benchmark_responses")
							.message,
					};
				}

				const schemaResult = await supabase
					.from("benchmark_responses")
					.select(
						"id,run_id,query_id,run_iteration,model,provider,model_owner,duration_ms,prompt_tokens,completion_tokens,total_tokens",
						{ head: true },
					)
					.limit(1);
				if (schemaResult.error) {
					if (isMissingColumn(schemaResult.error)) {
						return {
							status: "fail",
							details:
								"benchmark_responses schema is outdated. Apply supabase/sql/006_benchmark_response_model_metrics.sql.",
						};
					}
					if (isMissingRelation(schemaResult.error)) {
						return {
							status: "warn",
							details:
								"Table missing. Run the Supabase schema SQL migration for benchmark tables.",
						};
					}
					return {
						status: "fail",
						details: asError(
							schemaResult.error,
							"Unable to validate benchmark_responses schema",
						).message,
					};
				}

				const count = result.count ?? 0;
				if (count < 1) {
					return {
						status: "warn",
						details:
							"No response rows yet. This fills after the first benchmark run.",
					};
				}
				return { status: "pass", details: `${count} rows available` };
			},
		),

		runCheck("table_response_mentions", "response_mentions table", async () => {
			const result = await supabase
				.from("response_mentions")
				.select("*", { count: "exact", head: true });
			if (result.error) {
				if (isMissingRelation(result.error)) {
					return {
						status: "warn",
						details:
							"Table missing. Run the Supabase schema SQL migration for benchmark tables.",
					};
				}
				return {
					status: "fail",
					details: asError(result.error, "Unable to read response_mentions")
						.message,
				};
			}
			const count = result.count ?? 0;
			if (count < 1) {
				return {
					status: "warn",
					details:
						"No mention rows yet. This fills after the first benchmark run.",
				};
			}
			return { status: "pass", details: `${count} rows available` };
		}),
	]);
	checks.push(...tableChecks);

	checks.push(
		await runCheck(
			"highcharts_primary",
			"Highcharts primary competitor",
			async () => {
				const result = await supabase
					.from("competitors")
					.select("name,slug,is_primary,is_active")
					.eq("is_active", true);

				if (result.error) {
					return {
						status: "fail",
						details: asError(
							result.error,
							"Unable to validate Highcharts competitor",
						).message,
					};
				}

				const rows = (result.data ?? []) as Array<{
					name: string;
					slug: string;
					is_primary: boolean;
					is_active: boolean;
				}>;

				const highcharts =
					rows.find((row) => row.slug === "highcharts") ??
					rows.find((row) => row.name.toLowerCase() === "highcharts");

				if (!highcharts) {
					return {
						status: "fail",
						details: "Highcharts is missing from active competitors.",
					};
				}
				if (!highcharts.is_primary) {
					return {
						status: "warn",
						details: "Highcharts exists but is not marked as primary.",
					};
				}
				return {
					status: "pass",
					details: "Highcharts is active and marked as primary.",
				};
			},
		),
	);

	checks.push(
		await runCheck("latest_run_readiness", "Latest run readiness", async () => {
			const latestRunResult = await supabase
				.from("benchmark_runs")
				.select("id,created_at")
				.order("created_at", { ascending: false })
				.limit(1);

			if (latestRunResult.error) {
				if (isMissingRelation(latestRunResult.error)) {
					return {
						status: "warn",
						details:
							"benchmark_runs table is missing, so no run data can be read yet.",
					};
				}
				return {
					status: "fail",
					details: asError(
						latestRunResult.error,
						"Unable to read latest benchmark run",
					).message,
				};
			}

			const latestRun = (latestRunResult.data ?? [])[0] as
				| { id: string }
				| undefined;
			if (!latestRun) {
				return {
					status: "warn",
					details: "No benchmark run found yet.",
				};
			}

			const responseResult = await supabase
				.from("benchmark_responses")
				.select("*", { count: "exact", head: true })
				.eq("run_id", latestRun.id);

			if (responseResult.error) {
				if (isMissingRelation(responseResult.error)) {
					return {
						status: "warn",
						details:
							"benchmark_responses table missing; run output cannot be displayed yet.",
					};
				}
				return {
					status: "fail",
					details: asError(
						responseResult.error,
						"Unable to read responses for latest run",
					).message,
				};
			}

			const responseCount = responseResult.count ?? 0;
			if (responseCount < 1) {
				return {
					status: "warn",
					details: "Latest run exists but has no benchmark_responses rows.",
				};
			}
			return {
				status: "pass",
				details: `Latest run has ${responseCount} response rows.`,
			};
		}),
	);

	checks.push(
		await runCheck("dashboard_query", "Dashboard query", async () => {
			const dashboard = await fetchDashboardFromSupabaseViews();
			const hasConfig =
				dashboard.summary.queryCount > 0 &&
				dashboard.summary.competitorCount > 0;
			return {
				status: hasConfig ? "pass" : "warn",
				details: `${dashboard.summary.queryCount} queries, ${dashboard.summary.competitorCount} competitors, ${dashboard.summary.totalResponses} responses`,
			};
		}),
	);

	return {
		generatedAt: new Date().toISOString(),
		source: "supabase",
		checks,
	};
}

async function diagnosticsViaApi(): Promise<DiagnosticsResponse> {
	const checks = await Promise.all([
		runCheck("api_health", "API /health", async () => {
			const data = await json<HealthResponse>("/health");
			return {
				status: data.ok ? "pass" : "fail",
				details: data.ok
					? `Healthy (${data.repoRoot})`
					: "Health endpoint returned not ok",
			};
		}),
		runCheck("api_config", "API /config", async () => {
			const data = await json<ConfigResponse>("/config");
			if (
				data.config.queries.length < 1 ||
				data.config.competitors.length < 1
			) {
				return {
					status: "warn",
					details: "Config loaded but queries or competitors are empty.",
				};
			}
			return {
				status: "pass",
				details: `${data.config.queries.length} queries, ${data.config.competitors.length} competitors`,
			};
		}),
		runCheck("api_dashboard", "API /dashboard", async () => {
			const data = await json<DashboardResponse>("/dashboard");
			return {
				status: "pass",
				details: `${data.summary.totalResponses} responses in latest dashboard snapshot`,
			};
		}),
	]);

	return {
		generatedAt: new Date().toISOString(),
		source: "api",
		checks,
	};
}

function mapGapItem(row: Record<string, unknown>): ContentGapItem {
	const evidenceCitations = Array.isArray(row.evidence_citations)
		? row.evidence_citations
		: [];
	const briefChecklist = Array.isArray(row.brief_checklist)
		? row.brief_checklist
				.map((item) => String(item ?? "").trim())
				.filter(Boolean)
		: [];
	const briefCitations = Array.isArray(row.brief_citations)
		? row.brief_citations.reduce<ContentGapItem["briefCitations"]>(
				(acc, item) => {
					if (!item || typeof item !== "object") return acc;
					const asRecord = item as Record<string, unknown>;
					const url = String(
						asRecord.url ?? asRecord.link ?? asRecord.href ?? "",
					).trim();
					if (!url) return acc;
					const title = String(asRecord.title ?? "").trim();
					const note = String(asRecord.note ?? "").trim();
					const citation: ContentGapItem["briefCitations"][number] = { url };
					if (title) citation.title = title;
					if (note) citation.note = note;
					acc.push(citation);
					return acc;
				},
				[],
			)
		: [];

	const status = String(row.status ?? "backlog").trim() as ContentGapStatus;

	return {
		id: String(row.id ?? ""),
		topicKey: String(row.topic_key ?? ""),
		topicLabel: String(row.topic_label ?? ""),
		promptQueryId: row.prompt_query_id ? String(row.prompt_query_id) : null,
		cohortTag: row.cohort_tag ? String(row.cohort_tag) : null,
		mentionDeficitScore: toFiniteNumber(row.mention_deficit_score),
		competitorCoverageScore: toFiniteNumber(row.competitor_coverage_score),
		compositeScore: toFiniteNumber(row.composite_score),
		evidenceCount: Math.max(0, Math.round(toFiniteNumber(row.evidence_count))),
		evidenceCitations: evidenceCitations as ContentGapItem["evidenceCitations"],
		status,
		linkedPageUrl: row.linked_page_url ? String(row.linked_page_url) : null,
		briefMarkdown: row.brief_markdown ? String(row.brief_markdown) : null,
		briefChecklist,
		briefCitations,
		briefModel: row.brief_model ? String(row.brief_model) : null,
		briefGeneratedAt: row.brief_generated_at
			? String(row.brief_generated_at)
			: null,
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
	};
}

function mapPromptResearchCohort(
	row: Record<string, unknown>,
): PromptResearchCohort {
	return {
		id: String(row.id ?? ""),
		tag: String(row.tag ?? ""),
		displayName: String(row.display_name ?? row.displayName ?? ""),
		baselineRunId: String(row.baseline_run_id ?? row.baselineRunId ?? ""),
		baselineLockedAt: String(
			row.baseline_locked_at ?? row.baselineLockedAt ?? "",
		),
		targetPp: toFiniteNumber(row.target_pp ?? row.targetPp, 5),
		targetWeeks: Math.max(
			1,
			Math.round(toFiniteNumber(row.target_weeks ?? row.targetWeeks, 8)),
		),
		isActive: Boolean(row.is_active ?? row.isActive ?? true),
		createdAt: String(row.created_at ?? row.createdAt ?? ""),
		updatedAt: String(row.updated_at ?? row.updatedAt ?? ""),
	};
}

type CitationLinksResponseRow = {
	id: number;
	run_id: string;
	model: string;
	provider?: string | null;
	model_owner?: string | null;
	web_search_enabled: boolean;
	citations: unknown;
};

async function fetchCitationLinksFromSupabase(
	options: { runId?: string; providers?: string[] } = {},
): Promise<CitationLinksResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	const runsResult = await supabase
		.from("benchmark_runs")
		.select("id,run_month,web_search_enabled,created_at")
		.order("created_at", { ascending: false })
		.limit(20);

	if (runsResult.error) {
		throw asError(
			runsResult.error,
			"Failed to load benchmark_runs for citation links",
		);
	}

	const runsRaw = (runsResult.data ?? []) as Array<{
		id: string;
		run_month: string | null;
		web_search_enabled: boolean | null;
		created_at: string | null;
	}>;

	const availableRuns = runsRaw.map((r) => ({
		id: r.id,
		runMonth: r.run_month,
		createdAt: r.created_at,
		webSearchEnabled: r.web_search_enabled,
	}));

	const targetRunId = options.runId ?? availableRuns[0]?.id ?? null;

	if (!targetRunId) {
		return {
			generatedAt: new Date().toISOString(),
			runId: null,
			runMonth: null,
			availableRuns,
			totalResponses: 0,
			responsesWithCitations: 0,
			totalCitations: 0,
			uniqueSources: 0,
			sources: [],
		};
	}

	const targetRun = availableRuns.find((r) => r.id === targetRunId) ?? null;

	const responseRows: CitationLinksResponseRow[] = [];
	let offset = 0;
	while (true) {
		const result = await supabase
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
				"Failed to load benchmark_responses for citation links",
			);
		}

		const page = (result.data ?? []) as CitationLinksResponseRow[];
		if (page.length === 0) break;
		responseRows.push(...page);
		offset += page.length;
		if (page.length < SUPABASE_PAGE_SIZE) break;
	}

	const selectedProviderSet = new Set(
		normalizeSelectedProviders(options.providers ?? []),
	);
	const filteredRows =
		selectedProviderSet.size > 0
			? responseRows.filter((row) =>
					responseMatchesProviderFilter(row, selectedProviderSet),
				)
			: responseRows;

	const parsed = filteredRows.map((row) => {
		const provider = normalizeCitationProvider(
			String(row.provider || row.model_owner || row.model || ""),
			"openai",
		);
		const citationRefs = normalizeCitationRefs(row.citations, provider);
		return { responseId: String(row.id), citationRefs };
	});

	const sources = aggregateCitationSources(parsed);
	const responsesWithCitations = parsed.filter(
		(p) => p.citationRefs.length > 0,
	).length;
	const totalCitations = sources.reduce((sum, s) => sum + s.citationCount, 0);

	return {
		generatedAt: new Date().toISOString(),
		runId: targetRunId,
		runMonth: targetRun?.runMonth ?? null,
		availableRuns,
		totalResponses: filteredRows.length,
		responsesWithCitations,
		totalCitations,
		uniqueSources: sources.length,
		sources,
	};
}

function aggregateUrlStats(
	refs: Array<{ responseId: string; citationRefs: CitationRef[] }>,
): AskillUrlStat[] {
	type Bucket = {
		url: string;
		title: string;
		host: string;
		citationCount: number;
		responseIds: Set<string>;
		providers: Set<string>;
	};
	const buckets = new Map<string, Bucket>();

	for (const { responseId, citationRefs } of refs) {
		for (const ref of citationRefs) {
			const url = ref.url.trim();
			if (!url) continue;
			let b = buckets.get(url);
			if (!b) {
				b = {
					url,
					title: ref.title?.trim() || ref.host || url,
					host: ref.host || url,
					citationCount: 0,
					responseIds: new Set(),
					providers: new Set(),
				};
				buckets.set(url, b);
			}
			b.citationCount += 1;
			b.responseIds.add(responseId);
			if (ref.provider) b.providers.add(ref.provider);
			// prefer a richer title if we get one later
			if (ref.title?.trim() && (b.title === b.host || b.title === b.url)) {
				b.title = ref.title.trim();
			}
		}
	}

	return [...buckets.values()]
		.map((b) => ({
			url: b.url,
			title: b.title,
			host: b.host,
			citationCount: b.citationCount,
			responseCount: b.responseIds.size,
			providers: [...b.providers].sort(),
		}))
		.sort(
			(a, b) =>
				b.citationCount - a.citationCount ||
				b.responseCount - a.responseCount ||
				a.url.localeCompare(b.url),
		);
}

async function fetchAskillFromSupabase(
	options: { runId?: string; providers?: string[] } = {},
): Promise<AskillResponse> {
	if (!supabase) {
		throw new Error("Supabase is not configured.");
	}

	// Fetch recent runs
	const runsResult = await supabase
		.from("benchmark_runs")
		.select("id,run_month,web_search_enabled,created_at")
		.order("created_at", { ascending: false })
		.limit(20);

	if (runsResult.error) {
		throw asError(runsResult.error, "Failed to load benchmark_runs for Askill");
	}

	const runsRaw = (runsResult.data ?? []) as Array<{
		id: string;
		run_month: string | null;
		web_search_enabled: boolean | null;
		created_at: string | null;
	}>;

	const availableRuns = runsRaw.map((r) => ({
		id: r.id,
		runMonth: r.run_month,
		createdAt: r.created_at,
		webSearchEnabled: r.web_search_enabled,
	}));

	const targetRunId = options.runId ?? availableRuns[0]?.id ?? null;

	const empty: AskillResponse = {
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

	if (!targetRunId) return empty;

	const targetRun = availableRuns.find((r) => r.id === targetRunId) ?? null;

	// Fetch Highcharts competitor (primary)
	const competitorResult = await supabase
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

	const hcRow = ((competitorResult.data ?? [])[0] ?? null) as {
		id: string;
		name: string;
	} | null;
	if (!hcRow) {
		return {
			...empty,
			runId: targetRunId,
			runMonth: targetRun?.runMonth ?? null,
		};
	}

	// Fetch all responses for the run
	const responseRows: CitationLinksResponseRow[] = [];
	let offset = 0;
	while (true) {
		const result = await supabase
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
				"Failed to load benchmark_responses for Askill",
			);
		}

		const page = (result.data ?? []) as Array<
			CitationLinksResponseRow & {
				query_id: string | null;
				error: string | null;
			}
		>;
		if (page.length === 0) break;
		responseRows.push(...(page as CitationLinksResponseRow[]));
		offset += page.length;
		if (page.length < SUPABASE_PAGE_SIZE) break;
	}

	const selectedProviderSet = new Set(
		normalizeSelectedProviders(options.providers ?? []),
	);
	const filteredRows =
		selectedProviderSet.size > 0
			? responseRows.filter((row) =>
					responseMatchesProviderFilter(row, selectedProviderSet),
				)
			: responseRows;

	const rowsExtended = filteredRows as Array<
		CitationLinksResponseRow & { query_id: string | null; error: string | null }
	>;

	// Fetch response_mentions for Highcharts
	const responseIds = rowsExtended.map((r) => Number(r.id));
	const mentionedResponseIds = new Set<number>();

	if (responseIds.length > 0) {
		for (
			let i = 0;
			i < responseIds.length;
			i += SUPABASE_IN_CLAUSE_CHUNK_SIZE
		) {
			const chunk = responseIds.slice(i, i + SUPABASE_IN_CLAUSE_CHUNK_SIZE);
			let mOffset = 0;
			while (true) {
				const mResult = await supabase
					.from("response_mentions")
					.select("response_id,mentioned")
					.in("response_id", chunk)
					.eq("competitor_id", hcRow.id)
					.eq("mentioned", true)
					.range(mOffset, mOffset + SUPABASE_PAGE_SIZE - 1);

				if (mResult.error) {
					if (isMissingRelation(mResult.error)) break;
					throw asError(
						mResult.error,
						"Failed to load response_mentions for Askill",
					);
				}

				const page = (mResult.data ?? []) as Array<{
					response_id: number;
					mentioned: boolean;
				}>;
				if (page.length === 0) break;
				page.forEach((row) => {
					if (row.mentioned) mentionedResponseIds.add(Number(row.response_id));
				});
				mOffset += page.length;
				if (page.length < SUPABASE_PAGE_SIZE) break;
			}
		}
	}

	// Fetch query texts
	const queryIds = [
		...new Set(rowsExtended.map((r) => r.query_id).filter(Boolean) as string[]),
	];
	const queryTextMap = new Map<string, string>();

	if (queryIds.length > 0) {
		for (let i = 0; i < queryIds.length; i += SUPABASE_IN_CLAUSE_CHUNK_SIZE) {
			const chunk = queryIds.slice(i, i + SUPABASE_IN_CLAUSE_CHUNK_SIZE);
			const qResult = await supabase
				.from("prompt_queries")
				.select("id,query_text")
				.in("id", chunk);
			if (!qResult.error) {
				const rows = (qResult.data ?? []) as Array<{
					id: string;
					query_text: string;
				}>;
				for (const row of rows) {
					queryTextMap.set(row.id, row.query_text);
				}
			}
		}
	}

	// Parse citation refs once per HC-mentioned response
	const hcCitationInputs: Array<{
		responseId: string;
		citationRefs: CitationRef[];
	}> = [];

	for (const row of rowsExtended) {
		if (!mentionedResponseIds.has(Number(row.id))) continue;
		const provider = normalizeCitationProvider(
			String(row.provider || row.model_owner || row.model || ""),
			"openai",
		);
		hcCitationInputs.push({
			responseId: String(row.id),
			citationRefs: normalizeCitationRefs(row.citations, provider),
		});
	}

	// Per-query stats
	type QueryAccum = {
		queryId: string;
		queryText: string;
		responseCount: number;
		mentionCount: number;
		totalCitations: number;
		urlSet: Set<string>;
	};

	const queryMap = new Map<string, QueryAccum>();

	for (const row of rowsExtended) {
		const qid = row.query_id ?? "__unknown__";
		if (!queryMap.has(qid)) {
			queryMap.set(qid, {
				queryId: qid,
				queryText: queryTextMap.get(qid) ?? qid,
				responseCount: 0,
				mentionCount: 0,
				totalCitations: 0,
				urlSet: new Set(),
			});
		}
		const accum = queryMap.get(qid);
		if (!accum) {
			continue;
		}
		accum.responseCount += 1;

		if (mentionedResponseIds.has(Number(row.id))) {
			accum.mentionCount += 1;
			const provider = normalizeCitationProvider(
				String(row.provider || row.model_owner || row.model || ""),
				"openai",
			);
			const refs = normalizeCitationRefs(row.citations, provider);
			accum.totalCitations += refs.length;
			for (const ref of refs) {
				accum.urlSet.add(ref.url.trim());
			}
		}
	}

	const queries: import("./types").AskillQueryStat[] = [...queryMap.values()]
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
			(a, b) =>
				b.mentionCount - a.mentionCount ||
				a.queryText.localeCompare(b.queryText),
		);

	// URL-level aggregation from HC-mentioned responses
	const urls = aggregateUrlStats(hcCitationInputs);
	const totalCitations = urls.reduce((sum, u) => sum + u.citationCount, 0);
	const uniqueDomains = new Set(urls.map((u) => u.host)).size;

	return {
		generatedAt: new Date().toISOString(),
		runId: targetRunId,
		runMonth: targetRun?.runMonth ?? null,
		availableRuns,
		highchartsName: hcRow.name,
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
	};
}

export const api = {
	async health() {
		return bffClient.health();
	},

	async diagnostics() {
		if (hasSupabaseConfig()) {
			try {
				return await diagnosticsViaSupabase();
			} catch (primaryError) {
				try {
					return await diagnosticsViaApi();
				} catch {
					throw asError(primaryError, "Supabase diagnostics failed");
				}
			}
		}
		return diagnosticsViaApi();
	},

	async benchmarkRuns(triggerToken?: string) {
		return json<BenchmarkRunsResponse>("/benchmark/runs", {
			method: "GET",
			headers: withOptionalTriggerToken(triggerToken),
		});
	},

	async benchmarkModels() {
		return json<BenchmarkModelsResponse>("/benchmark/models");
	},

	async runCosts(limit = 30): Promise<BenchmarkRunCostsResponse> {
		const clampedLimit = Math.max(1, Math.min(200, Math.round(limit)));
		const suffix = `?limit=${encodeURIComponent(String(clampedLimit))}`;
		return json<BenchmarkRunCostsResponse>(`/run-costs${suffix}`);
	},

	async triggerBenchmark(
		data: {
			model?: string;
			models?: string[];
			selectAllModels?: boolean;
			runs: number;
			temperature: number;
			webSearch: boolean;
			ourTerms: string;
			runMonth?: string;
			promptLimit?: number;
			promptOrder?: "default" | "newest";
			cohortTag?: string;
		},
		triggerToken?: string,
	) {
		return bffClient.triggerBenchmark(data, triggerToken);
	},

	async stopBenchmark(
		data: {
			runId?: string;
		},
		triggerToken?: string,
	) {
		return bffClient.stopBenchmark(data, triggerToken);
	},

	async promptLabRun(
		data: {
			query: string;
			model?: string;
			models?: string[];
			selectAllModels?: boolean;
			webSearch?: boolean;
			includeRawHtml?: boolean;
			searchContext?: {
				enabled?: boolean;
				location?: string;
				language?: string;
			};
		},
		triggerToken?: string,
	): Promise<PromptLabRunResponse> {
		const payload = await json<PromptLabRunResponse>("/prompt-lab/run", {
			method: "POST",
			headers: withOptionalTriggerToken(triggerToken),
			body: JSON.stringify(data),
		});
		return normalizePromptLabRunPayload(payload);
	},

	async dashboard(optionsOrContext?: DashboardOptions | unknown) {
		const options =
			optionsOrContext &&
			typeof optionsOrContext === "object" &&
			!Array.isArray(optionsOrContext) &&
			!("queryKey" in optionsOrContext)
				? (optionsOrContext as DashboardOptions)
				: {};
		const normalizedProviders = normalizeSelectedProviders(options.providers);
		const params = new URLSearchParams();
		if (normalizedProviders.length > 0) {
			params.set("providers", normalizedProviders.join(","));
		}
		const suffix = params.size > 0 ? `?${params.toString()}` : "";

		return json<DashboardResponse>(`/analytics/dashboard${suffix}`);
	},

	async dashboardOverview(optionsOrContext?: DashboardOptions | unknown) {
		const options =
			optionsOrContext &&
			typeof optionsOrContext === "object" &&
			!Array.isArray(optionsOrContext) &&
			!("queryKey" in optionsOrContext)
				? (optionsOrContext as DashboardOptions)
				: {};
		const normalizedProviders = normalizeSelectedProviders(options.providers);
		const params = new URLSearchParams();
		params.set("prompt_detail", "summary");
		if (normalizedProviders.length > 0) {
			params.set("providers", normalizedProviders.join(","));
		}
		return json<DashboardOverviewResponse>(
			`/analytics/dashboard?${params.toString()}`,
		);
	},

	async underTheHood(
		range: UnderTheHoodRange = "all",
	): Promise<UnderTheHoodResponse> {
		const normalizedRange = normalizeUnderTheHoodRange(range);
		const suffix = `?range=${encodeURIComponent(normalizedRange)}`;

		return json<UnderTheHoodResponse>(`/analytics/under-the-hood${suffix}`);
	},

	async config() {
		return json<ConfigResponse>("/config/benchmark");
	},

	async togglePromptActive(
		query: string,
		active: boolean,
		triggerToken?: string,
	) {
		return json<{ ok: boolean }>("/prompts/toggle", {
			method: "PATCH",
			headers: withOptionalTriggerToken(
				triggerToken ?? readStoredTriggerToken(),
			),
			body: JSON.stringify({ query, active }),
		});
	},

	async timeseries(
		options: TimeSeriesOptions = {},
	): Promise<TimeSeriesResponse> {
		const normalizedTags = normalizeSelectedTags(options.tags);
		const normalizedProviders = normalizeSelectedProviders(options.providers);
		const params = new URLSearchParams();
		if (normalizedTags.length > 0) {
			params.set("tags", normalizedTags.join(","));
			params.set("mode", options.mode === "all" ? "all" : "any");
		}
		if (normalizedProviders.length > 0) {
			params.set("providers", normalizedProviders.join(","));
		}
		const suffix = params.size > 0 ? `?${params.toString()}` : "";

		try {
			return await json<TimeSeriesResponse>(`/analytics/timeseries${suffix}`);
		} catch {
			return { ok: false, competitors: [], points: [] };
		}
	},

	async competitorBlogs(limit = 500): Promise<CompetitorBlogsResponse> {
		const clampedLimit = Math.max(1, Math.min(limit, 1000));
		return json<CompetitorBlogsResponse>(
			`/research/competitor-blogs?limit=${encodeURIComponent(String(clampedLimit))}`,
		);
	},

	async researchCompetitorRun(
		data: { model?: string; maxItemsPerCompetitor?: number } = {},
		triggerToken?: string,
	): Promise<{
		ok: boolean;
		runId: string;
		competitorsProcessed: number;
		itemsUpserted: number;
		model: string;
		maxItemsPerCompetitor: number;
	}> {
		return json("/research/competitors/run", {
			method: "POST",
			headers: withOptionalTriggerToken(triggerToken),
			body: JSON.stringify(data),
		});
	},

	async researchSitemapSync(
		data: { maxUrls?: number } = {},
		triggerToken?: string,
	): Promise<{
		ok: boolean;
		runId: string;
		sitemapRoots: number;
		sitemapsVisited: number;
		pagesDiscovered: number;
		pagesUpserted: number;
		sitemapFetchErrors: number;
		pageErrors: number;
		maxUrls: number;
	}> {
		return json("/research/sitemap/sync", {
			method: "POST",
			headers: withOptionalTriggerToken(triggerToken),
			body: JSON.stringify(data),
		});
	},

	async researchGapsRefresh(triggerToken?: string): Promise<{
		ok: boolean;
		runId: string;
		promptsConsidered: number;
		actionableGapCount: number;
		gapsUpserted: number;
		evidencePoolSize: number;
	}> {
		return json("/research/gaps/refresh", {
			method: "POST",
			headers: withOptionalTriggerToken(triggerToken),
			body: JSON.stringify({}),
		});
	},

	async researchGenerateBrief(
		data: { gapId: string; model?: string },
		triggerToken?: string,
	): Promise<{
		ok: boolean;
		runId: string;
		gap: Record<string, unknown>;
		gapId: string;
		sectionCount: number;
		checklistCount: number;
		citationCount: number;
		model: string;
	}> {
		return json("/research/briefs/generate", {
			method: "POST",
			headers: withOptionalTriggerToken(triggerToken),
			body: JSON.stringify(data),
		});
	},

	async researchUpdateGapStatus(
		id: string,
		data: { status: ContentGapStatus; linkedPageUrl?: string },
		triggerToken?: string,
	): Promise<ContentGapItem> {
		const payload = await json<{ ok: boolean; gap: Record<string, unknown> }>(
			`/research/gaps/${encodeURIComponent(id)}/status`,
			{
				method: "PATCH",
				headers: withOptionalTriggerToken(triggerToken),
				body: JSON.stringify(data),
			},
		);
		return mapGapItem(payload.gap);
	},

	async researchGaps(
		options: { status?: ContentGapStatus; tag?: string; limit?: number } = {},
	): Promise<ContentGapItem[]> {
		const params = new URLSearchParams();
		if (options.status) params.set("status", options.status);
		if (options.tag) params.set("tag", options.tag);
		if (typeof options.limit === "number")
			params.set("limit", String(options.limit));
		const suffix = params.size > 0 ? `?${params.toString()}` : "";
		const payload = await json<{
			ok: boolean;
			gaps: Array<Record<string, unknown>>;
		}>(`/research/gaps${suffix}`);
		return (payload.gaps ?? []).map(mapGapItem);
	},

	async createPromptResearchCohort(
		data: {
			tag: string;
			displayName?: string;
			baselineRunId?: string;
			targetPp?: number;
			targetWeeks?: number;
		},
		triggerToken?: string,
	): Promise<PromptResearchCohort> {
		const payload = await json<{
			ok: boolean;
			cohort: Record<string, unknown>;
		}>("/research/prompt-cohorts", {
			method: "POST",
			headers: withOptionalTriggerToken(triggerToken),
			body: JSON.stringify(data),
		});
		return mapPromptResearchCohort(payload.cohort);
	},

	async promptResearchCohorts(): Promise<PromptResearchCohort[]> {
		const payload = await json<{
			ok: boolean;
			cohorts: Array<Record<string, unknown>>;
		}>("/research/prompt-cohorts");
		return (payload.cohorts ?? []).map(mapPromptResearchCohort);
	},

	async promptResearchProgress(id: string): Promise<PromptResearchProgress> {
		const payload = await json<PromptResearchProgress>(
			`/research/prompt-cohorts/${encodeURIComponent(id)}/progress`,
		);
		return payload;
	},

	async promptDrilldown(query: string): Promise<PromptDrilldownResponse> {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			throw new Error("Prompt query is required.");
		}

		const encoded = encodeURIComponent(trimmedQuery);
		return normalizePromptDrilldownPayload(
			await json<PromptDrilldownResponse>(
				`/benchmark/prompt-drilldown?query=${encoded}`,
			),
		);
	},

	async updateConfig(data: BenchmarkConfig, triggerToken?: string) {
		return json<ConfigResponse>("/config/benchmark", {
			method: "PUT",
			headers: withOptionalTriggerToken(
				triggerToken ?? readStoredTriggerToken(),
			),
			body: JSON.stringify(data),
		});
	},

	async createBillingPortalSession(
		email: string,
		returnUrl?: string,
	): Promise<{ url: string }> {
		return bffClient.createBillingPortalSession({ email, returnUrl });
	},

	async citationLinks(
		options: { runId?: string; providers?: string[] } = {},
	): Promise<CitationLinksResponse> {
		const params = new URLSearchParams();
		if (options.runId) {
			params.set("runId", options.runId);
		}
		const providers = normalizeSelectedProviders(options.providers);
		if (providers.length > 0) {
			params.set("providers", providers.join(","));
		}
		const suffix = params.size > 0 ? `?${params.toString()}` : "";
		return json<CitationLinksResponse>(`/analytics/citation-links${suffix}`);
	},

	async askill(
		options: { runId?: string; providers?: string[] } = {},
	): Promise<AskillResponse> {
		const params = new URLSearchParams();
		if (options.runId) {
			params.set("runId", options.runId);
		}
		const providers = normalizeSelectedProviders(options.providers);
		if (providers.length > 0) {
			params.set("providers", providers.join(","));
		}
		const suffix = params.size > 0 ? `?${params.toString()}` : "";
		return json<AskillResponse>(`/analytics/askill${suffix}`);
	},
};
