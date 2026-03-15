const { enforceRateLimit, enforceTriggerToken } = require("../_rate-limit");
const {
	sendJson,
	parseBody,
	ensureResearchFeaturesEnabled,
	getSupabaseRestConfig,
	supabaseRestRequest,
	cleanText,
} = require("./_shared");

function normalizeTag(value) {
	return cleanText(value).toLowerCase();
}

function normalizeDisplayName(value, fallbackTag) {
	const normalized = cleanText(value);
	if (normalized) {
		return normalized;
	}
	return fallbackTag;
}

function normalizeTargetPp(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return 5;
	}
	return Math.max(0.1, Math.min(100, Number(parsed.toFixed(2))));
}

function normalizeTargetWeeks(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return 8;
	}
	return Math.max(1, Math.min(52, Math.round(parsed)));
}

function hasOwn(value, key) {
	return (
		typeof value === "object" && value !== null && Object.hasOwn(value, key)
	);
}

async function resolveBaselineRunId(config, providedBaselineRunId) {
	const provided = cleanText(providedBaselineRunId);
	if (provided) {
		const runRows = await supabaseRestRequest(
			config,
			`/rest/v1/benchmark_runs?select=id,ended_at&limit=1&id=eq.${encodeURIComponent(provided)}`,
			"GET",
			undefined,
			"Validate baseline run",
		);
		const run = Array.isArray(runRows) ? runRows[0] : null;
		if (!run?.id) {
			const error = new Error("baselineRunId not found.");
			error.statusCode = 404;
			throw error;
		}
		if (!run?.ended_at) {
			const error = new Error(
				"baselineRunId must reference a completed benchmark run.",
			);
			error.statusCode = 400;
			throw error;
		}
		return run.id;
	}

	const latestRuns = await supabaseRestRequest(
		config,
		"/rest/v1/benchmark_runs?select=id&ended_at=not.is.null&order=created_at.desc&limit=1",
		"GET",
		undefined,
		"Load latest completed run for baseline",
	);
	const latest = Array.isArray(latestRuns) ? latestRuns[0] : null;
	if (!latest?.id) {
		const error = new Error("No completed benchmark run found for baseline.");
		error.statusCode = 400;
		throw error;
	}
	return latest.id;
}

module.exports = async (req, res) => {
	try {
		ensureResearchFeaturesEnabled();

		if (req.method === "GET") {
			const config = getSupabaseRestConfig();
			const rows = await supabaseRestRequest(
				config,
				"/rest/v1/prompt_research_cohorts?select=id,tag,display_name,baseline_run_id,baseline_locked_at,target_pp,target_weeks,is_active,created_at,updated_at&order=is_active.desc,created_at.desc",
				"GET",
				undefined,
				"Load prompt cohorts",
			);
			return sendJson(res, 200, {
				ok: true,
				cohorts: Array.isArray(rows) ? rows : [],
			});
		}

		if (req.method !== "POST") {
			return sendJson(res, 405, {
				error: "Method not allowed. Use GET or POST.",
			});
		}

		enforceRateLimit(req, {
			bucket: "research-prompt-cohorts",
			max: 10,
			windowMs: 60 * 1000,
		});
		enforceTriggerToken(req);

		const body = parseBody(req);
		const tag = normalizeTag(body.tag);
		if (!tag) {
			const error = new Error("tag is required.");
			error.statusCode = 400;
			throw error;
		}

		const config = getSupabaseRestConfig();

		const existingRows = await supabaseRestRequest(
			config,
			`/rest/v1/prompt_research_cohorts?select=id,tag,display_name,baseline_run_id,target_pp,target_weeks,is_active&limit=1&tag=eq.${encodeURIComponent(tag)}`,
			"GET",
			undefined,
			"Load existing cohort by tag",
		);
		const existingCohort = Array.isArray(existingRows) ? existingRows[0] : null;

		const taggedPromptRows = await supabaseRestRequest(
			config,
			`/rest/v1/prompt_queries?select=id&is_active=eq.true&tags=cs.${encodeURIComponent(`{${tag}}`)}&limit=1`,
			"GET",
			undefined,
			"Validate cohort tag against prompts",
		);

		if (!Array.isArray(taggedPromptRows) || taggedPromptRows.length === 0) {
			const error = new Error(`No active prompts found for tag "${tag}".`);
			error.statusCode = 400;
			throw error;
		}

		const baselineRunId = hasOwn(body, "baselineRunId")
			? await resolveBaselineRunId(config, body.baselineRunId)
			: cleanText(existingCohort?.baseline_run_id) ||
				(await resolveBaselineRunId(config, body.baselineRunId));
		const displayName = hasOwn(body, "displayName")
			? normalizeDisplayName(body.displayName, tag)
			: normalizeDisplayName(existingCohort?.display_name, tag);
		const targetPp = hasOwn(body, "targetPp")
			? normalizeTargetPp(body.targetPp)
			: normalizeTargetPp(existingCohort?.target_pp);
		const targetWeeks = hasOwn(body, "targetWeeks")
			? normalizeTargetWeeks(body.targetWeeks)
			: normalizeTargetWeeks(existingCohort?.target_weeks);
		const isActive = hasOwn(body, "isActive")
			? Boolean(body.isActive)
			: existingCohort?.is_active !== undefined
				? Boolean(existingCohort.is_active)
				: true;

		const rows = await supabaseRestRequest(
			config,
			"/rest/v1/prompt_research_cohorts?on_conflict=tag",
			"POST",
			[
				{
					tag,
					display_name: displayName,
					baseline_run_id: baselineRunId,
					target_pp: targetPp,
					target_weeks: targetWeeks,
					is_active: isActive,
				},
			],
			"Upsert prompt cohort",
			{
				Prefer: "resolution=merge-duplicates,return=representation",
			},
		);

		const cohort = Array.isArray(rows) ? rows[0] : rows;

		return sendJson(res, 200, {
			ok: true,
			cohort,
		});
	} catch (error) {
		const statusCode =
			typeof error === "object" && error !== null && Number(error.statusCode)
				? Number(error.statusCode)
				: 500;

		if (statusCode >= 500) {
			console.error("[research.prompt-cohorts] request failed", error);
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
