const fs = require("node:fs");
const path = require("node:path");

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const ANTHROPIC_MESSAGES_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const GEMINI_MODELS_URL =
	"https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 10_000;
const SMOKE_TEST_PROMPT = "Reply with OK.";

const FALLBACK_CATALOG = {
	version: 1,
	defaultModelIds: ["gpt-4o-mini"],
	models: [
		{
			id: "gpt-4o-mini",
			label: "GPT-4o mini",
			owner: "OpenAI",
			provider: "openai",
			kind: "pinned",
			includeByDefault: true,
		},
	],
};

const LEGACY_ALIASES = {
	"claude-3-5-sonnet-latest": "anthropic:sonnet:latest",
	"claude-4-6-sonnet-latest": "anthropic:sonnet:latest",
	"claude-4-6-opus-latest": "anthropic:opus:latest",
	"gemini-3.0-flash": "google:flash:latest",
};

function catalogPathCandidates() {
	const configured = String(
		process.env.BENCHMARK_MODEL_CATALOG_PATH || "",
	).trim();
	const candidates = [];
	if (configured) {
		candidates.push(path.resolve(configured));
	}
	candidates.push(
		path.resolve(__dirname, "../../../../config/benchmark/models.json"),
	);
	candidates.push(path.resolve(process.cwd(), "config/benchmark/models.json"));
	return candidates;
}

function loadBenchmarkModelCatalog() {
	for (const candidate of catalogPathCandidates()) {
		try {
			if (!fs.existsSync(candidate)) {
				continue;
			}
			const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
			if (
				parsed &&
				typeof parsed === "object" &&
				Array.isArray(parsed.models)
			) {
				return parsed;
			}
		} catch {}
	}
	return FALLBACK_CATALOG;
}

function asTrimmedString(value) {
	return String(value || "").trim();
}

function dedupePreserveOrder(values) {
	const out = [];
	const seen = new Set();
	for (const value of values) {
		const normalized = asTrimmedString(value);
		if (!normalized) {
			continue;
		}
		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(normalized);
	}
	return out;
}

