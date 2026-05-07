const { enforceRateLimit } = require("../_rate-limit");
const {
	getBenchmarkAllowedModels,
	getBenchmarkDefaultModelIds,
	normalizeBenchmarkModelAlias,
	resolveBenchmarkModelIds,
} = require("../_benchmark-models");

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_MESSAGES_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_GENERATE_CONTENT_API_ROOT =
	"https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = getBenchmarkDefaultModelIds()[0] || "gpt-4o-mini";
const QUERY_MAX_LENGTH = 600;
const SYSTEM_PROMPT =
	"You are a research assistant for software and tooling questions. Produce clear markdown with short section headers, ranked options, concise rationale, and practical trade-offs. If web search is enabled, you must use it before answering and cite the sources you relied on in the response.";
const OPENAI_SYSTEM_PROMPT = [
	"Do not reproduce song lyrics or any other copyrighted material, even if asked.",
	"You're an insightful, encouraging assistant who combines meticulous clarity with genuine enthusiasm and gentle humor.\nSupportive thoroughness: Patiently explain complex topics clearly and comprehensively.\nLighthearted interactions: Maintain friendly tone with subtle humor and warmth.\nAdaptive teaching: Flexibly adjust explanations based on perceived user proficiency.\nConfidence-building: Foster intellectual curiosity and self-assurance.",
	"Do not end with opt-in questions or hedging closers. Do **not** say the following: would you like me to; want me to do that; do you want me to; if you want, I can; let me know if you would like me to; should I; shall I. Ask at most one necessary clarifying question at the start, not the end. If the next step is obvious, do it. Example of bad: I can write playful examples. would you like me to? Example of good: Here are three playful examples:..",
	"Address your message `to=bio` and write **just plain text**. Do **not** write JSON, under any circumstances. The plain text can be either:",
	"1. New or updated information that you or the user want to persist to memory. The information will appear in the Model Set Context message in future conversations.\n2. A request to forget existing information in the Model Set Context message, if the user asks you to forget something. The request should stay as close as possible to the user's ask.",
	'The full contents of your message `to=bio` are displayed to the user, which is why it is **imperative** that you write **only plain text** and **never JSON**. Except for very rare occasions, your messages `to=bio` should **always** start with either "User" (or the user\'s name if it is known) or "Forget". Follow the style of these examples and, again, **never write JSON**:',
	'// Tool for browsing and opening files uploaded by the user. To use this tool, set the recipient of your message as `to=file_search.msearch` (to use the msearch function) or `to=file_search.mclick` (to use the mclick function).\n// Parts of the documents uploaded by users will be automatically included in the conversation. Only use this tool when the relevant parts don\'t contain the necessary information to fulfill the user\'s request.\n// Please provide citations for your answers.\n// When citing the results of msearch, please render them in the following format: `{message idx}:{search idx}†{source}†{line range}` .\n// The message idx is provided at the beginning of the message from the tool in the following format `[message idx]`, e.g. [3].\n// The search index should be extracted from the search results, e.g. #   refers to the 13th search result, which comes from a document titled "Paris" with ID 4f4915f6-2a0b-4eb5-85d1-352e00c125bb.\n// The line range should be in the format "L{start line}-L{end line}", e.g., "L1-L5".\n// All 4 parts of the citation are REQUIRED when citing the results of msearch.\n// When citing the results of mclick, please render them in the following format: `{message idx}†{source}†{line range}`. All 3 parts are REQUIRED when citing the results of mclick.',
	"// Guidelines:\n// - Directly generate the image without reconfirmation or clarification, UNLESS the user asks for an image that will include a rendition of them.\n// - Do NOT mention anything related to downloading the image.\n// - Default to using this tool for image editing unless the user explicitly requests otherwise.\n// - After generating the image, do not summarize the image. Respond with an empty message.",
	"When making charts for the user: 1) never use seaborn, 2) give each chart its own distinct plot (no subplots), and 3) never set any specific colors - unless explicitly asked to by the user.\nI REPEAT: when making charts for the user: 1) use matplotlib over seaborn, 2) give each chart its own distinct plot (no subplots), and 3) never, ever, specify colors or matplotlib styles - unless explicitly asked to by the user",
	"**Policy reminder**: When using web results for sensitive or high-stakes topics (e.g., financial advice, health information, legal matters), always carefully check multiple reputable sources and present information with clear sourcing and caveats.",
	"If web search is enabled for this run, you must use it before answering and cite the sources you relied on in the response.",
	"# Closing Instructions",
	"You must follow all personality, tone, and formatting requirements stated above in every interaction.",
	"- **Personality**: Maintain the friendly, encouraging, and clear style described at the top of this prompt. Where appropriate, include gentle humor and warmth without detracting from clarity or accuracy.\n- **Clarity**: Explanations should be thorough but easy to follow. Use headings, lists, and formatting when it improves readability.\n- **Boundaries**: Do not produce disallowed content. This includes copyrighted song lyrics or any other material explicitly restricted in these instructions.\n- **Tool usage**: Only use the tools provided and strictly adhere to their usage guidelines. If the criteria for a tool are not met, do not invoke it.\n- **Accuracy and trust**: For high-stakes topics (e.g., medical, legal, financial), ensure that information is accurate, cite credible sources, and provide appropriate disclaimers.\n- **Freshness**: When the user asks for time-sensitive information, prefer the `web` tool with the correct QDF rating to ensure the information is recent and reliable.",
	"When uncertain, follow these priorities:\n1. **User safety and policy compliance** come first.\n2. **Accuracy and clarity** come next.\n3. **Tone and helpfulness** should be preserved throughout.",
].join("\n\n");
const USER_PROMPT_TEMPLATE = [
	"Query: {query}",
	"Answer with this structure:",
	"1) Top options (ranked)",
	"2) Why each option fits",
	"3) Trade-offs or caveats",
	"Keep bullets concise and name concrete libraries/tools.",
].join("\n");
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_SEARCH_CONTEXT_LOCATION = "United States";
const DEFAULT_SEARCH_CONTEXT_LANGUAGE = "en";

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
	return Math.max(min, Math.min(max, parsed));
}

