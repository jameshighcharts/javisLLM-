const { enforceRateLimit, enforceTriggerToken } = require("../_rate-limit");
const {
	dispatchWorkflow,
	getGitHubConfig,
	listWorkflowRuns,
} = require("../_github");

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_CLAUDE_OPUS_MODEL = "claude-opus-4-5-20251101";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MODEL_ALIASES = {
	"claude-3-5-sonnet-latest": DEFAULT_CLAUDE_MODEL,
	"claude-4-6-sonnet-latest": DEFAULT_CLAUDE_MODEL,
	"claude-sonnet-4-6": DEFAULT_CLAUDE_MODEL,
	"claude-4-6-opus-latest": DEFAULT_CLAUDE_OPUS_MODEL,
	"claude-opus-4-6": DEFAULT_CLAUDE_OPUS_MODEL,
	"gemini-3.0-flash": DEFAULT_GEMINI_MODEL,
	"gemini-3-flash-preview": DEFAULT_GEMINI_MODEL,
};
const FALLBACK_ALLOWED_MODELS = [
	DEFAULT_MODEL,
	"gpt-4o",
	"gpt-5.2",
	DEFAULT_CLAUDE_MODEL,
	DEFAULT_CLAUDE_OPUS_MODEL,
	DEFAULT_GEMINI_MODEL,
];
const OUR_TERMS_DEFAULT = "Highcharts";
const MAX_OUR_TERMS_LENGTH = 300;
const MAX_PROMPT_LIMIT = 10000;
const ALLOWED_PROMPT_ORDERS = new Set(["default", "newest"]);
const RUN_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const OUR_TERMS_REGEX = /^[\w\s.,&()+/-]+$/i;

function sendJson(res, statusCode, payload) {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}

function parseBody(req) {
	if (!req.body) {
		return {};
	}
	if (typeof req.body === "object") {
		return req.body;
	}
	if (typeof req.body === "string") {
		try {
			return JSON.parse(req.body);
		} catch {
			return {};
		}
	}
	return {};
}

function normalizeNumber(value, fallback, min, max) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	const bounded = Math.max(min, Math.min(max, parsed));
	return bounded;
}

function normalizeModelAlias(value) {
	const normalized = String(value || "").trim();
	if (!normalized) {
		return "";
	}
	return MODEL_ALIASES[normalized.toLowerCase()] || normalized;
}

function normalizeModelList(values) {
	const out = [];
	const seen = new Set();
	for (const value of values) {
		const normalized = normalizeModelAlias(value);
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

function getAllowedModels() {
	const raw = process.env.BENCHMARK_ALLOWED_MODELS || "";
	const configured = String(raw)
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	return normalizeModelList(
		configured.length > 0 ? configured : FALLBACK_ALLOWED_MODELS,
	);
}

function resolveModel(modelInput, allowedModels) {
	const normalizedMap = new Map(
		allowedModels.map((name) => [name.toLowerCase(), name]),
	);
	const normalizedInput = normalizeModelAlias(modelInput).toLowerCase();
	const resolved = normalizedMap.get(normalizedInput);
	if (!resolved) {
		const error = new Error(
			`Unsupported model "${modelInput}". Allowed models: ${allowedModels.join(", ")}`,
		);
		error.statusCode = 400;
		throw error;
	}
	return resolved;
}

function parseBoolean(value, fallback = false) {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["1", "true", "yes", "y", "on"].includes(normalized)) {
			return true;
		}
		if (["0", "false", "no", "n", "off"].includes(normalized)) {
			return false;
		}
	}
	return fallback;
}

function parseRequestedModels(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry || "").trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	return [];
}

function resolveModels(body, allowedModels) {
	const selectAll = parseBoolean(
		body.selectAllModels ?? body.selectAll ?? body.select_all,
		false,
	);

	let candidates = selectAll
		? allowedModels
		: parseRequestedModels(body.models);

	if (
		candidates.length === 0 &&
		typeof body.model === "string" &&
		body.model.trim()
	) {
		candidates = [body.model.trim()];
	}
	if (candidates.length === 0) {
		candidates = [DEFAULT_MODEL];
	}

	const resolved = [];
	const seen = new Set();
	for (const candidate of candidates) {
		const model = resolveModel(candidate, allowedModels);
		const key = model.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		resolved.push(model);
	}

	return resolved;
}

