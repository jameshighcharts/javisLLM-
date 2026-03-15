const {
	enforceRateLimit,
	enforceTriggerToken,
} = require("../../../_rate-limit");
const {
	sendJson,
	parseBody,
	ensureResearchFeaturesEnabled,
	getSupabaseRestConfig,
	supabaseRestRequest,
} = require("../../_shared");

const ALLOWED_STATUSES = new Set([
	"backlog",
	"in_progress",
	"published",
	"verify",
	"closed",
]);

function cleanText(value) {
	return String(value || "").trim();
}

module.exports = async (req, res) => {
	try {
		if (req.method !== "PATCH") {
			return sendJson(res, 405, { error: "Method not allowed. Use PATCH." });
		}

		ensureResearchFeaturesEnabled();

		enforceRateLimit(req, {
			bucket: "research-gap-status",
			max: 20,
			windowMs: 60 * 1000,
		});
		enforceTriggerToken(req);

		const gapId = cleanText(req.query?.id);
		if (!gapId) {
			const error = new Error("Gap id is required in route path.");
			error.statusCode = 400;
			throw error;
		}

		const body = parseBody(req);
		const status = cleanText(body.status).toLowerCase();
		if (!ALLOWED_STATUSES.has(status)) {
			const error = new Error(
				`Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(", ")}`,
			);
			error.statusCode = 400;
			throw error;
		}

		const linkedPageUrl = cleanText(body.linkedPageUrl);

		const patchPayload = {
			status,
			...(linkedPageUrl ? { linked_page_url: linkedPageUrl } : {}),
		};

		const config = getSupabaseRestConfig();
		const rows = await supabaseRestRequest(
			config,
			`/rest/v1/content_gap_items?id=eq.${encodeURIComponent(gapId)}`,
			"PATCH",
			patchPayload,
			"Update content gap status",
			{ Prefer: "return=representation" },
		);

		const updated = Array.isArray(rows) ? rows[0] : rows;
		if (!updated) {
			const error = new Error("Content gap item not found.");
			error.statusCode = 404;
			throw error;
		}

		return sendJson(res, 200, {
			ok: true,
			gap: updated,
		});
	} catch (error) {
		const statusCode =
			typeof error === "object" && error !== null && Number(error.statusCode)
				? Number(error.statusCode)
				: 500;

		if (statusCode >= 500) {
			console.error("[research.gaps.status] request failed", error);
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