function normalizeModelAlias(value) {
	return normalizeBenchmarkModelAlias(value);
}

function getAllowedModels() {
	return getBenchmarkAllowedModels();
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

function resolveModels(body, allowedModels) {
	const selectAll = parseBoolean(
		body.selectAllModels ?? body.selectAll ?? body.select_all,
		false,
	);

	let candidates = selectAll
		? getBenchmarkDefaultModelIds()
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

function resolveQuery(value) {
	if (typeof value !== "string" || !value.trim()) {
		const error = new Error("query is required.");
		error.statusCode = 400;
		throw error;
	}
	const query = value.trim();
	if (query.length > QUERY_MAX_LENGTH) {
		const error = new Error(
			`query is too long. Maximum length is ${QUERY_MAX_LENGTH} characters.`,
		);
		error.statusCode = 400;
		throw error;
	}
	return query;
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

function resolveSearchContext(value) {
	const raw = value && typeof value === "object" ? value : {};
	const enabled = parseBoolean(raw.enabled, false);
	const location =
		typeof raw.location === "string" && raw.location.trim()
			? raw.location.trim()
			: DEFAULT_SEARCH_CONTEXT_LOCATION;
	const language =
		typeof raw.language === "string" && raw.language.trim()
			? raw.language.trim()
			: DEFAULT_SEARCH_CONTEXT_LANGUAGE;
	return {
		enabled,
		location,
		language,
	};
}

function buildEffectiveQuery(query, provider, searchContext) {
	if (provider !== "openai" || !searchContext.enabled) {
		return query;
	}
	return `${query} (The user's location is ${searchContext.location}. Be sure to reply in ${searchContext.language} language)`;
}

function buildPromptLabUserPrompt(effectiveQuery, enforceWebGrounding) {
	const base = USER_PROMPT_TEMPLATE.replace("{query}", effectiveQuery);
	if (!enforceWebGrounding) {
		return base;
	}
	return `${base}\nYou must use web search before finalizing. Cite the sources you relied on in the answer.`;
}

function inferProviderFromModel(model) {
	const normalized = String(model || "")
		.trim()
		.toLowerCase();
	if (normalized.startsWith("claude") || normalized.startsWith("anthropic/")) {
		return "anthropic";
	}
	if (normalized.startsWith("gemini") || normalized.startsWith("google/")) {
		return "google";
	}
	return "openai";
}

function resolveApiKeyForProvider(provider) {
	const keyName =
		provider === "anthropic"
			? "ANTHROPIC_API_KEY"
			: provider === "google"
				? "GEMINI_API_KEY"
				: "OPENAI_API_KEY";
	const value = String(process.env[keyName] || "").trim();
	if (!value) {
		const error = new Error(
			`Prompt lab is not configured. Set ${keyName} on the server.`,
		);
		error.statusCode = 503;
		error.exposeMessage = true;
		throw error;
	}
	return value;
}

function resolveModelOwner(provider) {
	if (provider === "anthropic") return "Anthropic";
	if (provider === "google") return "Google";
	if (provider === "openai") return "OpenAI";
	return "Unknown";
}

function getSystemPromptForProvider(provider) {
	return provider === "openai" ? OPENAI_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

function extractResponseText(responsePayload) {
	const outputText = responsePayload?.output_text;
	if (typeof outputText === "string" && outputText.trim()) {
		return outputText.trim();
	}

	const texts = [];
	const outputItems = Array.isArray(responsePayload?.output)
		? responsePayload.output
		: [];
	for (const outputItem of outputItems) {
		if (!outputItem || typeof outputItem !== "object") {
			continue;
		}
		const contentItems = Array.isArray(outputItem.content)
			? outputItem.content
			: [];
		for (const content of contentItems) {
			if (!content || typeof content !== "object") {
				continue;
			}
			if (typeof content.text === "string" && content.text.trim()) {
				texts.push(content.text.trim());
			}
		}
	}

	const contentItems = Array.isArray(responsePayload?.content)
		? responsePayload.content
		: [];
	for (const content of contentItems) {
		if (!content || typeof content !== "object") {
			continue;
		}
		if (typeof content.text === "string" && content.text.trim()) {
			texts.push(content.text.trim());
		}
	}

	const candidates = Array.isArray(responsePayload?.candidates)
		? responsePayload.candidates
		: [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") {
			continue;
		}
		const content = candidate.content;
		if (!content || typeof content !== "object") {
			continue;
		}
		const parts = Array.isArray(content.parts) ? content.parts : [];
		for (const part of parts) {
			if (!part || typeof part !== "object") {
				continue;
			}
			if (typeof part.text === "string" && part.text.trim()) {
				texts.push(part.text.trim());
			}
		}
	}

	return texts.join("\n").trim();
}

function normalizeCitationHost(url) {
	if (typeof url !== "string" || !url.trim()) {
		return "";
	}
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

function normalizeCitationBounds(value) {
	if (value === null || value === undefined) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return null;
	}
	const rounded = Math.round(parsed);
	return rounded >= 0 ? rounded : null;
}

function buildCitationRefFromCandidate(candidate, provider, sourceText = "") {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const urlCandidate = [
		candidate.url,
		candidate.uri,
		candidate.href,
		candidate.source,
	].find((value) => typeof value === "string" && value.trim());
	if (typeof urlCandidate !== "string") {
		return null;
	}
	const url = urlCandidate.trim();
	const host = normalizeCitationHost(url);
	const title =
		typeof candidate.title === "string" && candidate.title.trim()
			? candidate.title.trim()
			: host || url;
	const snippetCandidate = [
		candidate.snippet,
		candidate.text,
		candidate.excerpt,
	].find((value) => typeof value === "string" && value.trim());
	const snippet =
		typeof snippetCandidate === "string" ? snippetCandidate.trim() : undefined;
	const startIndex = normalizeCitationBounds(
		candidate.start_index ?? candidate.startIndex,
	);
	const endIndex = normalizeCitationBounds(
		candidate.end_index ?? candidate.endIndex,
	);
	let anchorText = null;
	if (
		typeof sourceText === "string" &&
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
		provider,
	};
}

function normalizeCitationRefs(responsePayload, provider) {
	const refs = [];
	const seen = new Set();
	let nextId = 1;

	const appendRef = (candidate, sourceText = "") => {
		const normalized = buildCitationRefFromCandidate(
			candidate,
			provider,
			sourceText,
		);
		if (!normalized) {
			return;
		}
		const dedupeKey = [
			normalized.url,
			normalized.startIndex ?? "",
			normalized.endIndex ?? "",
			normalized.title.toLowerCase(),
		].join("|");
		if (seen.has(dedupeKey)) {
			return;
		}
		seen.add(dedupeKey);
		refs.push({
			id: `c${nextId++}`,
			...normalized,
		});
	};

	for (const key of ["citations", "sources", "references"]) {
		const topLevelValue = responsePayload?.[key];
		if (!Array.isArray(topLevelValue)) {
			continue;
		}
		for (const item of topLevelValue) {
			appendRef(item);
		}
	}

	const outputItems = Array.isArray(responsePayload?.output)
		? responsePayload.output
		: [];
	for (const outputItem of outputItems) {
		if (!outputItem || typeof outputItem !== "object") {
			continue;
		}
		const contentItems = Array.isArray(outputItem.content)
			? outputItem.content
			: [];
		for (const content of contentItems) {
			if (!content || typeof content !== "object") {
				continue;
			}
			const sourceText = typeof content.text === "string" ? content.text : "";
			if (Array.isArray(content.citations)) {
				for (const citation of content.citations) {
					appendRef(citation, sourceText);
				}
			}
			if (!Array.isArray(content.annotations)) {
				continue;
			}
			for (const annotation of content.annotations) {
				appendRef(annotation, sourceText);
				appendRef(annotation?.url_citation, sourceText);
			}
		}
	}

	const contentItems = Array.isArray(responsePayload?.content)
		? responsePayload.content
		: [];
	for (const content of contentItems) {
		if (!content || typeof content !== "object") {
			continue;
		}
		const sourceText = typeof content.text === "string" ? content.text : "";
		if (Array.isArray(content.citations)) {
			for (const citation of content.citations) {
				appendRef(citation, sourceText);
			}
		}
	}

	const candidates = Array.isArray(responsePayload?.candidates)
		? responsePayload.candidates
		: [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object") {
			continue;
		}
		const grounding = candidate.groundingMetadata;
		if (!grounding || typeof grounding !== "object") {
			continue;
		}
		const chunks = Array.isArray(grounding.groundingChunks)
			? grounding.groundingChunks
			: [];
		for (const chunk of chunks) {
			if (!chunk || typeof chunk !== "object") {
				continue;
			}
			appendRef(chunk);
			if (chunk.web && typeof chunk.web === "object") {
				appendRef(chunk.web);
			}
		}
		const citationSources = Array.isArray(
			grounding.citationMetadata?.citationSources,
		)
			? grounding.citationMetadata.citationSources
			: [];
		for (const source of citationSources) {
			appendRef(source);
		}
	}

	refs.sort((left, right) => {
		const leftPos =
			left.endIndex === null || left.endIndex === undefined
				? Number.POSITIVE_INFINITY
				: left.endIndex;
		const rightPos =
			right.endIndex === null || right.endIndex === undefined
				? Number.POSITIVE_INFINITY
				: right.endIndex;
		if (leftPos !== rightPos) return leftPos - rightPos;
		return left.url.localeCompare(right.url);
	});

	return refs.map((ref, index) => ({
		...ref,
		id: `c${index + 1}`,
	}));
}

function extractCitations(citationRefs) {
	const citations = [];
	const seen = new Set();
	for (const ref of citationRefs) {
		if (!ref || typeof ref.url !== "string") continue;
		const normalized = ref.url.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		citations.push(normalized);
	}
	return citations;
}

function toNonNegativeInt(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 0;
	}
	return Math.round(parsed);
}

function extractTokenUsage(responsePayload) {
	const usage =
		responsePayload?.usage && typeof responsePayload.usage === "object"
			? responsePayload.usage
			: {};
	const usageMetadata =
		responsePayload?.usageMetadata &&
		typeof responsePayload.usageMetadata === "object"
			? responsePayload.usageMetadata
			: {};

	const inputTokens = Math.max(
		toNonNegativeInt(usage.input_tokens),
		toNonNegativeInt(usage.prompt_tokens),
		toNonNegativeInt(usageMetadata.promptTokenCount),
		toNonNegativeInt(usageMetadata.prompt_tokens),
	);
	const outputTokens = Math.max(
		toNonNegativeInt(usage.output_tokens),
		toNonNegativeInt(usage.completion_tokens),
		toNonNegativeInt(usageMetadata.candidatesTokenCount),
		toNonNegativeInt(usageMetadata.completion_tokens),
	);
	const totalTokens =
		Math.max(
			toNonNegativeInt(usage.total_tokens),
			toNonNegativeInt(usageMetadata.totalTokenCount),
			toNonNegativeInt(usageMetadata.total_tokens),
		) || inputTokens + outputTokens;

	return {
		inputTokens,
		outputTokens,
		totalTokens,
	};
}

async function runOpenAiPromptLabQuery({ effectiveQuery, model, webSearch }) {
	const apiKey = resolveApiKeyForProvider("openai");
	const userPrompt = buildPromptLabUserPrompt(effectiveQuery, webSearch);
	const systemPrompt = getSystemPromptForProvider("openai");
	const requestBody = {
		model,
		temperature: 0.7,
		input: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		],
	};
	if (webSearch) {
		requestBody.tools = [{ type: "web_search_preview" }];
	}

	const upstreamResponse = await fetch(OPENAI_RESPONSES_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const raw = await upstreamResponse.text();
	let payload = {};
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = {};
		}
	}

	if (!upstreamResponse.ok) {
		const upstreamMessage =
			typeof payload?.error?.message === "string"
				? payload.error.message
				: `OpenAI request failed (${upstreamResponse.status}).`;
		const error = new Error(upstreamMessage);
		error.statusCode =
			upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
		throw error;
	}

	const citationRefs = normalizeCitationRefs(payload, "openai");
	return {
		responseText: extractResponseText(payload),
		citationRefs,
		citations: extractCitations(citationRefs),
		effectiveQuery,
		tokens: extractTokenUsage(payload),
	};
}