function parseWebSearch(value) {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["1", "true", "yes"].includes(normalized)) {
			return true;
		}
		if (["0", "false", "no"].includes(normalized)) {
			return false;
		}
	}
	return true;
}

function resolveOurTerms(value) {
	if (typeof value !== "string" || !value.trim()) {
		return OUR_TERMS_DEFAULT;
	}

	const normalized = value.trim();
	if (normalized.length > MAX_OUR_TERMS_LENGTH) {
		const error = new Error(
			`ourTerms is too long. Maximum length is ${MAX_OUR_TERMS_LENGTH} characters.`,
		);
		error.statusCode = 400;
		throw error;
	}
	if (!OUR_TERMS_REGEX.test(normalized)) {
		const error = new Error(
			"ourTerms contains unsupported characters. Use letters, numbers, spaces, and punctuation only.",
		);
		error.statusCode = 400;
		throw error;
	}
	return normalized;
}

function resolveRunMonth(value) {
	if (typeof value !== "string" || !value.trim()) {
		return "";
	}
	const normalized = value.trim();
	if (!RUN_MONTH_REGEX.test(normalized)) {
		const error = new Error("runMonth must use YYYY-MM format.");
		error.statusCode = 400;
		throw error;
	}
	return normalized;
}

function resolvePromptLimit(value) {
	if (value === null || value === undefined || String(value).trim() === "") {
		return null;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
		const error = new Error("promptLimit must be an integer.");
		error.statusCode = 400;
		throw error;
	}
	if (parsed < 1) {
		const error = new Error("promptLimit must be at least 1.");
		error.statusCode = 400;
		throw error;
	}
	if (parsed > MAX_PROMPT_LIMIT) {
		const error = new Error(`promptLimit must be <= ${MAX_PROMPT_LIMIT}.`);
		error.statusCode = 400;
		throw error;
	}

	return parsed;
}

function resolvePromptOrder(value) {
	if (value === null || value === undefined) {
		return "default";
	}
	const normalized = String(value).trim().toLowerCase();
	if (!normalized) {
		return "default";
	}
	if (!ALLOWED_PROMPT_ORDERS.has(normalized)) {
		const error = new Error(
			'promptOrder must be either "default" or "newest".',
		);
		error.statusCode = 400;
		throw error;
	}
	return normalized;
}

function resolveCohortTag(value) {
	if (value === null || value === undefined) {
		return null;
	}
	const normalized = String(value).trim().toLowerCase();
	if (!normalized) {
		return null;
	}
	if (normalized.length > 120) {
		const error = new Error(
			"cohortTag is too long. Maximum length is 120 characters.",
		);
		error.statusCode = 400;
		throw error;
	}
	if (!/^[a-z0-9:_-]+$/.test(normalized)) {
		const error = new Error(
			"cohortTag may only include lowercase letters, numbers, colon, underscore, and hyphen.",
		);
		error.statusCode = 400;
		throw error;
	}
	return normalized;
}

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function findTriggeredRun(triggerId) {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const runs = await listWorkflowRuns(15);
		const match = runs.find((run) => run.title.includes(triggerId));
		if (match) {
			return match;
		}
		await sleep(1000);
	}
	return null;
}

function isQueueTriggerEnabled() {
	return parseBoolean(process.env.USE_QUEUE_TRIGGER, false);
}

function getErrorSearchText(error) {
	const segments = [];
	if (error instanceof Error && error.message) {
		segments.push(error.message);
	}
	const payload =
		typeof error === "object" && error !== null ? error.payload : null;
	if (payload && typeof payload === "object") {
		for (const key of ["message", "details", "hint", "error"]) {
			const value = payload[key];
			if (typeof value === "string" && value.trim()) {
				segments.push(value);
			}
		}
	}
	return segments.join(" ").toLowerCase();
}

function isSupabaseUnavailable(error) {
	const text = getErrorSearchText(error);
	return (
		text.includes("failed to fetch") ||
		text.includes("fetch failed") ||
		text.includes("networkerror") ||
		text.includes("enotfound") ||
		text.includes("econnrefused") ||
		text.includes("etimedout") ||
		text.includes("missing supabase env config") ||
		text.includes("supabase is not configured")
	);
}

