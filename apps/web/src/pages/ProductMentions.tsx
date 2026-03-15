/* biome-ignore-all lint/suspicious/noArrayIndexKey: display-only mapped lists in this file */
import { useQuery } from "@tanstack/react-query";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { AlertTriangle, Copy, Layers, Search, Sparkles } from "lucide-react";
import {
	startTransition,
	useDeferredValue,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { PromptStatus } from "../types";

type ProductKey = "core" | "stock" | "maps" | "gantt" | "dashboards" | "grid";
type FrameworkTag = "javascript" | "react" | "general";
type FrameworkFilter = "all" | FrameworkTag;
type ProductFilter = "all" | ProductKey;
type VisibilityStatus = "tracked" | "awaiting_run" | "paused" | "deleted";
type StatusFilter = "all" | VisibilityStatus;
type Confidence = "high" | "medium" | "low";

type ProductMeta = {
	name: string;
	shortName: string;
	accent: string;
	surface: string;
	border: string;
	summary: string;
	trigger: string;
	expandWith: string;
};

type ProductRule = {
	label: string;
	pattern: RegExp;
};

type SuggestedQuery = {
	id: string;
	product: ProductKey;
	framework: Extract<FrameworkTag, "javascript" | "react">;
	query: string;
	rationale: string;
};

type ClassifiedPrompt = {
	prompt: PromptStatus;
	frameworks: FrameworkTag[];
	leadProduct: ProductKey;
	supportingProducts: ProductKey[];
	matchedRules: string[];
	confidence: Confidence;
	visibilityStatus: VisibilityStatus;
};

type ProductCoverageRow = {
	product: ProductKey;
	totalQueries: number;
	trackedQueries: number;
	pausedQueries: number;
	avgHighchartsRate: number;
	javascriptCount: number;
	reactCount: number;
	generalCount: number;
	bundleCount: number;
};

type SuggestionState = "missing" | "needs_runs" | "needs_lift";

type CoverageSuggestion = SuggestedQuery & {
	state: SuggestionState;
	existingCount: number;
	trackedCount: number;
	avgHighchartsRate: number;
};

const PRODUCT_ORDER: ProductKey[] = [
	"core",
	"stock",
	"maps",
	"gantt",
	"dashboards",
	"grid",
];
const FRAMEWORK_ORDER: FrameworkTag[] = ["javascript", "react", "general"];
const SPECIALIZED_PRODUCTS: ProductKey[] = ["stock", "maps", "gantt", "grid"];

const PRODUCT_META: Record<ProductKey, ProductMeta> = {
	core: {
		name: "Highcharts Core",
		shortName: "Core",
		accent: "#356A3D",
		surface: "#EEF6EF",
		border: "#C9DDCA",
		summary:
			"Generic interactive charting for line, bar, area, pie, scatter, and mixed-series use cases.",
		trigger:
			"Lead with Core when the query is broad charting or data visualization without a stronger domain signal.",
		expandWith:
			"Expand only when the prompt also asks for a shell like dashboards, grids, maps, or planning views.",
	},
	stock: {
		name: "Highcharts Stock",
		shortName: "Stock",
		accent: "#285F78",
		surface: "#EEF6FB",
		border: "#C6DDED",
		summary:
			"Financial and market-focused charting for candlestick, OHLC, navigator, range selector, and indicators.",
		trigger:
			"Use Stock when the query says financial, trading, stock, candlestick, OHLC, or technical indicators.",
		expandWith:
			"Pair with Dashboards or Grid when the prompt is really describing a trading workspace.",
	},
	maps: {
		name: "Highcharts Maps",
		shortName: "Maps",
		accent: "#2D6EAA",
		surface: "#EFF5FF",
		border: "#C9D9F1",
		summary:
			"Geospatial visualization for map charts, choropleths, GeoJSON layers, and regional analytics.",
		trigger:
			"Use Maps when geography is explicit: map charts, choropleths, GeoJSON, territory views, or location data.",
		expandWith:
			"Layer in Dashboards and Grid when maps are part of a broader analytics surface.",
	},
	gantt: {
		name: "Highcharts Gantt",
		shortName: "Gantt",
		accent: "#9C5B3A",
		surface: "#FCF2EE",
		border: "#EACDBF",
		summary:
			"Scheduling and planning for project timelines, milestones, dependencies, and resource management.",
		trigger:
			"Use Gantt when the query says gantt, project timeline, scheduling, roadmap, dependency, or resource planning.",
		expandWith:
			"Expand to Dashboards when the prompt is asking for a portfolio or PMO-style shell.",
	},
	dashboards: {
		name: "Highcharts Dashboards",
		shortName: "Dashboards",
		accent: "#8C6B17",
		surface: "#FBF6E7",
		border: "#E6D9AC",
		summary:
			"Multi-widget analytics surfaces with synchronized charts, KPIs, filters, and coordinated layouts.",
		trigger:
			"Use Dashboards when the query is about analytics dashboards, KPI workspaces, multi-panel views, or embedded analytics.",
		expandWith:
			"Dashboards usually needs Core for charts and often Grid for table-heavy views.",
	},
	grid: {
		name: "Highcharts Grid",
		shortName: "Grid",
		accent: "#6A548A",
		surface: "#F5F1FB",
		border: "#D6C8EA",
		summary:
			"Tabular UI for data grids, spreadsheet-like interaction, sorting, filtering, and dense row/column work.",
		trigger:
			"Use Grid when the query is clearly about a data grid, spreadsheet feel, or heavy table interaction.",
		expandWith:
			"Grid becomes stronger when paired with Dashboards and the matching chart product.",
	},
};

const PRODUCT_RULES: Record<ProductKey, ProductRule[]> = {
	core: [
		{ label: "charting", pattern: /\bchart(?:ing|s)?\b/i },
		{ label: "graphing", pattern: /\bgraph(?:s|ing)?\b/i },
		{ label: "data visualization", pattern: /\bdata visualization\b/i },
		{ label: "visualization library", pattern: /\bvisualization library\b/i },
		{
			label: "line or bar charts",
			pattern: /\b(line|bar|area|pie|scatter|column) chart\b/i,
		},
	],
	stock: [
		{ label: "financial", pattern: /\b(financial|finance|fintech)\b/i },
		{ label: "stock", pattern: /\bstock(?:s)?\b/i },
		{ label: "trading", pattern: /\b(trading|trader|market data)\b/i },
		{ label: "candlestick or OHLC", pattern: /\b(candlestick|ohlc)\b/i },
		{
			label: "technical indicators",
			pattern: /\b(indicator|indicators|technical analysis|macd|rsi)\b/i,
		},
	],
	maps: [
		{ label: "maps", pattern: /\bmap(?:s)?\b/i },
		{ label: "choropleth", pattern: /\bchoropleth\b/i },
		{ label: "geojson", pattern: /\bgeojson\b/i },
		{
			label: "geospatial",
			pattern: /\b(geospatial|geographic|location analytics|territory)\b/i,
		},
		{ label: "bubble map", pattern: /\bbubble map\b/i },
	],
	gantt: [
		{ label: "gantt", pattern: /\bgantt\b/i },
		{ label: "project timeline", pattern: /\bproject timeline\b/i },
		{ label: "roadmap", pattern: /\broadmap\b/i },
		{ label: "dependencies", pattern: /\bdependency|dependencies\b/i },
		{
			label: "scheduling",
			pattern: /\b(schedule|scheduling|resource planning|milestone)\b/i,
		},
	],
	dashboards: [
		{ label: "dashboard", pattern: /\bdashboard(?:s)?\b/i },
		{ label: "KPI", pattern: /\bkpi\b/i },
		{ label: "embedded analytics", pattern: /\bembedded analytics\b/i },
		{ label: "analytics workspace", pattern: /\banalytics workspace\b/i },
		{
			label: "widgets and filters",
			pattern: /\b(widget|widgets|scorecard|scorecards|multi-panel)\b/i,
		},
	],
	grid: [
		{ label: "data grid", pattern: /\bdata grid\b/i },
		{ label: "data table", pattern: /\bdata table\b/i },
		{ label: "spreadsheet", pattern: /\b(spreadsheet|excel-like)\b/i },
		{ label: "enterprise grid", pattern: /\benterprise grid\b/i },
		{
			label: "tabular",
			pattern: /\b(tabular|table component|row grouping|column pinning)\b/i,
		},
	],
};

const SUGGESTED_QUERIES: SuggestedQuery[] = [
	{
		id: "core-javascript",
		product: "core",
		framework: "javascript",
		query: "javascript chart library",
		rationale:
			"Broad charting is the default Core motion and should exist in the live prompt set.",
	},
	{
		id: "core-react",
		product: "core",
		framework: "react",
		query: "react chart library",
		rationale:
			"React chart-library intent should be tracked separately from generic JavaScript charting.",
	},
	{
		id: "stock-javascript",
		product: "stock",
		framework: "javascript",
		query: "javascript financial charts",
		rationale:
			"Finance language should force the answer toward Highcharts Stock instead of plain Highcharts.",
	},
	{
		id: "stock-react",
		product: "stock",
		framework: "react",
		query: "react financial charts",
		rationale:
			"React financial prompts are important because wrappers often bias answers toward React-native competitors.",
	},
	{
		id: "maps-javascript",
		product: "maps",
		framework: "javascript",
		query: "javascript maps charts",
		rationale:
			"Map-chart phrasing should surface Maps directly rather than generic charting libraries.",
	},
	{
		id: "maps-react",
		product: "maps",
		framework: "react",
		query: "react maps charts",
		rationale:
			"React map-chart prompts deserve direct coverage because they often pull in mapping-first rivals.",
	},
	{
		id: "gantt-javascript",
		product: "gantt",
		framework: "javascript",
		query: "javascript gantt chart",
		rationale:
			"Planning and dependency queries should explicitly test whether Highcharts Gantt gets named.",
	},
	{
		id: "gantt-react",
		product: "gantt",
		framework: "react",
		query: "react gantt chart",
		rationale:
			"React gantt prompts are a distinct buying path and should not be inferred from JavaScript-only coverage.",
	},
	{
		id: "dashboards-javascript",
		product: "dashboards",
		framework: "javascript",
		query: "javascript analytics dashboard",
		rationale:
			"Dashboards should be mentioned as the shell when developers ask for analytics workspaces.",
	},
	{
		id: "dashboards-react",
		product: "dashboards",
		framework: "react",
		query: "react analytics dashboard",
		rationale:
			"React dashboard intent deserves its own coverage because many answers default to app frameworks instead of products.",
	},
	{
		id: "grid-javascript",
		product: "grid",
		framework: "javascript",
		query: "javascript data grid",
		rationale:
			"Grid needs its own prompts because table-heavy asks are not chart-library asks.",
	},
	{
		id: "grid-react",
		product: "grid",
		framework: "react",
		query: "react data grid",
		rationale:
			"React data grid is a separate decision path and should be monitored directly.",
	},
];

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function formatPct(value: number): string {
	return `${value.toFixed(1)}%`;
}

function formatGeneratedAt(value?: string): string {
	if (!value) return "Unknown";
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return value;
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(parsed));
}