function parseCsv(value) {
	return String(value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function getCatalogEntries() {
	const catalog = loadBenchmarkModelCatalog();
	return (catalog.models || []).filter(
		(entry) => entry && entry.enabled !== false,
	);
}

function getCatalogEntryMap() {
	return new Map(
		getCatalogEntries().map((entry) => [
			asTrimmedString(entry.id).toLowerCase(),
			entry,
		]),
	);
}

function getBenchmarkDefaultModelIds() {
	const catalog = loadBenchmarkModelCatalog();
	const entryMap = getCatalogEntryMap();
	const configuredDefaults = Array.isArray(catalog.defaultModelIds)
		? catalog.defaultModelIds
		: [];
	const defaults = configuredDefaults
		.map((id) => asTrimmedString(id))
		.filter((id) => entryMap.has(id.toLowerCase()));
	if (defaults.length > 0) {
		return dedupePreserveOrder(defaults);
	}
	return dedupePreserveOrder(
		getCatalogEntries()
			.filter((entry) => entry.includeByDefault !== false)
			.map((entry) => entry.id),
	);
}

function getBenchmarkModelAliases() {
	const aliases = { ...LEGACY_ALIASES };
	for (const entry of getCatalogEntries()) {
		const id = asTrimmedString(entry.id);
		if (!id) {
			continue;
		}
		for (const alias of entry.aliases || []) {
			const normalized = asTrimmedString(alias).toLowerCase();
			if (normalized) {
				aliases[normalized] = id;
			}
		}
	}
	return aliases;
}

function normalizeBenchmarkModelAlias(value) {
	const normalized = asTrimmedString(value);
	if (!normalized) {
		return "";
	}
	return getBenchmarkModelAliases()[normalized.toLowerCase()] || normalized;
}

function normalizeBenchmarkModelList(values) {
	return dedupePreserveOrder(
		values.map((value) => normalizeBenchmarkModelAlias(value)),
	);
}

function getBenchmarkAllowedModels(
	envAllowedModels = process.env.BENCHMARK_ALLOWED_MODELS,
) {
	const entries = getCatalogEntries();
	const catalogValues = [];
	for (const entry of entries) {
		catalogValues.push(entry.id);
		if (entry.fallback) {
			catalogValues.push(entry.fallback);
		}
	}
	return normalizeBenchmarkModelList([
		...catalogValues,
		...parseCsv(envAllowedModels),
	]);
}

function capitalizeWord(value) {
	const normalized = asTrimmedString(value);
	if (!normalized) {
		return "";
	}
	return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
}

function formatResolvedModelLabel(modelId) {
	const normalized = asTrimmedString(modelId);
	const lowered = normalized.toLowerCase();
	if (!normalized) {
		return "";
	}
	if (lowered === "gpt-4o-mini") {
		return "GPT-4o mini";
	}
	if (lowered === "gpt-4o") {
		return "GPT-4o";
	}
	if (lowered.startsWith("gpt-")) {
		return `GPT ${normalized.slice(4).replace(/-/g, " ")}`;
	}
	if (lowered.startsWith("claude-")) {
		const parts = lowered
			.replace(/^claude-/, "")
			.split("-")
			.filter(Boolean)
			.filter((part) => !/^\d{8}$/.test(part));
		const family = capitalizeWord(parts[0] || "");
		const versionParts = parts.slice(1);
		const version = versionParts.every((part) => /^\d+$/.test(part))
			? versionParts.join(".")
			: versionParts.map((part) => capitalizeWord(part)).join(" ");
		return ["Claude", family, version].filter(Boolean).join(" ");
	}
	if (lowered.startsWith("gemini-")) {
		const parts = lowered
			.replace(/^gemini-/, "")
			.split("-")
			.filter(Boolean);
		return ["Gemini", ...parts.map((part) => capitalizeWord(part))].join(" ");
	}
	return normalized;
}

function getPublicBenchmarkModelOptions() {
	const entries = getCatalogEntries();
	const byId = new Map(
		entries.map((entry) => [asTrimmedString(entry.id), entry]),
	);
	const orderedIds = [
		...getBenchmarkDefaultModelIds(),
		...entries.map((entry) => asTrimmedString(entry.id)),
	];
	const options = [];
	const seen = new Set();
	for (const id of orderedIds) {
		const entry = byId.get(id);
		if (!entry || seen.has(id.toLowerCase())) {
			continue;
		}
		seen.add(id.toLowerCase());
		options.push({
			value: id,
			label: entry.label || id,
			owner: entry.owner || "Unknown",
			provider: entry.provider || "unknown",
			kind: entry.kind || "pinned",
			family: entry.family || null,
			fallback: entry.fallback || null,
		});
	}
	return options;
}

async function getResolvedPublicBenchmarkModelOptions(options = {}) {
	const baseOptions = getPublicBenchmarkModelOptions();
	return Promise.all(
		baseOptions.map(async (option) => {
			if (option.kind !== "latest") {
				return option;
			}
			const resolvedValue = await resolveBenchmarkModelId(option.value, {
				logger: options.logger,
				smokeTest: false,
			});
			return {
				...option,
				label:
					formatResolvedModelLabel(resolvedValue || option.fallback) ||
					option.label,
				resolvedValue: resolvedValue || option.fallback || null,
			};
		}),
	);
}

function warn(logger, message, error) {
	if (!logger || typeof logger.warn !== "function") {
		return;
	}
	if (error) {
		logger.warn(message, error);
		return;
	}
	logger.warn(message);
}

async function fetchJson(url, init = {}) {
	if (typeof fetch !== "function") {
		throw new Error("Global fetch is not available.");
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal,
		});
		const raw = await response.text();
		let payload = null;
		if (raw) {
			try {
				payload = JSON.parse(raw);
			} catch {
				payload = raw;
			}
		}
		if (!response.ok) {
			const message =
				payload &&
				typeof payload === "object" &&
				(payload.error?.message || payload.message || payload.error)
					? payload.error?.message || payload.message || payload.error
					: `Request failed (${response.status})`;
			throw new Error(String(message));
		}
		return payload;
	} finally {
		clearTimeout(timeout);
	}
}

