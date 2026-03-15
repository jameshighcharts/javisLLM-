const SET_COOKIE_ATTRIBUTE_NAMES = new Set([
	"path",
	"domain",
	"expires",
	"max-age",
	"secure",
	"httponly",
	"samesite",
	"priority",
	"partitioned",
]);

export function isTruthyEnvFlag(value) {
	if (typeof value === "boolean") return value;
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	return ["1", "true", "yes", "y", "on"].includes(normalized);
}

export function normalizeChatGptWebCitationHost(url) {
	const trimmed = String(url ?? "").trim();
	if (!trimmed) return "";
	try {
		return new URL(trimmed).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

export function parseChatGptSessionCookieHeader(rawCookieHeader) {
	const input = String(rawCookieHeader ?? "")
		.trim()
		.replace(/^cookie:\s*/i, "");
	if (!input) return [];

	const parts = input.split(";");
	const seenNames = new Set();
	const cookies = [];

	for (const part of parts) {
		const segment = part.trim();
		if (!segment) continue;

		const separatorIndex = segment.indexOf("=");
		if (separatorIndex <= 0) continue;

		const name = segment.slice(0, separatorIndex).trim();
		const lowerName = name.toLowerCase();
		if (
			!name ||
			SET_COOKIE_ATTRIBUTE_NAMES.has(lowerName) ||
			seenNames.has(lowerName)
		) {
			continue;
		}

		const value = segment.slice(separatorIndex + 1).trim();
		if (!value) continue;

		cookies.push({ name, value });
		seenNames.add(lowerName);
	}

	return cookies;
}

function coerceText(value) {
	const text = typeof value === "string" ? value.trim() : "";
	return text || "";
}

function normalizeCandidate(candidate) {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const entry = candidate;
	const url = coerceText(entry.url);
	if (!url || !/^https?:\/\//i.test(url)) {
		return null;
	}

	const host = normalizeChatGptWebCitationHost(url);
	const title = coerceText(entry.title) || host || url;
	const snippet = coerceText(entry.snippet);
	const anchorText = coerceText(entry.anchorText);

	return {
		url,
		host,
		title,
		snippet: snippet || undefined,
		anchorText: anchorText || null,
	};
}

function assignCitationBounds(responseText, anchorText, cursor) {
	if (!responseText || !anchorText) {
		return {
			startIndex: null,
			endIndex: null,
			nextCursor: cursor,
		};
	}

	const haystack = responseText.toLowerCase();
	const needle = anchorText.toLowerCase();
	if (!needle) {
		return {
			startIndex: null,
			endIndex: null,
			nextCursor: cursor,
		};
	}

	let startIndex = haystack.indexOf(needle, cursor);
	if (startIndex < 0) {
		startIndex = haystack.indexOf(needle);
	}
	if (startIndex < 0) {
		return {
			startIndex: null,
			endIndex: null,
			nextCursor: cursor,
		};
	}

	return {
		startIndex,
		endIndex: startIndex + anchorText.length,
		nextCursor: startIndex + anchorText.length,
	};
}

export function normalizeChatGptWebCitationRefs(rawCandidates, responseText) {
	const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
	const refs = [];
	const seen = new Set();
	let cursor = 0;

	for (const candidate of candidates) {
		const normalized = normalizeCandidate(candidate);
		if (!normalized) continue;

		const dedupeKey = [
			normalized.url,
			normalized.title.toLowerCase(),
			(normalized.anchorText ?? "").toLowerCase(),
		].join("|");
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);

		const bounds = assignCitationBounds(
			responseText,
			normalized.anchorText,
			cursor,
		);
		cursor = bounds.nextCursor;

		refs.push({
			id: "",
			url: normalized.url,
			title: normalized.title,
			host: normalized.host,
			snippet: normalized.snippet,
			startIndex: bounds.startIndex,
			endIndex: bounds.endIndex,
			anchorText: normalized.anchorText,
			provider: "chatgpt-web",
		});
	}

	return refs.map((ref, index) => ({
		...ref,
		id: `c${index + 1}`,
	}));
}

export function extractChatGptWebCitationUrls(citationRefs) {
	const refs = Array.isArray(citationRefs) ? citationRefs : [];
	const out = [];
	const seen = new Set();
	for (const ref of refs) {
		const url = coerceText(ref?.url);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}
