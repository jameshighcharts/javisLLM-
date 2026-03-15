const { enforceRateLimit, enforceTriggerToken } = require("../_rate-limit");

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

function cleanRunId(value) {
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
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

async function supabaseRestRequest(
	config,
	path,
	{
		method = "GET",
		body,
		contextLabel = "Supabase request",
		headers = {},
	} = {},
) {
	const response = await fetch(`${config.supabaseUrl}${path}`, {
		method,
		headers: {
			...config.headers,
			...headers,
		},
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

function isReasonableRunId(runId) {
	return /^[a-zA-Z0-9-]{8,120}$/.test(runId);
}

async function resolveTargetRunId(config, explicitRunId) {
	if (explicitRunId) {
		const runRows = await supabaseRestRequest(
			config,
			`/rest/v1/benchmark_runs?select=id&limit=1&id=eq.${encodeURIComponent(explicitRunId)}`,
			{ contextLabel: "Validate benchmark run id" },
		);
		const first = Array.isArray(runRows) ? runRows[0] : null;
		if (
			!first ||
			typeof first !== "object" ||
			!cleanRunId(String(first.id || ""))
		) {
			const error = new Error("Run not found.");
			error.statusCode = 404;
			throw error;
		}
		return explicitRunId;
	}

	const activeProgressRows = await supabaseRestRequest(
		config,
		"/rest/v1/vw_job_progress?select=run_id,status,created_at&status=in.(pending,running)&order=created_at.desc&limit=50",
		{ contextLabel: "Load active queue runs" },
	);

	const first = Array.isArray(activeProgressRows)
		? activeProgressRows[0]
		: null;
	const runId =
		first && typeof first === "object"
			? cleanRunId(String(first.run_id || ""))
			: "";
	if (!runId) {
		const error = new Error("No active queue runs found.");
		error.statusCode = 404;
		throw error;
	}
	return runId;
}

function parseFinalizeResult(payload) {
	if (typeof payload === "boolean") {
		return payload;
	}
	if (Array.isArray(payload)) {
		if (payload.length === 0) return false;
		return parseFinalizeResult(payload[0]);
	}
	if (payload && typeof payload === "object") {
		if ("finalize_benchmark_run" in payload) {
			return Boolean(payload.finalize_benchmark_run);
		}
		if ("result" in payload) {
			return Boolean(payload.result);
		}
	}
	return Boolean(payload);
}

async function stopQueueRun(config, runId) {
	const nowIso = new Date().toISOString();
	const cancelMessage = "Cancelled manually from Runs page.";

	const jobRows = await supabaseRestRequest(
		config,
		`/rest/v1/benchmark_jobs?select=id,pgmq_msg_id&run_id=eq.${encodeURIComponent(
			runId,
		)}&status=in.(pending,processing,failed)&limit=10000`,
		{ contextLabel: "Load cancelable jobs" },
	);
	const cancelableJobs = Array.isArray(jobRows) ? jobRows : [];

	let archivedMessages = 0;
	for (const job of cancelableJobs) {
		const rawMsgId =
			job && typeof job === "object" && Number.isFinite(Number(job.pgmq_msg_id))
				? Number(job.pgmq_msg_id)
				: 0;
		if (rawMsgId <= 0) {
			continue;
		}
		try {
			const archiveResult = await supabaseRestRequest(
				config,
				"/rest/v1/rpc/rpc_pgmq_archive",
				{
					method: "POST",
					body: {
						p_queue: "benchmark_jobs",
						p_msg_id: rawMsgId,
					},
					contextLabel: `Archive queue message ${rawMsgId}`,
				},
			);
			if (archiveResult === true) {
				archivedMessages += 1;
			}
		} catch {
			// Message may already be gone (in-flight/archived); status update still prevents processing.
		}
	}

	const cancelledRows = await supabaseRestRequest(
		config,
		`/rest/v1/benchmark_jobs?run_id=eq.${encodeURIComponent(
			runId,
		)}&status=in.(pending,processing,failed)`,
		{
			method: "PATCH",
			body: {
				status: "dead_letter",
				completed_at: nowIso,
				last_error: cancelMessage,
			},
			contextLabel: "Cancel benchmark jobs",
			headers: { Prefer: "return=representation" },
		},
	);
	const cancelledJobCount = Array.isArray(cancelledRows)
		? cancelledRows.length
		: 0;

	const finalizeResult = await supabaseRestRequest(
		config,
		"/rest/v1/rpc/finalize_benchmark_run",
		{
			method: "POST",
			body: { p_run_id: runId },
			contextLabel: "Finalize benchmark run",
		},
	);

	return {
		cancelledJobCount,
		archivedMessages,
		finalized: parseFinalizeResult(finalizeResult),
	};
}

module.exports = async (req, res) => {
	try {
		if (req.method !== "POST") {
			return sendJson(res, 405, { error: "Method not allowed. Use POST." });
		}

		const rateLimitMax = Number(process.env.BENCHMARK_STOP_RATE_MAX || 10);
		const rateLimitWindowMs = Number(
			process.env.BENCHMARK_STOP_RATE_WINDOW_MS || 60 * 1000,
		);
		enforceRateLimit(req, {
			bucket: "benchmark-stop",
			max: Number.isFinite(rateLimitMax) ? rateLimitMax : 10,
			windowMs: Number.isFinite(rateLimitWindowMs)
				? rateLimitWindowMs
				: 60 * 1000,
		});

		enforceTriggerToken(req);

		if (!isQueueTriggerEnabled()) {
			const error = new Error(
				"Stop is only supported when USE_QUEUE_TRIGGER=true.",
			);
			error.statusCode = 400;
			throw error;
		}

		const body = parseBody(req);
		const requestedRunId = cleanRunId(body.runId ?? body.run_id);
		if (requestedRunId && !isReasonableRunId(requestedRunId)) {
			const error = new Error("Invalid runId format.");
			error.statusCode = 400;
			throw error;
		}

		const restConfig = getSupabaseRestConfig();
		const runId = await resolveTargetRunId(restConfig, requestedRunId);
		const result = await stopQueueRun(restConfig, runId);

		return sendJson(res, 200, {
			ok: true,
			runId,
			cancelledJobs: result.cancelledJobCount,
			archivedMessages: result.archivedMessages,
			finalized: result.finalized,
			message:
				result.cancelledJobCount > 0
					? `Stopped run ${runId}.`
					: `Run ${runId} had no active jobs to stop.`,
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
			console.error("[benchmark.stop] request failed", error);
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