function frameworkLabel(framework: FrameworkTag): string {
	if (framework === "javascript") return "JavaScript";
	if (framework === "react") return "React";
	return "General";
}

function visibilityLabel(status: VisibilityStatus): string {
	if (status === "tracked") return "Tracked";
	if (status === "awaiting_run") return "Awaiting run";
	if (status === "paused") return "Paused";
	return "Deleted";
}

function buildPromptSearchText(item: ClassifiedPrompt): string {
	return [
		item.prompt.query,
		item.prompt.tags.join(" "),
		item.leadProduct,
		PRODUCT_META[item.leadProduct].name,
		...item.supportingProducts.map((product) => PRODUCT_META[product].name),
		...item.frameworks.map(frameworkLabel),
		...item.matchedRules,
		item.prompt.topCompetitor?.entity ?? "",
		visibilityLabel(item.visibilityStatus),
	]
		.join(" ")
		.toLowerCase();
}

function buildRuleMatches(text: string): Record<ProductKey, string[]> {
	return Object.fromEntries(
		PRODUCT_ORDER.map((product) => [
			product,
			PRODUCT_RULES[product]
				.filter((rule) => rule.pattern.test(text))
				.map((rule) => rule.label),
		]),
	) as Record<ProductKey, string[]>;
}

function classifyFrameworks(prompt: PromptStatus): FrameworkTag[] {
	const normalizedTags = prompt.tags.map((tag) => tag.trim().toLowerCase());
	const query = prompt.query.toLowerCase();
	const frameworks: FrameworkTag[] = [];

	if (
		normalizedTags.includes("javascript") ||
		/\bjavascript\b/.test(query) ||
		/\bjs\b/.test(query)
	) {
		frameworks.push("javascript");
	}
	if (normalizedTags.includes("react") || /\breact\b/.test(query)) {
		frameworks.push("react");
	}
	if (frameworks.length === 0) {
		frameworks.push("general");
	}

	return FRAMEWORK_ORDER.filter((framework) => frameworks.includes(framework));
}

function classifyVisibility(prompt: PromptStatus): VisibilityStatus {
	if (prompt.status === "deleted") return "deleted";
	if (prompt.isPaused) return "paused";
	if (prompt.status === "tracked") return "tracked";
	return "awaiting_run";
}

function classifyProductMention(
	prompt: PromptStatus,
): Pick<
	ClassifiedPrompt,
	"leadProduct" | "supportingProducts" | "matchedRules" | "confidence"
