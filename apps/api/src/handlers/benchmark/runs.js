const { enforceRateLimit, enforceTriggerToken } = require("../_rate-limit");
const { getGitHubConfig, listWorkflowRuns } = require("../_github");

function sendJson(res, statusCode, payload) {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
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
		},
	};
}

async function supabaseRestRequest(config, path, contextLabel) {
	const response = await fetch(`${config.supabaseUrl}${path}`, {
		method: "GET",
		headers: config.headers,
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

	return Array.isArray(payload) ? payload : [];
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

function buildBenchmarkRunsPath(includeRunMetadata) {
	const columns = includeRunMetadata
		? "id,run_month,model,run_kind,cohort_tag,web_search_enabled,overall_score,created_at"
		: "id,run_month,model,web_search_enabled,overall_score,created_at";
	return `/rest/v1/benchmark_runs?select=${columns}&order=created_at.desc&limit=30`;
}

function deriveQueueRunStatus(progress) {
	const totalJobs = Number(progress?.total_jobs || 0);
	const completedJobs = Number(progress?.completed_jobs || 0);
	const processingJobs = Number(progress?.processing_jobs || 0);
	const pendingJobs = Number(progress?.pending_jobs || 0);
	const failedJobs = Number(progress?.failed_jobs || 0);
	const deadLetterJobs = Number(progress?.dead_letter_jobs || 0);

	if (totalJobs <= 0) {
		return "pending";
	}
	if (
		deadLetterJobs > 0 &&
		processingJobs === 0 &&
		pendingJobs === 0 &&
		failedJobs === 0 &&
		completedJobs + deadLetterJobs === totalJobs
	) {
		return "failed";
	}
	if (completedJobs === totalJobs) {
		return "completed";
	}
	if (processingJobs > 0 || failedJobs > 0) {
		return "running";
	}
	return "pending";
}

async function listQueueRuns() {
	try {
		const restConfig = getSupabaseRestConfig();
		let runs;
		try {
			runs = await supabaseRestRequest(
				restConfig,
				buildBenchmarkRunsPath(true),
				"Fetch benchmark runs",
			);
		} catch (error) {
			if (
				!isMissingSupabaseColumn(error, "run_kind") &&
				!isMissingSupabaseColumn(error, "cohort_tag")
			) {
				throw error;
			}
			runs = await supabaseRestRequest(
				restConfig,
				buildBenchmarkRunsPath(false),
				"Fetch benchmark runs",
			);
		}

		if (runs.length === 0) {
			return { runs: [] };
		}

		const progressRows = await supabaseRestRequest(
			restConfig,
			"/rest/v1/vw_job_progress?select=run_id,total_jobs,completed_jobs,processing_jobs,pending_jobs,failed_jobs,dead_letter_jobs,completion_pct,status&order=created_at.desc&limit=200",
			"Fetch job progress",
		);
		const progressByRunId = new Map();
		for (const row of progressRows) {
			if (!row || typeof row !== "object") {
				continue;
			}
			const runId = String(row.run_id || "");
			if (!runId) {
				continue;
			}
			progressByRunId.set(runId, row);
		}

		return {
			runs: runs.map((run) => {
				const runId = String(run.id || "");
				const progress = progressByRunId.get(runId) || null;

				const totalJobs = Number(progress?.total_jobs || 0);
				const completedJobs = Number(progress?.completed_jobs || 0);
				const processingJobs = Number(progress?.processing_jobs || 0);
				const pendingJobs = Number(progress?.pending_jobs || 0);
				const failedJobs = Number(progress?.failed_jobs || 0);
				const deadLetterJobs = Number(progress?.dead_letter_jobs || 0);
				const completionPct = Number(progress?.completion_pct || 0);

				return {
					id: runId,
					runMonth: run.run_month ? String(run.run_month) : null,
					models: run.model ? String(run.model) : null,
					runKind: run.run_kind ? String(run.run_kind) : "full",
					cohortTag: run.cohort_tag ? String(run.cohort_tag) : null,
					webSearchEnabled:
						typeof run.web_search_enabled === "boolean"
							? run.web_search_enabled
							: null,
					overallScore:
						typeof run.overall_score === "number"
							? Number(run.overall_score)
							: null,
					createdAt: run.created_at ? String(run.created_at) : null,
					progress: {
						totalJobs,
						completedJobs,
						processingJobs,
						pendingJobs,
						failedJobs,
						deadLetterJobs,
						completionPct,
					},
					status: deriveQueueRunStatus(progress),
				};
			}),
		};
	} catch (error) {
		if (!isSupabaseUnavailable(error)) {
			throw error;
		}

		const config = getGitHubConfig();
		const runs = await listWorkflowRuns(15);
		return {
			workflow: config.workflow,
			repo: `${config.owner}/${config.repo}`,
			runs,
		};
	}
}

module.exports = async (req, res) => {
	try {
		if (req.method !== "GET") {
			return sendJson(res, 405, { error: "Method not allowed. Use GET." });
		}

		const rateLimitMax = Number(process.env.BENCHMARK_RUNS_RATE_MAX || 30);
		const rateLimitWindowMs = Number(
			process.env.BENCHMARK_RUNS_RATE_WINDOW_MS || 60 * 1000,
		);
		enforceRateLimit(req, {
			bucket: "benchmark-runs",
			max: Number.isFinite(rateLimitMax) ? rateLimitMax : 30,
			windowMs: Number.isFinite(rateLimitWindowMs)
				? rateLimitWindowMs
				: 60 * 1000,
		});

		enforceTriggerToken(req);

		if (isQueueTriggerEnabled()) {
			const response = await listQueueRuns();
			return sendJson(res, 200, {
				ok: true,
				...response,
			});
		}

		const config = getGitHubConfig();
		const runs = await listWorkflowRuns(15);

		return sendJson(res, 200, {
			ok: true,
			workflow: config.workflow,
			repo: `${config.owner}/${config.repo}`,
			runs,
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
			console.error("[benchmark.runs] request failed", error);
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