function getSupabaseRestConfig() {
	const supabaseUrl = String(process.env.SUPABASE_URL || "")
		.trim()
		.replace(/\/$/, "");
	const anonKey = String(
		process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
	).trim();
	const serviceRoleKey = String(
		process.env.SUPABASE_SERVICE_ROLE_KEY || "",
	).trim();

	if (!supabaseUrl || !anonKey || !serviceRoleKey) {
		const error = new Error(
			"Missing Supabase env config. Set SUPABASE_URL, SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY), and SUPABASE_SERVICE_ROLE_KEY.",
		);
		error.statusCode = 500;
		throw error;
	}

	return {
		supabaseUrl,
		headers: {
			apikey: anonKey,
			Authorization: `Bearer ${serviceRoleKey}`,
			"Content-Type": "application/json",
			Prefer: "return=representation",
		},
	};
}

async function supabaseRestRequest(config, path, method, body, contextLabel) {
	const response = await fetch(`${config.supabaseUrl}${path}`, {
		method,
		headers: config.headers,
		body: body === undefined ? undefined : JSON.stringify(body),
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
			(payload &&
				typeof payload === "object" &&
				(payload.message || payload.error || payload.hint)) ||
			`${contextLabel} failed (${response.status})`;
		const error = new Error(String(message));
		error.statusCode = response.status >= 500 ? 502 : response.status;
		error.payload = payload;
		throw error;
	}

	return payload;
}

function getSupabaseErrorSearchText(error) {
	const segments = [];
	if (error instanceof Error && error.message) {
		segments.push(error.message);
	}
	const payload =
		typeof error === "object" && error !== null ? error.payload : null;
	if (payload && typeof payload === "object") {
		for (const key of ["message", "details", "hint", "error"]) {
			const value = payload[key];
			if (typeof value === "string" && value.trim()) {
				segments.push(value);
			}
		}
	}
	return segments.join(" ").toLowerCase();
}

function isMissingSupabaseColumn(error, columnName) {
	const payload =
		typeof error === "object" && error !== null ? error.payload : null;
	const code =
		typeof payload === "object" && payload !== null && typeof payload.code === "string"
			? payload.code
			: typeof error === "object" && error !== null && typeof error.code === "string"
				? error.code
				: "";
	const searchText = getSupabaseErrorSearchText(error);
	if (!searchText.includes(columnName.toLowerCase())) {
		return false;
	}
	return (
		code === "42703" ||
		code === "PGRST204" ||
		(searchText.includes("could not find the") &&
			searchText.includes("column") &&
			searchText.includes("schema cache"))
	);
}

function isEnqueueFunctionCompatibilityError(error, parameterName) {
	const searchText = getSupabaseErrorSearchText(error);
	return (
		searchText.includes("enqueue_benchmark_run") &&
		searchText.includes(parameterName.toLowerCase()) &&
		(searchText.includes("could not find the function") ||
			searchText.includes("unexpected inputs provided") ||
			searchText.includes("schema cache"))
	);
}

async function ensureTaggedPromptsExist(restConfig, cohortTag) {
	if (!cohortTag) {
		return;
	}
	const tagFilter = encodeURIComponent(`{${cohortTag}}`);
	const rows = await supabaseRestRequest(
		restConfig,
		`/rest/v1/prompt_queries?select=id&is_active=eq.true&tags=cs.${tagFilter}&limit=1`,
		"GET",
		undefined,
		"Validate cohort tag",
	);
	if (!Array.isArray(rows) || rows.length === 0) {
		const error = new Error(
			`No active prompts match cohortTag "${cohortTag}".`,
		);
		error.statusCode = 400;
		throw error;
	}
}

async function triggerViaQueue(
	_body,
	models,
	runs,
	temperature,
	webSearch,
	ourTerms,
	runMonth,
	promptLimit,
	promptOrder,
	cohortTag,
) {
	const restConfig = getSupabaseRestConfig();
	const effectiveRunMonth = runMonth || new Date().toISOString().slice(0, 7);
	const runKind = cohortTag ? "cohort" : "full";

	await ensureTaggedPromptsExist(restConfig, cohortTag);

	const runPayload = {
		run_month: effectiveRunMonth,
		model: models.join(","),
		web_search_enabled: Boolean(webSearch),
		started_at: new Date().toISOString(),
	};
	if (cohortTag) {
		runPayload.run_kind = runKind;
		runPayload.cohort_tag = cohortTag;
	}

	let runInsertPayload;
	try {
		runInsertPayload = await supabaseRestRequest(
			restConfig,
			"/rest/v1/benchmark_runs",
			"POST",
			runPayload,
			"Insert benchmark run",
		);
	} catch (error) {
		if (
			cohortTag &&
			(isMissingSupabaseColumn(error, "run_kind") ||
				isMissingSupabaseColumn(error, "cohort_tag"))
		) {
			const compatibilityError = new Error(
				"Cohort runs require the latest Supabase migrations.",
			);
			compatibilityError.statusCode = 400;
			throw compatibilityError;
		}
		throw error;
	}

	const insertedRun = Array.isArray(runInsertPayload)
		? runInsertPayload[0]
		: runInsertPayload;
	const runId =
		insertedRun && typeof insertedRun === "object"
			? String(insertedRun.id || "")
			: "";

	if (!runId) {
		const error = new Error("Supabase did not return benchmark run id.");
		error.statusCode = 502;
		throw error;
	}

	const enqueueRequestBody = {
		p_run_id: runId,
		p_models: models,
		p_our_terms: ourTerms,
		p_runs_per_model: runs,
		p_temperature: temperature,
		p_web_search: webSearch,
		p_prompt_limit: promptLimit,
	};
	if (cohortTag) {
		enqueueRequestBody.p_prompt_tag = cohortTag;
	}
	if (promptOrder !== "default") {
		enqueueRequestBody.p_prompt_order = promptOrder;
	}

	let enqueuePayload;
	try {
		enqueuePayload = await supabaseRestRequest(
			restConfig,
			"/rest/v1/rpc/enqueue_benchmark_run",
			"POST",
			enqueueRequestBody,
			"Enqueue benchmark jobs",
		);
	} catch (error) {
		if (
			promptOrder !== "default" &&
			isEnqueueFunctionCompatibilityError(error, "p_prompt_order")
		) {
			const compatibilityError = new Error(
				"Prompt filter order is not deployed in Supabase yet. Apply latest migrations and retry.",
			);
			compatibilityError.statusCode = 400;
			throw compatibilityError;
		}
		if (
			cohortTag &&
			isEnqueueFunctionCompatibilityError(error, "p_prompt_tag")
		) {
			const compatibilityError = new Error(
				"Cohort runs require the latest Supabase migrations.",
			);
			compatibilityError.statusCode = 400;
			throw compatibilityError;
		}
		throw error;
	}

	const enqueueResult = Array.isArray(enqueuePayload)
		? enqueuePayload[0]
		: enqueuePayload;
	const jobsEnqueued =
		enqueueResult && typeof enqueueResult === "object"
			? Number(enqueueResult.jobs_enqueued || 0)
			: 0;

	return {
		runId,
		jobsEnqueued,
		models,
		promptLimit,
		promptOrder,
		runMonth: effectiveRunMonth,
		runKind,
		cohortTag,
	};
}

async function triggerViaGitHub(
	model,
	models,
	runs,
	temperature,
	webSearch,
	ourTerms,
	runMonth,
	promptLimit,
) {
	const config = getGitHubConfig();
	const triggerId = `ui-${Date.now()}`;
	const workflowInputs = {
		trigger_id: triggerId,
		model,
		models: models.join(","),
		runs: String(runs),
		temperature: String(temperature),
		web_search: webSearch ? "true" : "false",
		our_terms: ourTerms,
		run_month: runMonth,
	};
	if (promptLimit !== null) {
		workflowInputs.prompt_limit = String(promptLimit);
	}

	await dispatchWorkflow(workflowInputs);
	const matchedRun = await findTriggeredRun(triggerId);

	return {
		triggerId,
		workflow: config.workflow,
		repo: `${config.owner}/${config.repo}`,
		ref: config.ref,
		run: matchedRun,
		message: matchedRun
			? "Benchmark run queued in GitHub Actions."
			: "Benchmark dispatch sent. Run may take a few seconds to appear.",
	};
}

module.exports = async (req, res) => {
	try {
		if (req.method !== "POST") {
			return sendJson(res, 405, { error: "Method not allowed. Use POST." });
		}

		const rateLimitMax = Math.round(
			normalizeNumber(process.env.BENCHMARK_TRIGGER_RATE_MAX, 5, 1, 100),
		);
		const rateLimitWindowMs = Math.round(
			normalizeNumber(
				process.env.BENCHMARK_TRIGGER_RATE_WINDOW_MS,
				60 * 1000,
				15 * 1000,
				60 * 60 * 1000,
			),
		);
		enforceRateLimit(req, {
			bucket: "benchmark-trigger",
			max: rateLimitMax,
			windowMs: rateLimitWindowMs,
		});

		enforceTriggerToken(req);
		const body = parseBody(req);
		const allowedModels = getAllowedModels();

		const models = resolveModels(body, allowedModels);
		const model = models[0];
		const ourTerms = resolveOurTerms(body.ourTerms);
		const runs = Math.round(normalizeNumber(body.runs, 1, 1, 3));
		const temperature = normalizeNumber(body.temperature, 0.7, 0, 2);
		const webSearch = parseWebSearch(body.webSearch);
		const runMonth = resolveRunMonth(body.runMonth);
		const promptLimit = resolvePromptLimit(
			body.promptLimit ?? body.prompt_limit,
		);
		const promptOrder = resolvePromptOrder(
			body.promptOrder ?? body.prompt_order,
		);
		const cohortTag = resolveCohortTag(body.cohortTag ?? body.cohort_tag);

		if (isQueueTriggerEnabled()) {
			try {
				const queueResult = await triggerViaQueue(
					body,
					models,
					runs,
					temperature,
					webSearch,
					ourTerms,
					runMonth,
					promptLimit,
					promptOrder,
					cohortTag,
				);

				return sendJson(res, 200, {
					ok: true,
					runId: queueResult.runId,
					jobsEnqueued: queueResult.jobsEnqueued,
					models: queueResult.models,
					promptLimit: queueResult.promptLimit,
					promptOrder: queueResult.promptOrder,
					runMonth: queueResult.runMonth,
					runKind: queueResult.runKind,
					cohortTag: queueResult.cohortTag,
					message: "Benchmark jobs enqueued.",
				});
			} catch (error) {
				if (!isSupabaseUnavailable(error) || cohortTag) {
					throw error;
				}
				console.warn(
					"[benchmark.trigger] Queue backend unavailable, falling back to GitHub Actions.",
					error,
				);
				const githubResult = await triggerViaGitHub(
					model,
					models,
					runs,
					temperature,
					webSearch,
					ourTerms,
					runMonth,
					promptLimit,
				);

				return sendJson(res, 200, {
					ok: true,
					models,
					promptLimit,
					runKind: "full",
					cohortTag: null,
					...githubResult,
				});
			}
		}

		if (cohortTag) {
			const error = new Error(
				"cohortTag is only supported when USE_QUEUE_TRIGGER=true.",
			);
			error.statusCode = 400;
			throw error;
		}

		const githubResult = await triggerViaGitHub(
			model,
			models,
			runs,
			temperature,
			webSearch,
			ourTerms,
			runMonth,
			promptLimit,
		);

		return sendJson(res, 200, {
			ok: true,
			models,
			promptLimit,
			runKind: "full",
			cohortTag: null,
			...githubResult,
		});
	} catch (error) {
		const statusCode =
			typeof error === "object" && error !== null && Number(error.statusCode)
				? Number(error.statusCode)
				: 500;
		if (
			typeof error === "object" &&
			error !== null &&
			Number(error.retryAfterSeconds)
		) {
			res.setHeader(
				"Retry-After",
				String(Math.round(Number(error.retryAfterSeconds))),
			);
		}
		if (statusCode >= 500) {
			console.error("[benchmark.trigger] request failed", error);
		}
		const message =
			statusCode >= 500
				? "Internal server error."
				: error instanceof Error
					? error.message
					: String(error);
		return sendJson(res, statusCode, { error: message });
	}
};
