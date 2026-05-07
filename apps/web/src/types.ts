export interface ModelOwnerStat {
	owner: string;
	models: string[];
	responseCount: number;
}

export interface DashboardModelStat {
	model: string;
	owner: string;
	responseCount: number;
	successCount: number;
	failureCount: number;
	webSearchEnabledCount: number;
	totalDurationMs: number;
	avgDurationMs: number;
	p95DurationMs: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	avgInputTokens: number;
	avgOutputTokens: number;
	avgTotalTokens: number;
}

export interface DashboardTokenTotals {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface DashboardDurationTotals {
	totalDurationMs: number;
	avgDurationMs: number;
}

export interface DashboardSummary {
	overallScore: number;
	queryCount: number;
	competitorCount: number;
	totalResponses: number;
	models: string[];
	modelOwners: string[];
	modelOwnerMap: Record<string, string>;
	modelOwnerStats: ModelOwnerStat[];
	modelStats: DashboardModelStat[];
	tokenTotals: DashboardTokenTotals;
	durationTotals: DashboardDurationTotals;
	runMonth: string | null;
	webSearchEnabled: string | null;
	windowStartUtc: string | null;
	windowEndUtc: string | null;
}

export interface KpiRow {
	metric_name: string;
	ai_visibility_overall_score: number;
	score_scale: string;
	queries_count: string;
	window_start_utc: string;
	window_end_utc: string;
	models: string;
	model_owners?: string;
	model_owner_map?: string;
	web_search_enabled: string;
	run_month: string;
	run_id: string;
}

export interface CompetitorSeries {
	entity: string;
	entityKey: string;
	isHighcharts: boolean;
	mentionRatePct: number;
	shareOfVoicePct: number;
}

export interface PromptStatus {
	query: string;
	tags: string[];
	isPaused: boolean;
	status: "tracked" | "awaiting_run" | "deleted";
	runs: number;
	highchartsRatePct: number;
	highchartsRank: number | null;
	highchartsRankOutOf: number;
	viabilityRatePct: number;
	topCompetitor: { entity: string; ratePct: number } | null;
	latestRunResponseCount?: number | null;
	competitorRates?: PromptCompetitorRate[];
	latestInputTokens?: number;
	latestOutputTokens?: number;
	latestTotalTokens?: number;
	estimatedInputCostUsd?: number;
	estimatedOutputCostUsd?: number;
	estimatedTotalCostUsd?: number;
	estimatedAvgCostPerResponseUsd?: number;
}

export interface PromptCompetitorRate {
	entity: string;
	entityKey: string;
	isHighcharts: boolean;
	ratePct: number;
	mentions?: number;
}

export interface PromptStatusSummary {
	query: string;
	tags: string[];
	isPaused: boolean;
	status: "tracked" | "awaiting_run" | "deleted";
	runs: number;
	highchartsRatePct: number;
	latestRunResponseCount?: number | null;
	competitorRates?: PromptCompetitorRate[];
}

export interface DashboardResponse {
	generatedAt: string;
	summary: DashboardSummary;
	kpi: KpiRow | null;
	competitorSeries: CompetitorSeries[];
	promptStatus: PromptStatus[];
	comparisonRows: Record<string, string>[];
	files: {
		comparisonTablePresent: boolean;
		competitorChartPresent: boolean;
		kpiPresent: boolean;
		llmOutputsPresent: boolean;
	};
}

export interface DashboardOverviewResponse
	extends Omit<DashboardResponse, "promptStatus"> {
	promptStatus: PromptStatusSummary[];
}

export type UnderTheHoodRange = "1d" | "7d" | "30d" | "all";

export interface UnderTheHoodResponse {
	generatedAt: string;
	range: UnderTheHoodRange;
	rangeLabel: string;
	rangeStartUtc: string | null;
	rangeEndUtc: string | null;
	summary: DashboardSummary;
}

export interface BenchmarkConfig {
	queries: string[];
	queryTags?: Record<string, string[]>;
	competitors: string[];
	aliases: Record<string, string[]>;
	competitorCitationDomains?: Record<string, string[]>;
	pausedQueries?: string[];
}

export interface ConfigResponse {
	config: BenchmarkConfig;
	meta: {
		path?: string;
		source?: string;
		updatedAt: string;
		queries?: number;
		competitors?: number;
	};
}

export interface HealthResponse {
	ok: boolean;
	service?: string;
	repoRoot?: string;
}

export type DiagnosticsStatus = "pass" | "warn" | "fail";

export interface DiagnosticsCheck {
	id: string;
	name: string;
	status: DiagnosticsStatus;
	details: string;
	durationMs: number;
}

export interface DiagnosticsResponse {
	generatedAt: string;
	source: "supabase" | "api";
	checks: DiagnosticsCheck[];
}

export interface TimeSeriesPoint {
	date: string;
	timestamp?: string;
	total: number;
	rates: Record<string, number>;
	aiVisibilityScore?: number;
	combviPct?: number;
}

export interface TimeSeriesResponse {
	ok: boolean;
	competitors: string[];
	points: TimeSeriesPoint[];
}

export interface CompetitorBlogPost {
	id: string;
	title: string;
	type: string;
	source: string;
	sourceKey: string;
	description: string;
	author: string | null;
	link: string;
	publishDate: string | null;
	publishedAt: string | null;
}

export interface CompetitorBlogTimelinePoint {
	month: string;
	label: string;
	total: number;
	bySource: Record<string, number>;
}

export interface CompetitorBlogsResponse {
	generatedAt: string;
	totalPosts: number;
	sourceTotals: Array<{
		source: string;
		sourceKey: string;
		count: number;
	}>;
	typeTotals: Array<{
		type: string;
		count: number;
	}>;
	posts: CompetitorBlogPost[];
	timeline: CompetitorBlogTimelinePoint[];
}

export interface PromptDrilldownCompetitor {
	id: string;
	entity: string;
	entityKey: string;
	isHighcharts: boolean;
	isActive: boolean;
	mentionCount: number;
	mentionRatePct: number;
}

export interface PromptDrilldownRunPoint {
	runId: string;
	runMonth: string | null;
	timestamp: string;
	date: string;
	totalResponses: number;
	highchartsRatePct: number;
	viabilityRatePct: number;
	topCompetitor: { entity: string; ratePct: number } | null;
	rates: Record<string, number>;
}

export interface PromptDrilldownResponseItem {
	id: number;
	runId: string;
	runMonth: string | null;
	runCreatedAt: string | null;
	createdAt: string | null;
	runIteration: number;
	model: string;
	provider?: string | null;
	modelOwner?: string | null;
	webSearchEnabled: boolean;
	error: string | null;
	durationMs?: number;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	responseText: string;
	citationRefs: CitationRef[];
	citations: string[];
	mentions: string[];
}

export interface PromptDrilldownResponse {
	generatedAt: string;
	prompt: {
		id: string;
		query: string;
		sortOrder: number;
		isPaused: boolean;
		createdAt: string | null;
		updatedAt: string | null;
	};
	summary: {
		totalResponses: number;
		trackedRuns: number;
		highchartsRatePct: number;
		viabilityRatePct: number;
		leadPct: number;
		topCompetitor: { entity: string; ratePct: number } | null;
		lastRunAt: string | null;
	};
	competitors: PromptDrilldownCompetitor[];
	runPoints: PromptDrilldownRunPoint[];
	responses: PromptDrilldownResponseItem[];
}

export interface PromptLabRunResponse {
	ok: boolean;
	query: string;
	models: string[];
	results: PromptLabRunResult[];
	summary: PromptLabRunSummary;
	model?: string | null;
	provider?: string | null;
	modelOwner?: string | null;
	webSearchEnabled: boolean;
	effectiveQuery?: string;
	citationRefs?: CitationRef[];
	responseText: string;
	citations: string[];
	rawHtml?: string;
	durationMs: number;
	tokens?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
}

export interface PromptLabRunResult {
	ok: boolean;
	model: string;
	provider: string;
	modelOwner: string;
	webSearchEnabled: boolean;
	effectiveQuery?: string;
	citationRefs?: CitationRef[];
	responseText: string;
	citations: string[];
	rawHtml?: string;
	durationMs: number;
	error: string | null;
	tokens: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
}

export interface PromptLabRunSummary {
	modelCount: number;
	successCount: number;
	failureCount: number;
	totalDurationMs: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
}

export interface CitationRef {
	id: string;
	url: string;
	title: string;
	host: string;
	snippet?: string;
	startIndex?: number | null;
	endIndex?: number | null;
	anchorText?: string | null;
	provider: "openai" | "anthropic" | "google" | "chatgpt-web";
}

export interface BenchmarkWorkflowRun {
	id: number;
	runNumber: number;
	status: string;
	conclusion: string | null;
	htmlUrl: string;
	createdAt: string;
	updatedAt: string;
	headBranch: string;
	title: string;
	actor: string;
}

export interface BenchmarkQueueRun {
	id: string;
	runMonth: string | null;
	models: string | null;
	runKind?: "full" | "cohort";
	cohortTag?: string | null;
	webSearchEnabled: boolean | null;
	overallScore: number | null;
	createdAt: string | null;
	progress: {
		totalJobs: number;
		completedJobs: number;
		processingJobs: number;
		pendingJobs: number;
		failedJobs: number;
		deadLetterJobs?: number;
		completionPct: number;
	} | null;
	status: "pending" | "running" | "completed" | "failed";
}

export interface BenchmarkTriggerWorkflowResponse {
	ok: boolean;
	triggerId: string;
	workflow: string;
	repo: string;
	ref: string;
	models?: string[];
	promptLimit?: number | null;
	run: BenchmarkWorkflowRun | null;
	message: string;
}

export interface BenchmarkTriggerQueueResponse {
	ok: boolean;
	runId: string;
	jobsEnqueued: number;
	models: string[];
	promptLimit?: number | null;
	promptOrder?: "default" | "newest";
	runMonth?: string;
	runKind?: "full" | "cohort";
	cohortTag?: string | null;
	message: string;
}

export type BenchmarkTriggerResponse =
	| BenchmarkTriggerWorkflowResponse
	| BenchmarkTriggerQueueResponse;

export interface BenchmarkModelOption {
	value: string;
	label: string;
	owner: "OpenAI" | "Anthropic" | "Google" | "Unknown";
	provider?: string;
	kind?: "latest" | "pinned" | string;
	family?: string | null;
	fallback?: string | null;
	resolvedValue?: string | null;
}

export interface BenchmarkModelsResponse {
	ok: boolean;
	defaultModelIds: string[];
	models: BenchmarkModelOption[];
}

export interface BenchmarkRunsWorkflowResponse {
	ok: boolean;
	workflow: string;
	repo: string;
	runs: BenchmarkWorkflowRun[];
}

export interface BenchmarkRunsQueueResponse {
	ok: boolean;
	runs: BenchmarkQueueRun[];
}

export type BenchmarkRunsResponse =
	| BenchmarkRunsWorkflowResponse
	| BenchmarkRunsQueueResponse;

export interface BenchmarkStopResponse {
	ok: boolean;
	runId: string;
	cancelledJobs: number;
	archivedMessages: number;
	finalized: boolean;
	message: string;
}

export interface BenchmarkRunCostItem {
	runId: string;
	runMonth: string | null;
	runKind?: "full" | "cohort";
	cohortTag?: string | null;
	createdAt: string | null;
	startedAt: string | null;
	endedAt: string | null;
	webSearchEnabled: boolean | null;
	responseCount: number;
	uniquePrompts: number;
	models: string[];
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	pricedResponseCount: number;
	unpricedModels: string[];
	estimatedInputCostUsd: number;
	estimatedOutputCostUsd: number;
	estimatedTotalCostUsd: number;
}

export interface BenchmarkRunCostsResponse {
	generatedAt: string;
	runCount: number;
	totals: {
		responseCount: number;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		estimatedInputCostUsd: number;
		estimatedOutputCostUsd: number;
		estimatedTotalCostUsd: number;
	};
	runs: BenchmarkRunCostItem[];
}

export interface ResearchRun {
	id: string;
	runType:
		| "competitor_research"
		| "sitemap_sync"
		| "gap_refresh"
		| "brief_generation";
	status: "pending" | "running" | "completed" | "failed";
	model: string | null;
	params: Record<string, unknown>;
	stats: Record<string, unknown>;
	error: string | null;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export type ContentGapStatus =
	| "backlog"
	| "in_progress"
	| "published"
	| "verify"
	| "closed";

export interface ContentGapCitation {
	source?: string;
	title?: string;
	link: string;
	publish_date?: string | null;
}

export interface ContentGapItem {
	id: string;
	topicKey: string;
	topicLabel: string;
	promptQueryId: string | null;
	cohortTag: string | null;
	mentionDeficitScore: number;
	competitorCoverageScore: number;
	compositeScore: number;
	evidenceCount: number;
	evidenceCitations: ContentGapCitation[];
	status: ContentGapStatus;
	linkedPageUrl: string | null;
	briefMarkdown: string | null;
	briefChecklist: string[];
	briefCitations: Array<{ title?: string; url: string; note?: string }>;
	briefModel: string | null;
	briefGeneratedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PromptResearchCohort {
	id: string;
	tag: string;
	displayName: string;
	baselineRunId: string;
	baselineLockedAt: string;
	targetPp: number;
	targetWeeks: number;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface PromptResearchProgress {
	cohort: {
		id: string;
		tag: string;
		displayName: string;
		baselineRunId: string;
		baselineLockedAt: string;
		targetPp: number;
		targetWeeks: number;
		isActive: boolean;
	};
	promptCount: number;
	baselineRate: number | null;
	currentRate: number | null;
	currentRunId: string | null;
	upliftPp: number | null;
	progressPct: number;
	dueDate: string | null;
	trend: Array<{
		runId: string | null;
		createdAt: string | null;
		metric: number | null;
	}>;
}

export interface BrandContentPage {
	id: string;
	url: string;
	canonicalUrl: string | null;
	title: string | null;
	h1: string | null;
	description: string | null;
	wordCount: number;
	lastmod: string | null;
	contentHash: string | null;
	crawlStatus: "ok" | "error";
	metadata: Record<string, unknown>;
	lastCrawledAt: string | null;
}

export interface CitationLinksRunOption {
	id: string;
	runMonth: string | null;
	createdAt: string | null;
	webSearchEnabled: boolean | null;
}

export interface CitationLinksSourceStat {
	key: string;
	host: string;
	title: string;
	primaryUrl: string;
	citationCount: number;
	responseCount: number;
	uniqueUrlCount: number;
	providers: string[];
}

export interface CitationLinksResponse {
	generatedAt: string;
	runId: string | null;
	runMonth: string | null;
	availableRuns: CitationLinksRunOption[];
	totalResponses: number;
	responsesWithCitations: number;
	totalCitations: number;
	uniqueSources: number;
	sources: CitationLinksSourceStat[];
}

export interface AskillQueryStat {
	queryId: string;
	queryText: string;
	responseCount: number;
	mentionCount: number;
	mentionRatePct: number;
	totalCitations: number;
	uniqueSources: number;
}

export interface AskillUrlStat {
	url: string;
	title: string;
	host: string;
	citationCount: number;
	responseCount: number;
	providers: string[];
}

export interface AskillResponse {
	generatedAt: string;
	runId: string | null;
	runMonth: string | null;
	availableRuns: CitationLinksRunOption[];
	highchartsName: string;
	totalResponses: number;
	highchartsMentions: number;
	mentionRatePct: number;
	totalCitations: number;
	uniqueUrls: number;
	uniqueDomains: number;
	queries: AskillQueryStat[];
	urls: AskillUrlStat[];
}
