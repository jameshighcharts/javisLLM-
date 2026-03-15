const { enforceRateLimit, enforceTriggerToken } = require("../../_rate-limit");
const {
	sendJson,
	parseBody,
	ensureResearchFeaturesEnabled,
	getSupabaseRestConfig,
	supabaseRestRequest,
	parseSitemapXml,
	fetchTextWithTimeout,
	extractHtmlTag,
	extractMetaDescription,
	extractCanonicalUrl,
	stripHtml,
	sha256,
	normalizeDate,
	createResearchRun,
	completeResearchRun,
	failResearchRun,
} = require("../_shared");

function normalizeMaxUrls(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return 1000;
	}
	return Math.max(1, Math.min(5000, Math.round(parsed)));
}

function asSitemapUrlList(valueJson) {
	if (Array.isArray(valueJson)) {
		return valueJson.map((value) => String(value || "").trim()).filter(Boolean);
	}
	if (valueJson && typeof valueJson === "object") {
		const urls = Array.isArray(valueJson.urls) ? valueJson.urls : [];
		return urls.map((value) => String(value || "").trim()).filter(Boolean);
	}
	return [];
}

function chunkArray(values, size) {
	const chunks = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

function countWords(text) {
	const normalized = String(text || "").trim();
	if (!normalized) {
		return 0;
	}
	return normalized.split(/\s+/).filter(Boolean).length;
}

function firstH1(html) {
	return extractHtmlTag(html, "h1");
}

async function runWithConcurrency(items, concurrency, worker) {
	const limit = Math.max(1, Math.round(concurrency));
	let index = 0;
	const results = [];

	async function runNext() {
		while (index < items.length) {
			const currentIndex = index;
			index += 1;
			results[currentIndex] = await worker(items[currentIndex], currentIndex);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, runNext),
	);
	return results;
}

module.exports = async (req, res) => {
	let researchRunId = null;
	try {
		if (req.method !== "POST") {
			return sendJson(res, 405, { error: "Method not allowed. Use POST." });
		}

		ensureResearchFeaturesEnabled();

		enforceRateLimit(req, {
			bucket: "research-sitemap-sync",
			max: 4,
			windowMs: 60 * 1000,
		});
		enforceTriggerToken(req);

		const body = parseBody(req);
		const maxUrls = normalizeMaxUrls(body.maxUrls);
		const config = getSupabaseRestConfig();

		researchRunId = await createResearchRun(config, {
			runType: "sitemap_sync",
			params: { maxUrls },
		});

		const settingsRows = await supabaseRestRequest(
			config,
			"/rest/v1/app_settings?select=key,value_json&key=eq.brand_sitemap_urls&limit=1",
			"GET",
			undefined,
			"Load app settings",
		);
		const settingRow = Array.isArray(settingsRows) ? settingsRows[0] : null;
		const sitemapUrls = asSitemapUrlList(settingRow?.value_json);

		if (sitemapUrls.length === 0) {
			const error = new Error(
				"app_settings.brand_sitemap_urls is empty. Add sitemap URLs before syncing.",
			);
			error.statusCode = 400;
			throw error;
		}

		const pendingSitemaps = sitemapUrls.map((url) => ({ url, depth: 0 }));
		const visitedSitemaps = new Set();
		const pageEntries = [];
		let sitemapFetchErrors = 0;

		while (pendingSitemaps.length > 0 && pageEntries.length < maxUrls) {
			const current = pendingSitemaps.shift();
			if (!current) {
				break;
			}

			if (current.depth > 2) {
				continue;
			}

			const sitemapUrl = String(current.url || "").trim();
			if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) {
				continue;
			}
			visitedSitemaps.add(sitemapUrl);

			let xml;
			try {
				xml = await fetchTextWithTimeout(sitemapUrl, 20000);
			} catch {
				sitemapFetchErrors += 1;
				continue;
			}

			const parsed = parseSitemapXml(xml);
			if (parsed.type === "index") {
				for (const entry of parsed.entries) {
					if (!entry.loc) {
						continue;
					}
					pendingSitemaps.push({ url: entry.loc, depth: current.depth + 1 });
				}
				continue;
			}

			if (parsed.type === "urlset") {
				for (const entry of parsed.entries) {
					if (!entry.loc) {
						continue;
					}
					pageEntries.push({
						url: entry.loc,
						lastmod: normalizeDate(entry.lastmod),
						sourceSitemap: sitemapUrl,
					});
					if (pageEntries.length >= maxUrls) {
						break;
					}
				}
			}
		}

		const nowIso = new Date().toISOString();
		let pageErrors = 0;

		const pageRows = await runWithConcurrency(pageEntries, 6, async (entry) => {
			const url = String(entry.url || "").trim();
			if (!url) {
				return null;
			}

			try {
				const html = await fetchTextWithTimeout(url, 15000);
				const title = extractHtmlTag(html, "title") || null;
				const h1 = firstH1(html) || null;
				const description = extractMetaDescription(html) || null;
				const canonical = extractCanonicalUrl(html) || null;
				const textContent = stripHtml(html);
				return {
					url,
					canonical_url: canonical,
					title,
					h1,
					description,
					word_count: countWords(textContent),
					lastmod: entry.lastmod,
					content_hash: sha256(textContent.slice(0, 20000)),
					crawl_status: "ok",
					metadata: {
						source_sitemap: entry.sourceSitemap,
					},
					last_crawled_at: nowIso,
				};
			} catch (error) {
				pageErrors += 1;
				return {
					url,
					canonical_url: null,
					title: null,
					h1: null,
					description: null,
					word_count: 0,
					lastmod: entry.lastmod,
					content_hash: null,
					crawl_status: "error",
					metadata: {
						source_sitemap: entry.sourceSitemap,
						error: error instanceof Error ? error.message : String(error),
					},
					last_crawled_at: nowIso,
				};
			}
		});

		const rowsToUpsert = pageRows.filter(Boolean);
		for (const chunk of chunkArray(rowsToUpsert, 200)) {
			await supabaseRestRequest(
				config,
				"/rest/v1/brand_content_pages?on_conflict=url",
				"POST",
				chunk,
				"Upsert brand content pages",
				{
					Prefer: "resolution=merge-duplicates,return=minimal",
				},
			);
		}

		const stats = {
			sitemapRoots: sitemapUrls.length,
			sitemapsVisited: visitedSitemaps.size,
			pagesDiscovered: pageEntries.length,
			pagesUpserted: rowsToUpsert.length,
			sitemapFetchErrors,
			pageErrors,
			maxUrls,
		};

		await completeResearchRun(config, researchRunId, stats);

		return sendJson(res, 200, {
			ok: true,
			runId: researchRunId,
			...stats,
		});
	} catch (error) {
		if (researchRunId) {
			try {
				await failResearchRun(
					getSupabaseRestConfig(),
					researchRunId,
					error instanceof Error ? error.message : String(error),
				);
			} catch {
				// ignore secondary error
			}
		}

		const statusCode =
			typeof error === "object" && error !== null && Number(error.statusCode)
				? Number(error.statusCode)
				: 500;

		if (statusCode >= 500) {
			console.error("[research.sitemap.sync] request failed", error);
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