> {
	const text = `${prompt.query} ${prompt.tags.join(" ")}`.toLowerCase();
	const matches = buildRuleMatches(text);
	const hasDashboardShell = matches.dashboards.length > 0;
	const specializedMatches = SPECIALIZED_PRODUCTS.filter(
		(product) => matches[product].length > 0,
	);
	const hasCoreSignal = matches.core.length > 0;

	let leadProduct: ProductKey = "core";
	if (hasDashboardShell) {
		leadProduct = "dashboards";
	} else if (specializedMatches.length > 0) {
		leadProduct = specializedMatches[0];
	} else if (hasCoreSignal) {
		leadProduct = "core";
	}

	const supportingProducts: ProductKey[] = [];
	if (leadProduct === "dashboards") {
		supportingProducts.push(...specializedMatches);
		if (!supportingProducts.includes("core")) {
			supportingProducts.push("core");
		}
	} else {
		if (hasDashboardShell) {
			supportingProducts.push("dashboards");
		}
		if (
			leadProduct === "stock" ||
			leadProduct === "maps" ||
			leadProduct === "gantt"
		) {
			supportingProducts.push("core");
		}
		for (const product of specializedMatches) {
			if (product !== leadProduct) {
				supportingProducts.push(product);
			}
		}
		if (hasCoreSignal && leadProduct !== "core") {
			supportingProducts.push("core");
		}
	}

	const orderedSupportingProducts = PRODUCT_ORDER.filter(
		(product) =>
			product !== leadProduct && supportingProducts.includes(product),
	);

	const matchedRules = unique([
		...matches[leadProduct],
		...orderedSupportingProducts.flatMap((product) => matches[product]),
	]);

	const explicitLeadSignal =
		text.includes(PRODUCT_META[leadProduct].shortName.toLowerCase()) ||
		text.includes(PRODUCT_META[leadProduct].name.toLowerCase());

	let confidence: Confidence = "low";
	if (explicitLeadSignal || matchedRules.length >= 2) {
		confidence = "high";
	} else if (matchedRules.length === 1) {
		confidence = "medium";
	}

	return {
		leadProduct,
		supportingProducts: orderedSupportingProducts,
		matchedRules,
		confidence,
	};
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function statusSortOrder(status: VisibilityStatus): number {
	if (status === "tracked") return 0;
	if (status === "awaiting_run") return 1;
	if (status === "paused") return 2;
	return 3;
}

function ProductChip({
	product,
	muted,
}: {
	product: ProductKey;
	muted?: boolean;
}) {
	const meta = PRODUCT_META[product];
	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
			style={{
				background: muted ? "#F7F2EA" : meta.surface,
				color: muted ? "#6D7B6E" : meta.accent,
				border: `1px solid ${muted ? "#DDD0BC" : meta.border}`,
			}}
		>
			{meta.shortName}
		</span>
	);
}

function FrameworkChip({ framework }: { framework: FrameworkTag }) {
	const styles =
		framework === "javascript"
			? { background: "#EEF4FF", color: "#315B92", border: "#CCD9F0" }
			: framework === "react"
				? { background: "#F4F0FF", color: "#69459C", border: "#DACCF0" }
				: { background: "#F4F2EC", color: "#6B746A", border: "#DDD0BC" };

	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
			style={{
				background: styles.background,
				color: styles.color,
				border: `1px solid ${styles.border}`,
			}}
		>
			{frameworkLabel(framework)}
		</span>
	);
}

function VisibilityBadge({ status }: { status: VisibilityStatus }) {
	const styles =
		status === "tracked"
			? { background: "#EEF7EF", color: "#2B6031", border: "#C8DEC9" }
			: status === "awaiting_run"
				? { background: "#F6F1EA", color: "#7A6654", border: "#E5D6C2" }
				: status === "paused"
					? { background: "#F2EDE6", color: "#8D9B8E", border: "#DDD0BC" }
					: { background: "#FEF2F2", color: "#B42318", border: "#F4CACA" };

	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
			style={{
				background: styles.background,
				color: styles.color,
				border: `1px solid ${styles.border}`,
			}}
		>
			{visibilityLabel(status)}
		</span>
	);
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
	const styles =
		confidence === "high"
			? { background: "#EEF6EF", color: "#356A3D", border: "#C9DDCA" }
			: confidence === "medium"
				? { background: "#FBF6E7", color: "#8C6B17", border: "#E6D9AC" }
				: { background: "#F4F2EC", color: "#6D7B6E", border: "#DDD0BC" };

	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
			style={{
				background: styles.background,
				color: styles.color,
				border: `1px solid ${styles.border}`,
			}}
		>
			{confidence} confidence
		</span>
	);
}

function StatCard({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub: string;
}) {
	return (
		<div
			className="rounded-2xl border px-4 py-3"
			style={{
				background: "#FFFFFF",
				borderColor: "#DDD0BC",
				boxShadow: "0 12px 30px rgba(61,92,64,0.05)",
			}}
		>
			<div
				className="text-[11px] uppercase tracking-[0.14em]"
				style={{ color: "#8A9B8C" }}
			>
				{label}
			</div>
			<div
				className="mt-1 text-[28px] font-semibold tracking-tight"
				style={{ color: "#263628" }}
			>
				{value}
			</div>
			<div className="text-xs leading-relaxed" style={{ color: "#708272" }}>
				{sub}
			</div>
		</div>
	);
}

function FilterPill({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
			style={{
				background: active ? "#2F4F34" : "#FFFFFF",
				color: active ? "#FDFCF8" : "#4F6552",
				border: `1px solid ${active ? "#2F4F34" : "#DDD0BC"}`,
				boxShadow: active ? "0 10px 20px rgba(47,79,52,0.18)" : "none",
			}}
		>
			{label}
		</button>
	);
}

