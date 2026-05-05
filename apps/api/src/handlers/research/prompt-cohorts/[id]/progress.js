const {
	sendJson,
	ensureResearchFeaturesEnabled,
	getSupabaseRestConfig,
	supabaseRestRequest,
	cleanText,
	toNumber,
	computeProgressPct,
	addWeeks,
} = require("../../_shared");

function chunkArray(values, size) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

function isSupabaseFetchFailure(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	const normalized = message.toLowerCase();
	return (
		normalized.includes("failed to fetch") ||
		normalized.includes("fetch failed") ||
		normalized.includes("networkerror") ||
		normalized.includes("enotfound") ||
		normalized.includes("econnrefused") ||
		normalized.includes("etimedout") ||
		normalized.includes("missing supabase env config") ||
		normalized.includes("supabase is not configured")
	);
}

async function fetchAverageMentionRateForRun(
	config,
	runId,
	promptIds,
	competitorId,
) {
	if (!runId || promptIds.length === 0 || !competitorId) {
		return null;
	}

	const rateByPromptId = new Map();

	for (const chunk of chunkArray(promptIds, 120)) {
		const inClause = chunk.join(",");
		const rows = await supabaseRestRequest(
			config,
			`/rest/v1/mv_competitor_mention_rates?select=query_id,mentions_rate_pct&run_id=eq.${encodeURIComponent(runId)}&is_overall_row=eq.false&competitor_id=eq.${encodeURIComponent(competitorId)}&query_id=in.(${encodeURIComponent(inClause)})&limit=100000`,
			"GET",
			undefined,
			"Load mention rates for cohort run",
		);

		for (const row of Array.isArray(rows) ? rows : []) {
			const queryId = cleanText(row?.query_id);
			if (!queryId) {
				continue;
			}
			rateByPromptId.set(queryId, toNumber(row?.mentions_rate_pct, 0));
		}
	}

	const totalRate = promptIds.reduce(
		(sum, promptId) => sum + (rateByPromptId.get(promptId) || 0),
		0,
	);
	return promptIds.length > 0 ? totalRate / promptIds.length : null;
}