function normalizeProviderModelId(value) {
	return asTrimmedString(value).replace(/^models\//, "");
}

function openAiFrontierScore(modelId) {
	const match = /^gpt-(\d+)(?:\.(\d+))?$/.exec(modelId);
	if (!match) {
		return null;
	}
	const major = Number(match[1]);
	const minor = Number(match[2] || 0);
	if (!Number.isFinite(major) || !Number.isFinite(minor)) {
		return null;
	}
	return major * 1000 + minor;
}

function isOpenAiFrontierCandidate(modelId) {
	const normalized = modelId.toLowerCase();
	if (
		normalized.includes("mini") ||
		normalized.includes("nano") ||
		normalized.includes("realtime") ||
		normalized.includes("audio") ||
		normalized.includes("tts") ||
		normalized.includes("transcribe") ||
		normalized.includes("image") ||
		normalized.includes("codex")
	) {
		return false;
	}
	return openAiFrontierScore(normalized) !== null;
}

async function smokeTestOpenAiModel(modelId) {
	const apiKey = asTrimmedString(process.env.OPENAI_API_KEY);
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not set.");
	}
	await fetchJson(OPENAI_RESPONSES_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: modelId,
			input: SMOKE_TEST_PROMPT,
			max_output_tokens: 8,
		}),
	});
}

async function smokeTestAnthropicModel(modelId) {
	const apiKey = asTrimmedString(process.env.ANTHROPIC_API_KEY);
	if (!apiKey) {
		throw new Error("ANTHROPIC_API_KEY is not set.");
	}
	await fetchJson(ANTHROPIC_MESSAGES_API_URL, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: modelId,
			max_tokens: 8,
			messages: [{ role: "user", content: SMOKE_TEST_PROMPT }],
		}),
	});
}

async function smokeTestGoogleModel(modelId) {
	const apiKey = asTrimmedString(process.env.GEMINI_API_KEY);
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY is not set.");
	}
	const modelPath = encodeURIComponent(modelId);
	const url =
		`${GEMINI_MODELS_URL}/${modelPath}:generateContent` +
		`?key=${encodeURIComponent(apiKey)}`;
	await fetchJson(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contents: [
				{
					role: "user",
					parts: [{ text: SMOKE_TEST_PROMPT }],
				},
			],
			generationConfig: { maxOutputTokens: 8 },
		}),
	});
}

async function smokeTestModel(entry, modelId) {
	if (entry.provider === "anthropic") {
		await smokeTestAnthropicModel(modelId);
		return;
	}
	if (entry.provider === "google") {
		await smokeTestGoogleModel(modelId);
		return;
	}
	await smokeTestOpenAiModel(modelId);
}

async function selectUsableLatestCandidate(entry, candidateIds, options = {}) {
	const fallback = asTrimmedString(entry.fallback);
	const candidates = dedupePreserveOrder([
		...candidateIds,
		...(fallback ? [fallback] : []),
	]);
	if (candidates.length === 0) {
		return fallback || "";
	}
	if (options.smokeTest === false) {
		return candidates[0];
	}
	let lastError = null;
	for (const candidate of candidates) {
		try {
			await smokeTestModel(entry, candidate);
			return candidate;
		} catch (error) {
			lastError = error;
			warn(
				options.logger,
				`[benchmark-models] Smoke test failed for ${candidate}.`,
				error,
			);
		}
	}
	if (lastError) {
		throw lastError;
	}
	return fallback || "";
}

async function resolveOpenAiLatest(entry, options = {}) {
	const apiKey = asTrimmedString(process.env.OPENAI_API_KEY);
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not set.");
	}
	const payload = await fetchJson(OPENAI_MODELS_URL, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	const models = Array.isArray(payload?.data) ? payload.data : [];
	const candidates = models
		.map((model) => asTrimmedString(model?.id))
		.filter(isOpenAiFrontierCandidate)
		.map((id) => ({ id, score: openAiFrontierScore(id.toLowerCase()) || 0 }))
		.sort((left, right) => right.score - left.score)
		.map((candidate) => candidate.id);
	return selectUsableLatestCandidate(entry, candidates, options);
}