function QueryCard({ item }: { item: ClassifiedPrompt }) {
	const leadMeta = PRODUCT_META[item.leadProduct];

	return (
		<article
			className="rounded-[24px] border p-4 space-y-3"
			style={{ background: "#FFFFFF", borderColor: "#E4D8C8" }}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						{item.frameworks.map((framework) => (
							<FrameworkChip
								key={`${item.prompt.query}-${framework}`}
								framework={framework}
							/>
						))}
						<VisibilityBadge status={item.visibilityStatus} />
						<ConfidenceBadge confidence={item.confidence} />
					</div>
					<div
						className="text-base font-semibold tracking-tight"
						style={{ color: "#253325" }}
					>
						{item.prompt.query}
					</div>
				</div>

				<div
					className="rounded-2xl px-3 py-2 text-right"
					style={{
						background: leadMeta.surface,
						border: `1px solid ${leadMeta.border}`,
					}}
				>
					<div
						className="text-[10px] uppercase tracking-[0.16em]"
						style={{ color: "#809282" }}
					>
						Lead product
					</div>
					<div
						className="text-xs font-semibold"
						style={{ color: leadMeta.accent }}
					>
						{leadMeta.shortName}
					</div>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<ProductChip product={item.leadProduct} />
				{item.supportingProducts.map((product) => (
					<ProductChip
						key={`${item.prompt.query}-${product}`}
						product={product}
						muted
					/>
				))}
			</div>

			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<div
					className="rounded-2xl border px-3 py-2"
					style={{ background: "#FBF7F0", borderColor: "#E7DAC8" }}
				>
					<div
						className="text-[10px] uppercase tracking-[0.16em]"
						style={{ color: "#8A9B8C" }}
					>
						HC mention
					</div>
					<div
						className="mt-1 text-sm font-semibold"
						style={{ color: "#2B6031" }}
					>
						{formatPct(item.prompt.highchartsRatePct)}
					</div>
				</div>
				<div
					className="rounded-2xl border px-3 py-2"
					style={{ background: "#FBF7F0", borderColor: "#E7DAC8" }}
				>
					<div
						className="text-[10px] uppercase tracking-[0.16em]"
						style={{ color: "#8A9B8C" }}
					>
						Runs
					</div>
					<div
						className="mt-1 text-sm font-semibold"
						style={{ color: "#253325" }}
					>
						{item.prompt.runs}
					</div>
				</div>
				<div
					className="rounded-2xl border px-3 py-2"
					style={{ background: "#FBF7F0", borderColor: "#E7DAC8" }}
				>
					<div
						className="text-[10px] uppercase tracking-[0.16em]"
						style={{ color: "#8A9B8C" }}
					>
						Responses
					</div>
					<div
						className="mt-1 text-sm font-semibold"
						style={{ color: "#253325" }}
					>
						{item.prompt.latestRunResponseCount ?? 0}
					</div>
				</div>
				<div
					className="rounded-2xl border px-3 py-2"
					style={{ background: "#FBF7F0", borderColor: "#E7DAC8" }}
				>
					<div
						className="text-[10px] uppercase tracking-[0.16em]"
						style={{ color: "#8A9B8C" }}
					>
						Top rival
					</div>
					<div
						className="mt-1 text-sm font-semibold"
						style={{ color: "#253325" }}
					>
						{item.prompt.topCompetitor?.entity ?? "n/a"}
					</div>
				</div>
			</div>

			{item.matchedRules.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{item.matchedRules.map((rule) => (
						<span
							key={`${item.prompt.query}-${rule}`}
							className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
							style={{
								background: "#F5EFE5",
								color: "#7A6755",
								border: "1px solid #E5D6C2",
							}}
						>
							{rule}
						</span>
					))}
				</div>
			) : null}

			{item.prompt.tags.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{item.prompt.tags.map((tag) => (
						<span
							key={`${item.prompt.query}-tag-${tag}`}
							className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
							style={{
								background: "#F4F2EC",
								color: "#6B746A",
								border: "1px solid #DDD0BC",
							}}
						>
							{tag}
						</span>
					))}
				</div>
			) : null}
		</article>
	);
}

function SuggestionBadge({ state }: { state: SuggestionState }) {
	const styles =
		state === "missing"
			? {
					background: "#FEF2F2",
					color: "#B42318",
					border: "#F4CACA",
					label: "Missing",
				}
			: state === "needs_runs"
				? {
						background: "#FBF6E7",
						color: "#8C6B17",
						border: "#E6D9AC",
						label: "Needs runs",
					}
				: {
						background: "#FDF5E8",
						color: "#9C5B3A",
						border: "#EACDBF",
						label: "Needs lift",
					};

	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
			style={{
				background: styles.background,
				color: styles.color,
				border: `1px solid ${styles.border}`,
			}}
		>
			{styles.label}
		</span>
	);
}

function LoadingCard() {
	return (
		<div
			className="rounded-[26px] border p-5 space-y-4 animate-pulse"
			style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
		>
			<div className="h-4 w-40 rounded" style={{ background: "#E7DAC8" }} />
			<div
				className="h-10 w-full rounded-2xl"
				style={{ background: "#F2EDE6" }}
			/>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }).map((_, index) => (
					<div
						key={index}
						className="h-28 rounded-2xl"
						style={{ background: "#F2EDE6" }}
					/>
				))}
			</div>
		</div>
	);
}