module.exports = async (req, res) => {
	try {
		if (req.method !== "GET") {
			return sendJson(res, 405, { error: "Method not allowed. Use GET." });
		}

		ensureResearchFeaturesEnabled();

		const cohortId = cleanText(req.query?.id);
		if (!cohortId) {
			const error = new Error("Cohort id is required in route path.");
			error.statusCode = 400;
			throw error;
		}

		const config = getSupabaseRestConfig();

		const cohortRows = await supabaseRestRequest(
			config,
			`/rest/v1/prompt_research_cohorts?select=id,tag,display_name,baseline_run_id,baseline_locked_at,target_pp,target_weeks,is_active&limit=1&id=eq.${encodeURIComponent(cohortId)}`,
			"GET",
			undefined,
			"Load prompt cohort",
		);
		const cohort = Array.isArray(cohortRows) ? cohortRows[0] : null;
		if (!cohort?.id) {
			const error = new Error("Prompt cohort not found.");
			error.statusCode = 404;
			throw error;
		}

		const promptRows = await supabaseRestRequest(
			config,
			`/rest/v1/prompt_queries?select=id&is_active=eq.true&tags=cs.${encodeURIComponent(`{${cohort.tag}}`)}&order=sort_order.asc,created_at.asc`,
			"GET",
			undefined,
			"Load cohort prompts",
		);
		const promptIds = (Array.isArray(promptRows) ? promptRows : [])
			.map((row) => cleanText(row?.id))
			.filter(Boolean);

		const competitorRows = await supabaseRestRequest(
			config,
			"/rest/v1/competitors?select=id,slug,is_primary&is_active=eq.true&order=sort_order.asc,name.asc",
			"GET",
			undefined,
			"Load competitors",
		);
		const primaryCompetitor =
			(Array.isArray(competitorRows) ? competitorRows : []).find(
				(row) => row?.is_primary,
			) ||
			(Array.isArray(competitorRows) ? competitorRows : []).find(
				(row) => cleanText(row?.slug).toLowerCase() === "highcharts",
			) ||
			null;

		const baselineMetric = await fetchAverageMentionRateForRun(
			config,
			cleanText(cohort.baseline_run_id),
			promptIds,
			cleanText(primaryCompetitor?.id),
		);

		const currentRunRows = await supabaseRestRequest(
			config,
			`/rest/v1/benchmark_runs?select=id,created_at,ended_at,run_kind,cohort_tag&run_kind=eq.cohort&cohort_tag=eq.${encodeURIComponent(cohort.tag)}&ended_at=not.is.null&order=created_at.desc&limit=1`,
			"GET",
			undefined,
			"Load latest cohort run",
		);
		const currentRun = Array.isArray(currentRunRows) ? currentRunRows[0] : null;

		const currentMetric = await fetchAverageMentionRateForRun(
			config,
			cleanText(currentRun?.id),
			promptIds,
			cleanText(primaryCompetitor?.id),
		);

		const trendRuns = await supabaseRestRequest(
			config,
			`/rest/v1/benchmark_runs?select=id,created_at,ended_at&run_kind=eq.cohort&cohort_tag=eq.${encodeURIComponent(cohort.tag)}&ended_at=not.is.null&order=created_at.asc&limit=12`,
			"GET",
			undefined,
			"Load cohort trend runs",
		);

		const trend = [];
		for (const run of Array.isArray(trendRuns) ? trendRuns : []) {
			const metric = await fetchAverageMentionRateForRun(
				config,
				cleanText(run?.id),
				promptIds,
				cleanText(primaryCompetitor?.id),
			);
			trend.push({
				runId: cleanText(run?.id) || null,
				createdAt: cleanText(run?.created_at) || null,
				metric: metric === null ? null : Number(metric.toFixed(2)),
			});
		}

		const baselineRate =
			baselineMetric === null ? null : Number(baselineMetric.toFixed(2));
		const currentRate =
			currentMetric === null ? null : Number(currentMetric.toFixed(2));
		const upliftPp =
			baselineMetric === null || currentMetric === null
				? null
				: Number((currentMetric - baselineMetric).toFixed(2));

		const targetPp = toNumber(cohort.target_pp, 5);
		const progressPct =
			upliftPp === null
				? 0
				: Number(computeProgressPct(upliftPp, targetPp).toFixed(2));

		return sendJson(res, 200, {
			ok: true,
			cohort: {
				id: cohort.id,
				tag: cohort.tag,
				displayName: cohort.display_name,
				baselineRunId: cohort.baseline_run_id,
				baselineLockedAt: cohort.baseline_locked_at,
				targetPp,
				targetWeeks: toNumber(cohort.target_weeks, 8),
				isActive: Boolean(cohort.is_active),
			},
			promptCount: promptIds.length,
			baselineRate,
			currentRate,
			currentRunId: currentRun?.id || null,
			upliftPp,
			progressPct,
			dueDate: addWeeks(
				cohort.baseline_locked_at,
				toNumber(cohort.target_weeks, 8),
			),
			trend,
		});
	} catch (error) {
		if (req.method === "GET" && isSupabaseFetchFailure(error)) {
			const fallbackId = cleanText(req.query?.id) || "snapshot";
			console.warn(
				"[research.prompt-cohorts.progress] Supabase unavailable, returning empty snapshot",
			);
			return sendJson(res, 200, {
				ok: true,
				cohort: {
					id: fallbackId,
					tag: fallbackId,
					displayName: fallbackId,
					baselineRunId: "",
					baselineLockedAt: "",
					targetPp: 5,
					targetWeeks: 8,
					isActive: false,
				},
				promptCount: 0,
				baselineRate: null,
				currentRate: null,
				currentRunId: null,
				upliftPp: null,
				progressPct: 0,
				dueDate: null,
				trend: [],
			});
		}

		const statusCode =
			typeof error === "object" && error !== null && Number(error.statusCode)
				? Number(error.statusCode)
				: 500;

		if (statusCode >= 500) {
			console.error("[research.prompt-cohorts.progress] request failed", error);
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