async function runAnthropicPromptLabQuery({ effectiveQuery, model }) {
	const apiKey = resolveApiKeyForProvider("anthropic");
	const userPrompt = buildPromptLabUserPrompt(effectiveQuery, false);
	const systemPrompt = getSystemPromptForProvider("anthropic");
	const requestBody = {
		model,
		max_tokens: 1024,
		temperature: 0.7,
		system: systemPrompt,
		messages: [{ role: "user", content: userPrompt }],
	};

	const upstreamResponse = await fetch(ANTHROPIC_MESSAGES_API_URL, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_API_VERSION,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const raw = await upstreamResponse.text();
	let payload = {};
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = {};
		}
	}

	if (!upstreamResponse.ok) {
		const upstreamMessage =
			typeof payload?.error?.message === "string"
				? payload.error.message
				: `Anthropic request failed (${upstreamResponse.status}).`;
		const error = new Error(upstreamMessage);
		error.statusCode =
			upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
		throw error;
	}

	const citationRefs = normalizeCitationRefs(payload, "anthropic");
	return {
		responseText: extractResponseText(payload),
		citationRefs,
		citations: extractCitations(citationRefs),
		effectiveQuery,
		tokens: extractTokenUsage(payload),
	};
}

async function runGeminiPromptLabQuery({ effectiveQuery, model }) {
	const apiKey = resolveApiKeyForProvider("google");
	const modelPath = encodeURIComponent(model);
	const url =
		`${GEMINI_GENERATE_CONTENT_API_ROOT}/${modelPath}:generateContent` +
		`?key=${encodeURIComponent(apiKey)}`;
	const userPrompt = buildPromptLabUserPrompt(effectiveQuery, false);
	const systemPrompt = getSystemPromptForProvider("google");
	const requestBody = {
		systemInstruction: { parts: [{ text: systemPrompt }] },
		contents: [
			{
				role: "user",
				parts: [{ text: userPrompt }],
			},
		],
		generationConfig: { temperature: 0.7 },
	};

	const upstreamResponse = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	const raw = await upstreamResponse.text();
	let payload = {};
	if (raw) {
		try {
			payload = JSON.parse(raw);
		} catch {
			payload = {};
		}
	}

	if (!upstreamResponse.ok) {
		const upstreamMessage =
			typeof payload?.error?.message === "string"
				? payload.error.message
				: `Gemini request failed (${upstreamResponse.status}).`;
		const error = new Error(upstreamMessage);
		error.statusCode =
			upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
		throw error;
	}

	const citationRefs = normalizeCitationRefs(payload, "google");
	return {
		responseText: extractResponseText(payload),
		citationRefs,
		citations: extractCitations(citationRefs),
		effectiveQuery,
		tokens: extractTokenUsage(payload),
	};
}