async function resolveAnthropicLatest(entry, options = {}) {
	const apiKey = asTrimmedString(process.env.ANTHROPIC_API_KEY);
	if (!apiKey) {
		throw new Error("ANTHROPIC_API_KEY is not set.");
	}
	const payload = await fetchJson(ANTHROPIC_MODELS_URL, {
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
		},
	});
	const models = Array.isArray(payload?.data) ? payload.data : [];
	const family = asTrimmedString(entry.family).toLowerCase();
	const prefix =
		family === "opus"
			? "claude-opus-"
			: family === "sonnet"
				? "claude-sonnet-"
				: "claude-";
	const candidates = models
		.map((model) => asTrimmedString(model?.id))
		.filter((id) => id.toLowerCase().startsWith(prefix));
	return selectUsableLatestCandidate(entry, candidates, options);
}

function googleVersionScore(modelId) {
	const match = /gemini-(\d+)(?:\.(\d+))?/.exec(modelId);
	if (!match) {
		return 0;
	}
	const major = Number(match[1]);
	const minor = Number(match[2] || 0);
	if (!Number.isFinite(major) || !Number.isFinite(minor)) {
		return 0;
	}
	return major * 1000 + minor;
}

function isGoogleFlashCandidate(model) {
	const id = normalizeProviderModelId(model?.name || model?.id).toLowerCase();
	const methods = Array.isArray(model?.supportedGenerationMethods)
		? model.supportedGenerationMethods
		: [];
	if (!methods.includes("generateContent")) {
		return false;
	}
	if (!id.includes("gemini") || !id.includes("flash")) {
		return false;
	}
	return ![
		"flash-lite",
		"live",
		"tts",
		"image",
		"embedding",
		"imagen",
		"veo",
		"nano",
		"banana",
	].some((token) => id.includes(token));
}

async function resolveGoogleLatest(entry, options = {}) {
	const apiKey = asTrimmedString(process.env.GEMINI_API_KEY);
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY is not set.");
	}
	const url = `${GEMINI_MODELS_URL}?key=${encodeURIComponent(apiKey)}`;
	const payload = await fetchJson(url);
	const models = Array.isArray(payload?.models) ? payload.models : [];
	const candidates = models
		.filter(isGoogleFlashCandidate)
		.map((model) => normalizeProviderModelId(model.name || model.id))
		.filter(Boolean)
		.map((id) => ({
			id,
			score:
				googleVersionScore(id.toLowerCase()) -
				(id.includes("preview") ? 0.01 : 0),
		}))
		.sort((left, right) => right.score - left.score)
		.map((candidate) => candidate.id);
	return selectUsableLatestCandidate(entry, candidates, options);
}

async function resolveLatestEntry(entry, options = {}) {
	if (entry.provider === "anthropic") {
		return resolveAnthropicLatest(entry, options);
	}
	if (entry.provider === "google") {
		return resolveGoogleLatest(entry, options);
	}
	return resolveOpenAiLatest(entry, options);
}

async function resolveBenchmarkModelId(modelId, options = {}) {
	const normalized = normalizeBenchmarkModelAlias(modelId);
	const entry = getCatalogEntryMap().get(normalized.toLowerCase());
	if (!entry || entry.kind !== "latest") {
		return normalized;
	}
	try {
		const resolved = await resolveLatestEntry(entry, options);
		return resolved || entry.fallback || normalized;
	} catch (error) {
		warn(
			options.logger,
			`[benchmark-models] Falling back for ${entry.id} to ${entry.fallback || entry.id}.`,
			error,
		);
		return entry.fallback || normalized;
	}
}

async function resolveBenchmarkModelIds(modelIds, options = {}) {
	const resolved = [];
	const seen = new Set();
	for (const modelId of modelIds) {
		const next = await resolveBenchmarkModelId(modelId, options);
		const key = next.toLowerCase();
		if (!next || seen.has(key)) {
			continue;
		}
		seen.add(key);
		resolved.push(next);
	}
	return resolved;
}

module.exports = {
	getBenchmarkAllowedModels,
	getBenchmarkDefaultModelIds,
	getPublicBenchmarkModelOptions,
	getResolvedPublicBenchmarkModelOptions,
	loadBenchmarkModelCatalog,
	normalizeBenchmarkModelAlias,
	normalizeBenchmarkModelList,
	resolveBenchmarkModelId,
	resolveBenchmarkModelIds,
};