export default function ProductMentions() {
	const [frameworkFilter, setFrameworkFilter] =
		useState<FrameworkFilter>("all");
	const [productFilter, setProductFilter] = useState<ProductFilter>("all");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [search, setSearch] = useState("");
	const [copyMessage, setCopyMessage] = useState("");
	const [suggestionCopyMessage, setSuggestionCopyMessage] = useState("");
	const deferredSearch = useDeferredValue(search);
	const normalizedSearch = deferredSearch.trim().toLowerCase();

	const dashboardQuery = useQuery({
		queryKey: ["dashboard"],
		queryFn: api.dashboard,
		refetchInterval: 60_000,
	});

	useEffect(() => {
		if (!copyMessage) return;
		const timeoutId = window.setTimeout(() => setCopyMessage(""), 1800);
		return () => window.clearTimeout(timeoutId);
	}, [copyMessage]);

	useEffect(() => {
		if (!suggestionCopyMessage) return;
		const timeoutId = window.setTimeout(
			() => setSuggestionCopyMessage(""),
			1800,
		);
		return () => window.clearTimeout(timeoutId);
	}, [suggestionCopyMessage]);

	const classifiedPrompts = useMemo(() => {
		const prompts = dashboardQuery.data?.promptStatus ?? [];
		return prompts
			.map((prompt) => {
				const classification = classifyProductMention(prompt);
				return {
					prompt,
					frameworks: classifyFrameworks(prompt),
					visibilityStatus: classifyVisibility(prompt),
					...classification,
				} satisfies ClassifiedPrompt;
			})
			.sort((left, right) => {
				const leftStatus = statusSortOrder(left.visibilityStatus);
				const rightStatus = statusSortOrder(right.visibilityStatus);
				if (leftStatus !== rightStatus) return leftStatus - rightStatus;
				if (right.prompt.highchartsRatePct !== left.prompt.highchartsRatePct) {
					return right.prompt.highchartsRatePct - left.prompt.highchartsRatePct;
				}
				if (right.prompt.runs !== left.prompt.runs) {
					return right.prompt.runs - left.prompt.runs;
				}
				return left.prompt.query.localeCompare(right.prompt.query);
			});
	}, [dashboardQuery.data?.promptStatus]);

	const activeTrackedPrompts = useMemo(
		() =>
			classifiedPrompts.filter((item) => item.visibilityStatus === "tracked"),
		[classifiedPrompts],
	);

	const productCoverage = useMemo(() => {
		return PRODUCT_ORDER.map((product) => {
			const rows = classifiedPrompts.filter(
				(item) => item.leadProduct === product,
			);
			const trackedRows = rows.filter(
				(item) => item.visibilityStatus === "tracked",
			);
			return {
				product,
				totalQueries: rows.length,
				trackedQueries: trackedRows.length,
				pausedQueries: rows.filter((item) => item.visibilityStatus === "paused")
					.length,
				avgHighchartsRate: average(
					trackedRows.map((item) => item.prompt.highchartsRatePct),
				),
				javascriptCount: rows.filter((item) =>
					item.frameworks.includes("javascript"),
				).length,
				reactCount: rows.filter((item) => item.frameworks.includes("react"))
					.length,
				generalCount: rows.filter((item) => item.frameworks.includes("general"))
					.length,
				bundleCount: rows.filter((item) => item.supportingProducts.length > 0)
					.length,
			} satisfies ProductCoverageRow;
		});
	}, [classifiedPrompts]);

	const filteredPrompts = useMemo(() => {
		return classifiedPrompts.filter((item) => {
			if (
				frameworkFilter !== "all" &&
				!item.frameworks.includes(frameworkFilter)
			) {
				return false;
			}

			if (
				productFilter !== "all" &&
				item.leadProduct !== productFilter &&
				!item.supportingProducts.includes(productFilter)
			) {
				return false;
			}

			if (statusFilter !== "all" && item.visibilityStatus !== statusFilter) {
				return false;
			}

			if (!normalizedSearch) return true;
			return buildPromptSearchText(item).includes(normalizedSearch);
		});
	}, [
		classifiedPrompts,
		frameworkFilter,
		normalizedSearch,
		productFilter,
		statusFilter,
	]);

	const visibleCoverage = useMemo(() => {
		return PRODUCT_ORDER.map((product) => {
			const rows = filteredPrompts.filter(
				(item) => item.leadProduct === product,
			);
			const trackedRows = rows.filter(
				(item) => item.visibilityStatus === "tracked",
			);
			return {
				product,
				totalQueries: rows.length,
				trackedQueries: trackedRows.length,
				pausedQueries: rows.filter((item) => item.visibilityStatus === "paused")
					.length,
				avgHighchartsRate: average(
					trackedRows.map((item) => item.prompt.highchartsRatePct),
				),
				javascriptCount: rows.filter((item) =>
					item.frameworks.includes("javascript"),
				).length,
				reactCount: rows.filter((item) => item.frameworks.includes("react"))
					.length,
				generalCount: rows.filter((item) => item.frameworks.includes("general"))
					.length,
				bundleCount: rows.filter((item) => item.supportingProducts.length > 0)
					.length,
			} satisfies ProductCoverageRow;
		});
	}, [filteredPrompts]);

	const groupedPrompts = useMemo(() => {
		return PRODUCT_ORDER.map((product) => ({
			product,
			items: filteredPrompts.filter((item) => item.leadProduct === product),
		})).filter((group) => group.items.length > 0);
	}, [filteredPrompts]);

	const coverageSuggestions = useMemo(() => {
		return SUGGESTED_QUERIES.map((suggestion) => {
			const matchingPrompts = classifiedPrompts.filter(
				(item) =>
					item.leadProduct === suggestion.product &&
					item.frameworks.includes(suggestion.framework),
			);
			const trackedPrompts = matchingPrompts.filter(
				(item) => item.visibilityStatus === "tracked",
			);
			const avgHighchartsRate = average(
				trackedPrompts.map((item) => item.prompt.highchartsRatePct),
			);

			let state: SuggestionState = "needs_lift";
			if (matchingPrompts.length === 0) {
				state = "missing";
			} else if (trackedPrompts.length === 0) {
				state = "needs_runs";
			}

			return {
				...suggestion,
				state,
				existingCount: matchingPrompts.length,
				trackedCount: trackedPrompts.length,
				avgHighchartsRate,
			} satisfies CoverageSuggestion;
		})
			.filter(
				(suggestion) =>
					suggestion.state !== "needs_lift" ||
					suggestion.avgHighchartsRate < 45,
			)
			.sort((left, right) => {
				const stateRank = { missing: 0, needs_runs: 1, needs_lift: 2 };
				if (stateRank[left.state] !== stateRank[right.state]) {
					return stateRank[left.state] - stateRank[right.state];
				}
				if (left.product !== right.product) {
					return (
						PRODUCT_ORDER.indexOf(left.product) -
						PRODUCT_ORDER.indexOf(right.product)
					);
				}
				return left.framework.localeCompare(right.framework);
			});
	}, [classifiedPrompts]);

	const visibleSuggestions = useMemo(() => {
		return coverageSuggestions.filter((suggestion) => {
			if (
				frameworkFilter !== "all" &&
				suggestion.framework !== frameworkFilter
			) {
				return false;
			}
			if (productFilter !== "all" && suggestion.product !== productFilter) {
				return false;
			}
			if (!normalizedSearch) return true;
			return [
				suggestion.query,
				suggestion.rationale,
				PRODUCT_META[suggestion.product].name,
				frameworkLabel(suggestion.framework),
			]
				.join(" ")
				.toLowerCase()
				.includes(normalizedSearch);
		});
	}, [coverageSuggestions, frameworkFilter, normalizedSearch, productFilter]);

	const totalLiveQueries = classifiedPrompts.length;
	const avgHighchartsRate = average(
		activeTrackedPrompts.map((item) => item.prompt.highchartsRatePct),
	);
	const bundleOpportunities = classifiedPrompts.filter(
		(item) => item.supportingProducts.length > 0,
	).length;
	const visibleTrackedCount = filteredPrompts.filter(
		(item) => item.visibilityStatus === "tracked",
	).length;

	const chartOptions: Highcharts.Options = useMemo(
		() => ({
			chart: {
				type: "column",
				backgroundColor: "transparent",
				height: 360,
				spacing: [8, 8, 8, 8],
				style: { fontFamily: "'Inter', system-ui, sans-serif" },
			},
			title: { text: undefined },
			credits: { enabled: false },
			legend: {
				align: "left",
				verticalAlign: "top",
				itemStyle: { color: "#405242", fontSize: "11px", fontWeight: "600" },
				symbolRadius: 3,
			},
			xAxis: {
				categories: visibleCoverage.map(
					(row) => PRODUCT_META[row.product].shortName,
				),
				lineColor: "#DDD0BC",
				tickColor: "#DDD0BC",
				labels: { style: { color: "#5C6E5D", fontSize: "11px" } },
			},
			yAxis: {
				min: 0,
				title: { text: undefined },
				gridLineColor: "#EEE5D8",
				labels: { style: { color: "#8C9B8D", fontSize: "10px" } },
				allowDecimals: false,
			},
			tooltip: {
				backgroundColor: "#FFFFFF",
				borderColor: "#DDD0BC",
				borderRadius: 10,
				shadow: false,
				style: { color: "#263628", fontSize: "12px" },
				formatter() {
					const context = this as Highcharts.TooltipFormatterContextObject;
					const points = context.points ?? [];
					const productLabel = String(context.x ?? "");
					const row = visibleCoverage.find(
						(coverageRow) =>
							PRODUCT_META[coverageRow.product].shortName === productLabel,
					);
					const lines = points
						.map(
							(point) =>
								`<span style="color:${String(point.color)}">●</span> ${point.series.name}: <b>${point.y}</b>`,
						)
						.join("<br/>");
					return `<b>${productLabel}</b><br/>${lines}<br/><span style="opacity:0.75">Tracked queries: ${row?.trackedQueries ?? 0}</span><br/><span style="opacity:0.75">Avg HC mention: ${formatPct(row?.avgHighchartsRate ?? 0)}</span>`;
				},
				shared: true,
			},
			plotOptions: {
				series: {
					stacking: "normal",
					borderWidth: 0,
					pointPadding: 0.12,
				},
			},
			series: [
				{
					type: "column",
					name: "JavaScript",
					data: visibleCoverage.map((row) => row.javascriptCount),
					color: "#486F4D",
				},
				{
					type: "column",
					name: "React",
					data: visibleCoverage.map((row) => row.reactCount),
					color: "#C7A456",
				},
				{
					type: "column",
					name: "General",
					data: visibleCoverage.map((row) => row.generalCount),
					color: "#9AAE9C",
				},
			],
		}),
		[visibleCoverage],
	);

	async function copyVisibleQueries() {
		const lines = filteredPrompts.map((item) => item.prompt.query);
		const uniqueLines = unique(lines);

		if (uniqueLines.length === 0) {
			setCopyMessage("Nothing to copy");
			return;
		}

		try {
			await navigator.clipboard.writeText(uniqueLines.join("\n"));
			setCopyMessage(`Copied ${uniqueLines.length} live queries`);
		} catch (error) {
			console.error("Failed to copy live product mention queries", error);
			setCopyMessage("Copy failed");
		}
	}

	async function copySuggestedQueries() {
		const lines = visibleSuggestions.map((item) => item.query);
		const uniqueLines = unique(lines);

		if (uniqueLines.length === 0) {
			setSuggestionCopyMessage("Nothing to copy");
			return;
		}

		try {
			await navigator.clipboard.writeText(uniqueLines.join("\n"));
			setSuggestionCopyMessage(
				`Copied ${uniqueLines.length} suggested queries`,
			);
		} catch (error) {
			console.error("Failed to copy suggested product mention queries", error);
			setSuggestionCopyMessage("Copy failed");
		}
	}

	if (dashboardQuery.isLoading) {
		return (
			<div className="max-w-[1480px] space-y-5">
				<LoadingCard />
			</div>
		);
	}

	if (dashboardQuery.isError) {
		return (
			<div
				className="rounded-[26px] border p-5"
				style={{
					background: "#FFF7F6",
					borderColor: "#F4CACA",
					color: "#8F2D2D",
				}}
			>
				<div className="flex items-center gap-2 text-base font-semibold">
					<AlertTriangle size={18} />
					Product mention data failed to load
				</div>
				<p className="mt-2 text-sm leading-relaxed">
					{String(
						dashboardQuery.error instanceof Error
							? dashboardQuery.error.message
							: dashboardQuery.error,
					)}
				</p>
			</div>
		);
	}

	return (
		<div className="max-w-[1480px] space-y-5">
			<section
				className="relative overflow-hidden rounded-[28px] border p-5 sm:p-6"
				style={{
					background:
						"linear-gradient(135deg, #FFFDF6 0%, #F8F1E6 44%, #EEF6EF 100%)",
					borderColor: "#DDD0BC",
					boxShadow: "0 22px 48px rgba(42,58,44,0.08)",
				}}
			>
				<div
					aria-hidden="true"
					style={{
						position: "absolute",
						inset: 0,
						backgroundImage:
							"radial-gradient(circle at 18% 18%, rgba(143,187,147,0.18), transparent 28%), radial-gradient(circle at 82% 10%, rgba(200,168,122,0.16), transparent 24%), linear-gradient(rgba(61,92,64,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(61,92,64,0.05) 1px, transparent 1px)",
						backgroundSize: "auto, auto, 26px 26px, 26px 26px",
						pointerEvents: "none",
					}}
				/>

				<div className="relative space-y-6">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="max-w-3xl space-y-4">
							<div className="flex flex-wrap gap-2">
								<span
									className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
									style={{
										background: "#FFFFFF",
										color: "#47604A",
										border: "1px solid #DDD0BC",
									}}
								>
									<Sparkles size={14} />
									Live prompt data
								</span>
								<span
									className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
									style={{
										background: "#FFFFFF",
										color: "#47604A",
										border: "1px solid #DDD0BC",
									}}
								>
									<Layers size={14} />
									Product mention routing
								</span>
							</div>

							<div>
								<h2
									className="text-3xl sm:text-[34px] font-semibold tracking-tight"
									style={{ color: "#223124" }}
								>
									Highcharts product mention planner
								</h2>
								<p
									className="mt-2 max-w-2xl text-sm sm:text-[15px] leading-relaxed"
									style={{ color: "#5A6F5D" }}
								>
									This board now classifies the live prompt inventory from
									benchmark data. Each prompt is routed to the Highcharts
									product it implies, then measured against current Highcharts
									mention performance.
								</p>
							</div>

							<div className="text-xs font-medium" style={{ color: "#6E8170" }}>
								Last updated{" "}
								{formatGeneratedAt(dashboardQuery.data?.generatedAt)}
							</div>
						</div>

						<div className="flex flex-col items-stretch gap-2 min-w-[220px]">
							<button
								type="button"
								onClick={() => {
									void copyVisibleQueries();
								}}
								className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
								style={{
									background: "#2F4F34",
									color: "#FDFCF8",
									border: "1px solid #2F4F34",
								}}
							>
								<Copy size={15} />
								Copy live queries
							</button>
							<Link
								to="/query-lab"
								className="inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold"
								style={{
									background: "#FFFFFF",
									color: "#3E5541",
									border: "1px solid #DDD0BC",
								}}
							>
								Open Query Lab
							</Link>
							<div
								className="h-5 text-center text-xs font-medium"
								style={{ color: "#6E8170" }}
							>
								{copyMessage}
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
						<StatCard
							label="Live Queries"
							value={String(totalLiveQueries)}
							sub="Prompt rows classified from the current dashboard dataset."
						/>
						<StatCard
							label="Tracked"
							value={String(activeTrackedPrompts.length)}
							sub="Active prompts with historical run data behind them."
						/>
						<StatCard
							label="Avg HC Mention"
							value={formatPct(avgHighchartsRate)}
							sub="Average Highcharts mention rate across active tracked prompts."
						/>
						<StatCard
							label="Bundle Opportunities"
							value={String(bundleOpportunities)}
							sub="Live prompts that imply multiple Highcharts products in one answer."
						/>
					</div>
				</div>
			</section>

			<section
				className="rounded-[26px] border p-5"
				style={{
					background: "#FFFFFF",
					borderColor: "#DDD0BC",
					boxShadow: "0 16px 40px rgba(42,58,44,0.05)",
				}}
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3
							className="text-lg font-semibold tracking-tight"
							style={{ color: "#243325" }}
						>
							Product routing rules with live coverage
						</h3>
						<p className="text-sm mt-1" style={{ color: "#6B7C6D" }}>
							Static rules define what each query should trigger. Live metrics
							show whether current prompts already cover that product well.
						</p>
					</div>
					<div className="text-xs font-medium" style={{ color: "#879888" }}>
						Coverage is based on the current prompt inventory, not hardcoded
						demo rows.
					</div>
				</div>

				<div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
					{productCoverage.map((coverage) => {
						const meta = PRODUCT_META[coverage.product];
						return (
							<article
								key={coverage.product}
								className="rounded-[22px] border p-4 space-y-3"
								style={{ background: meta.surface, borderColor: meta.border }}
							>
								<div className="flex items-center justify-between gap-3">
									<div>
										<div
											className="text-xs uppercase tracking-[0.16em]"
											style={{ color: "#7A8D7C" }}
										>
											{meta.shortName}
										</div>
										<div
											className="text-base font-semibold tracking-tight"
											style={{ color: meta.accent }}
										>
											{meta.name}
										</div>
									</div>
									<div
										className="h-10 w-10 rounded-2xl"
										style={{
											background: meta.accent,
											boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)",
										}}
									/>
								</div>

								<p
									className="text-sm leading-relaxed"
									style={{ color: "#516452" }}
								>
									{meta.summary}
								</p>

								<div className="grid grid-cols-3 gap-2">
									<div
										className="rounded-2xl border px-3 py-2"
										style={{
											background: "#FFFFFF",
											borderColor: "rgba(255,255,255,0.58)",
										}}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#8A9B8C" }}
										>
											Queries
										</div>
										<div
											className="mt-1 text-sm font-semibold"
											style={{ color: "#253325" }}
										>
											{coverage.totalQueries}
										</div>
									</div>
									<div
										className="rounded-2xl border px-3 py-2"
										style={{
											background: "#FFFFFF",
											borderColor: "rgba(255,255,255,0.58)",
										}}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#8A9B8C" }}
										>
											Tracked
										</div>
										<div
											className="mt-1 text-sm font-semibold"
											style={{ color: "#253325" }}
										>
											{coverage.trackedQueries}
										</div>
									</div>
									<div
										className="rounded-2xl border px-3 py-2"
										style={{
											background: "#FFFFFF",
											borderColor: "rgba(255,255,255,0.58)",
										}}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#8A9B8C" }}
										>
											Avg HC
										</div>
										<div
											className="mt-1 text-sm font-semibold"
											style={{ color: "#253325" }}
										>
											{formatPct(coverage.avgHighchartsRate)}
										</div>
									</div>
								</div>

								<div
									className="rounded-2xl px-3 py-3 text-sm leading-relaxed"
									style={{
										background: "#FFFFFF",
										border: "1px solid rgba(255,255,255,0.58)",
									}}
								>
									<div className="font-semibold" style={{ color: "#334635" }}>
										Trigger
									</div>
									<div style={{ color: "#617262" }}>{meta.trigger}</div>
								</div>

								<div
									className="rounded-2xl px-3 py-3 text-sm leading-relaxed"
									style={{
										background: "rgba(255,255,255,0.76)",
										border: "1px solid rgba(255,255,255,0.58)",
									}}
								>
									<div className="font-semibold" style={{ color: "#334635" }}>
										Expand with
									</div>
									<div style={{ color: "#617262" }}>{meta.expandWith}</div>
								</div>
							</article>
						);
					})}
				</div>
			</section>

			<section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.92fr_1.08fr]">
				<div className="space-y-4">
					<div
						className="rounded-[26px] border p-5"
						style={{
							background: "#FFFFFF",
							borderColor: "#DDD0BC",
							boxShadow: "0 16px 40px rgba(42,58,44,0.05)",
						}}
					>
						<div className="flex items-center gap-2">
							<Search size={16} color="#627463" />
							<div
								className="text-sm font-semibold"
								style={{ color: "#243325" }}
							>
								Filter live prompts
							</div>
						</div>

						<div className="mt-4 space-y-4">
							<label className="block">
								<span
									className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em]"
									style={{ color: "#8A9B8C" }}
								>
									Search
								</span>
								<input
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="financial, maps, gantt, dashboard, grid..."
									className="w-full rounded-2xl px-4 py-3 text-sm"
									style={{
										border: "1px solid #DDD0BC",
										background: "#FDFBF7",
										color: "#243325",
									}}
								/>
							</label>

							<div>
								<div
									className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]"
									style={{ color: "#8A9B8C" }}
								>
									Framework
								</div>
								<div className="flex flex-wrap gap-2">
									<FilterPill
										active={frameworkFilter === "all"}
										label="All"
										onClick={() =>
											startTransition(() => setFrameworkFilter("all"))
										}
									/>
									<FilterPill
										active={frameworkFilter === "javascript"}
										label="JavaScript"
										onClick={() =>
											startTransition(() => setFrameworkFilter("javascript"))
										}
									/>
									<FilterPill
										active={frameworkFilter === "react"}
										label="React"
										onClick={() =>
											startTransition(() => setFrameworkFilter("react"))
										}
									/>
									<FilterPill
										active={frameworkFilter === "general"}
										label="General"
										onClick={() =>
											startTransition(() => setFrameworkFilter("general"))
										}
									/>
								</div>
							</div>

							<div>
								<div
									className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]"
									style={{ color: "#8A9B8C" }}
								>
									Product mention
								</div>
								<div className="flex flex-wrap gap-2">
									<FilterPill
										active={productFilter === "all"}
										label="All products"
										onClick={() =>
											startTransition(() => setProductFilter("all"))
										}
									/>
									{PRODUCT_ORDER.map((product) => (
										<FilterPill
											key={product}
											active={productFilter === product}
											label={PRODUCT_META[product].shortName}
											onClick={() =>
												startTransition(() => setProductFilter(product))
											}
										/>
									))}
								</div>
							</div>

							<div>
								<div
									className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]"
									style={{ color: "#8A9B8C" }}
								>
									Status
								</div>
								<div className="flex flex-wrap gap-2">
									<FilterPill
										active={statusFilter === "all"}
										label="All"
										onClick={() =>
											startTransition(() => setStatusFilter("all"))
										}
									/>
									<FilterPill
										active={statusFilter === "tracked"}
										label="Tracked"
										onClick={() =>
											startTransition(() => setStatusFilter("tracked"))
										}
									/>
									<FilterPill
										active={statusFilter === "awaiting_run"}
										label="Awaiting"
										onClick={() =>
											startTransition(() => setStatusFilter("awaiting_run"))
										}
									/>
									<FilterPill
										active={statusFilter === "paused"}
										label="Paused"
										onClick={() =>
											startTransition(() => setStatusFilter("paused"))
										}
									/>
									<FilterPill
										active={statusFilter === "deleted"}
										label="Deleted"
										onClick={() =>
											startTransition(() => setStatusFilter("deleted"))
										}
									/>
								</div>
							</div>
						</div>
					</div>

					<div
						className="rounded-[26px] border p-5"
						style={{
							background: "#FFFFFF",
							borderColor: "#DDD0BC",
							boxShadow: "0 16px 40px rgba(42,58,44,0.05)",
						}}
					>
						<div>
							<h3
								className="text-lg font-semibold tracking-tight"
								style={{ color: "#243325" }}
							>
								Visible coverage
							</h3>
							<p className="text-sm mt-1" style={{ color: "#6B7C6D" }}>
								Framework counts by lead product for the current filter.
								JavaScript and React counts can overlap on mixed prompts.
							</p>
						</div>
						<div className="mt-4">
							<HighchartsReact highcharts={Highcharts} options={chartOptions} />
						</div>
					</div>
				</div>

				<div
					className="rounded-[26px] border p-5"
					style={{
						background: "#FFFFFF",
						borderColor: "#DDD0BC",
						boxShadow: "0 16px 40px rgba(42,58,44,0.05)",
					}}
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h3
								className="text-lg font-semibold tracking-tight"
								style={{ color: "#243325" }}
							>
								Live prompt inventory
							</h3>
							<p className="text-sm mt-1" style={{ color: "#6B7C6D" }}>
								{filteredPrompts.length} prompts visible, with{" "}
								{visibleTrackedCount} active tracked prompts in the current
								filter.
							</p>
						</div>
						<Link
							to="/prompts"
							className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold"
							style={{
								background: "#F5EFE5",
								color: "#5C6F5F",
								border: "1px solid #E5D6C2",
							}}
						>
							Open Prompts
						</Link>
					</div>

					{groupedPrompts.length === 0 ? (
						<div
							className="mt-4 rounded-2xl border px-4 py-5 text-sm"
							style={{
								background: "#FBF7F0",
								borderColor: "#E7DAC8",
								color: "#6A7C6B",
							}}
						>
							No live prompts match the current filter.
						</div>
					) : (
						<div className="mt-5 space-y-5">
							{groupedPrompts.map((group) => (
								<section key={group.product} className="space-y-3">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div className="flex items-center gap-3">
											<div
												className="h-11 w-11 rounded-2xl"
												style={{
													background: PRODUCT_META[group.product].accent,
													boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
												}}
											/>
											<div>
												<div
													className="text-lg font-semibold tracking-tight"
													style={{ color: "#243325" }}
												>
													{PRODUCT_META[group.product].name}
												</div>
												<div className="text-sm" style={{ color: "#6A7C6B" }}>
													{group.items.length} live prompts routed here
												</div>
											</div>
										</div>
										<ProductChip product={group.product} />
									</div>

									<div className="grid grid-cols-1 gap-3">
										{group.items.map((item) => (
											<QueryCard key={item.prompt.query} item={item} />
										))}
									</div>
								</section>
							))}
						</div>
					)}
				</div>
			</section>

			<section
				className="rounded-[26px] border p-5"
				style={{
					background: "#FFFFFF",
					borderColor: "#DDD0BC",
					boxShadow: "0 16px 40px rgba(42,58,44,0.05)",
				}}
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3
							className="text-lg font-semibold tracking-tight"
							style={{ color: "#243325" }}
						>
							Dynamic coverage gaps
						</h3>
						<p className="text-sm mt-1" style={{ color: "#6B7C6D" }}>
							These recommendations are generated from live coverage gaps, not a
							fixed page mockup.
						</p>
					</div>
					<div className="flex flex-col items-end gap-1">
						<button
							type="button"
							onClick={() => {
								void copySuggestedQueries();
							}}
							className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
							style={{
								background: "#2F4F34",
								color: "#FDFCF8",
								border: "1px solid #2F4F34",
							}}
						>
							<Copy size={13} />
							Copy suggested gaps
						</button>
						<div
							className="h-4 text-xs font-medium"
							style={{ color: "#6E8170" }}
						>
							{suggestionCopyMessage}
						</div>
					</div>
				</div>

				{visibleSuggestions.length === 0 ? (
					<div
						className="mt-4 rounded-2xl border px-4 py-5 text-sm"
						style={{
							background: "#EEF6EF",
							borderColor: "#C9DDCA",
							color: "#356A3D",
						}}
					>
						No current gaps under this filter. The live dataset already covers
						these product and framework combinations reasonably well.
					</div>
				) : (
					<div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
						{visibleSuggestions.map((suggestion) => (
							<article
								key={suggestion.id}
								className="rounded-[24px] border p-4 space-y-3"
								style={{
									background:
										"linear-gradient(180deg, #FFFDF8 0%, #F7F1E8 100%)",
									borderColor: "#E5D8C6",
								}}
							>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="space-y-2">
										<div className="flex flex-wrap items-center gap-2">
											<ProductChip product={suggestion.product} />
											<FrameworkChip framework={suggestion.framework} />
											<SuggestionBadge state={suggestion.state} />
										</div>
										<div
											className="text-base font-semibold tracking-tight"
											style={{ color: "#243325" }}
										>
											{suggestion.query}
										</div>
									</div>
									<div
										className="rounded-2xl px-3 py-2 text-right"
										style={{
											background: "#FFFFFF",
											border: "1px solid #E5D6C2",
										}}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#809282" }}
										>
											Live coverage
										</div>
										<div
											className="text-xs font-semibold"
											style={{ color: "#253325" }}
										>
											{suggestion.existingCount} queries
										</div>
									</div>
								</div>

								<p
									className="text-sm leading-relaxed"
									style={{ color: "#5E7260" }}
								>
									{suggestion.rationale}
								</p>

								<div className="grid grid-cols-3 gap-2">
									<div
										className="rounded-2xl border px-3 py-2"
										style={{ background: "#FFFFFF", borderColor: "#E5D6C2" }}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#8A9B8C" }}
										>
											Existing
										</div>
										<div
											className="mt-1 text-sm font-semibold"
											style={{ color: "#253325" }}
										>
											{suggestion.existingCount}
										</div>
									</div>
									<div
										className="rounded-2xl border px-3 py-2"
										style={{ background: "#FFFFFF", borderColor: "#E5D6C2" }}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#8A9B8C" }}
										>
											Tracked
										</div>
										<div
											className="mt-1 text-sm font-semibold"
											style={{ color: "#253325" }}
										>
											{suggestion.trackedCount}
										</div>
									</div>
									<div
										className="rounded-2xl border px-3 py-2"
										style={{ background: "#FFFFFF", borderColor: "#E5D6C2" }}
									>
										<div
											className="text-[10px] uppercase tracking-[0.16em]"
											style={{ color: "#8A9B8C" }}
										>
											Avg HC
										</div>
										<div
											className="mt-1 text-sm font-semibold"
											style={{ color: "#253325" }}
										>
											{formatPct(suggestion.avgHighchartsRate)}
										</div>
									</div>
								</div>
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