async function runPromptLabQuery({ query, model, webSearch, searchContext }) {
	const provider = inferProviderFromModel(model);
	const effectiveQuery = buildEffectiveQuery(query, provider, searchContext);
	if (provider === "anthropic") {
		return runAnthropicPromptLabQuery({ effectiveQuery, model, webSearch });
	}
	if (provider === "google") {
		return runGeminiPromptLabQuery({ effectiveQuery, model });
	}
	return runOpenAiPromptLabQuery({ effectiveQuery, model, webSearch });
}

async function runPromptLabQueryForModel({
	query,
	model,
	webSearch,
	searchContext,
}) {
	const provider = inferProviderFromModel(model);
	const modelOwner = resolveModelOwner(provider);
	const webSearchEnabled = provider === "openai" ? webSearch : false;
	const effectiveQuery = buildEffectiveQuery(query, provider, searchContext);
	const startedAt = Date.now();
	try {
		const result = await runPromptLabQuery({
			query,
			model,
			webSearch: webSearchEnabled,
			searchContext,
		});
		return {
			ok: true,
			model,
			provider,
			modelOwner,
			webSearchEnabled,
			responseText: result.responseText,
			effectiveQuery: result.effectiveQuery,
			citationRefs: result.citationRefs,
			citations: result.citations,
			tokens: result.tokens,
			durationMs: Date.now() - startedAt,
			error: null,
		};
	} catch (error) {
		return {
			ok: false,
			model,
			provider,
			modelOwner,
			webSearchEnabled,
			responseText: "",
			effectiveQuery,
			citationRefs: [],
			citations: [],
			tokens: {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			},
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function summarizePromptLabResults(results) {
	return results.reduce(
		(summary, result) => {
			summary.modelCount += 1;
			if (result.ok) {
				summary.successCount += 1;
			} else {
				summary.failureCount += 1;
			}
			summary.totalDurationMs += toNonNegativeInt(result.durationMs);
			summary.totalInputTokens += toNonNegativeInt(result?.tokens?.inputTokens);
			summary.totalOutputTokens += toNonNegativeInt(
				result?.tokens?.outputTokens,
			);
			summary.totalTokens += toNonNegativeInt(result?.tokens?.totalTokens);
			return summary;
		},
		{
			modelCount: 0,
			successCount: 0,
			failureCount: 0,
			totalDurationMs: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalTokens: 0,
		},
	);
}

module.exports = async (req, res) => {
	try {
		if (req.method !== "POST") {
			return sendJson(res, 405, { error: "Method not allowed. Use POST." });
		}

		const rateLimitMax = Math.round(
			normalizeNumber(process.env.PROMPT_LAB_RATE_MAX, 15, 1, 200),
		);
		const rateLimitWindowMs = Math.round(
			normalizeNumber(
				process.env.PROMPT_LAB_RATE_WINDOW_MS,
				60 * 1000,
				15 * 1000,
				60 * 60 * 1000,
			),
		);
		enforceRateLimit(req, {
			bucket: "prompt-lab-run",
			max: rateLimitMax,
			windowMs: rateLimitWindowMs,
		});

		const body = parseBody(req);
		const query = resolveQuery(body.query);
		const allowedModels = getAllowedModels();
		const requestedModels = resolveModels(body, allowedModels);
		const models = await resolveBenchmarkModelIds(requestedModels, {
			logger: console,
		});
		if (models.length === 0) {
			const error = new Error("No prompt lab models resolved.");
			error.statusCode = 400;
			throw error;
		}
		const requestedWebSearch = parseWebSearch(body.webSearch);
		const searchContext = resolveSearchContext(body.searchContext);
		const results = await Promise.all(
			models.map((modelName) =>
				runPromptLabQueryForModel({
					query,
					model: modelName,
					webSearch: requestedWebSearch,
					searchContext,
				}),
			),
		);
		const summary = summarizePromptLabResults(results);
		const primaryResult = results[0] || null;
		return sendJson(res, 200, {
			ok: summary.successCount > 0,
			query,
			models,
			results,
			summary,
			// Backwards compatibility for single-model callers.
			model: primaryResult?.model ?? null,
			provider: primaryResult?.provider ?? null,
			modelOwner: primaryResult?.modelOwner ?? null,
			webSearchEnabled: Boolean(primaryResult?.webSearchEnabled),
			effectiveQuery: primaryResult?.effectiveQuery ?? query,
			citationRefs: primaryResult?.citationRefs ?? [],
			responseText: primaryResult?.responseText ?? "",
			citations: primaryResult?.citations ?? [],
			durationMs: toNonNegativeInt(primaryResult?.durationMs),
			tokens: primaryResult?.tokens ?? {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			},
		});
	} catch (error) {
		const statusCode =
			typeof error === "object" && error !== null && Number(error.statusCode)
				? Number(error.statusCode)
				: 500;
		const exposeMessage =
			typeof error === "object" &&
			error !== null &&
			Boolean(error.exposeMessage);
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
			console.error("[prompt-lab.run] request failed", error);
		}
		const message =
			statusCode >= 500 && !exposeMessage
				? "Internal server error."
				: error instanceof Error
					? error.message
					: String(error);
		return sendJson(res, statusCode, { error: message });
	}
};
