import { useQuery } from "@tanstack/react-query";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { useMemo, useState } from "react";
import { api } from "../api";
import CitationSourceLeaderboard from "../components/CitationSourceLeaderboard";
import type { CitationLinksSourceStat } from "../types";

const PROVIDER_OPTIONS = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "google", label: "Google" },
];

const LIMIT_OPTIONS = [
	{ value: 10, label: "Top 10" },
	{ value: 25, label: "Top 25" },
	{ value: 50, label: "Top 50" },
	{ value: 500, label: "All" },
];

const CHART_FONT = "'Inter', system-ui, sans-serif";

const TOOLTIP_BASE: Highcharts.TooltipOptions = {
	backgroundColor: "#FFFFFF",
	borderColor: "#DDD0BC",
	borderRadius: 8,
	shadow: { color: "rgba(42,58,44,0.08)", offsetX: 0, offsetY: 2, opacity: 1, width: 8 },
	style: { fontFamily: CHART_FONT, fontSize: "12px", color: "#2A3A2C" },
	padding: 10,
};

// Greenish palette for bars
const BAR_COLORS = [
	"#4A8C50", "#5C9E62", "#6EAF74", "#7FBF85",
	"#90CF96", "#A1DFA6", "#8FBB93", "#7AAF7E",
	"#6A9F6E", "#5A8F5E", "#4A7F4E", "#3A6F3E",
	"#2A5F2E", "#1A4F1E", "#0A3F0E",
];

const PROVIDER_COLORS: Record<string, string> = {
	openai: "#74AA9C",
	anthropic: "#C8A87A",
	google: "#7A9EC8",
};

function formatRunLabel(
	runMonth: string | null,
	createdAt: string | null,
	webSearch: boolean | null,
): string {
	const base =
		runMonth ??
		(createdAt
			? new Date(createdAt).toLocaleDateString(undefined, {
					month: "short",
					year: "numeric",
				})
			: "Unknown");
	return webSearch ? `${base} · web` : base;
}

function StatCard({
	label,
	value,
	sub,
}: {
	label: string;
	value: string | number;
	sub?: string;
}) {
	return (
		<div
			className="rounded-xl border p-5"
			style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
		>
			<div
				className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
				style={{ color: "#9AAE9C" }}
			>
				{label}
			</div>
			<div
				className="text-2xl font-bold tabular-nums"
				style={{ color: "#2A3A2C" }}
			>
				{typeof value === "number" ? value.toLocaleString() : value}
			</div>
			{sub && (
				<div className="text-xs mt-1" style={{ color: "#B0A898" }}>
					{sub}
				</div>
			)}
		</div>
	);
}

function TopSourcesChart({ sources, limit }: { sources: CitationLinksSourceStat[]; limit: number }) {
	const chartLimit = Math.min(limit === 500 ? 20 : limit, 20);
	// Sort descending, then reverse so highest appears at top of horizontal bar chart
	const sorted = [...sources].sort((a, b) => b.citationCount - a.citationCount).slice(0, chartLimit);
	const rows = [...sorted].reverse();

	const options = useMemo((): Highcharts.Options => ({
		chart: {
			type: "bar",
			backgroundColor: "#FFFFFF",
			style: { fontFamily: CHART_FONT },
			height: Math.max(260, rows.length * 36 + 60),
			marginTop: 16,
			marginRight: 56,
			marginBottom: 40,
			animation: { duration: 500 },
		},
		title: { text: undefined },
		credits: { enabled: false },
		xAxis: {
			categories: rows.map((r) =>
				r.host.length > 36 ? r.host.slice(0, 35) + "…" : r.host,
			),
			lineColor: "#F2EDE6",
			tickColor: "transparent",
			labels: {
				style: { fontSize: "11px", color: "#5A7060", fontFamily: CHART_FONT },
				align: "right",
			},
		},
		yAxis: {
			title: { text: null },
			gridLineColor: "#F2EDE6",
			allowDecimals: false,
			labels: {
				enabled: true,
				style: { fontSize: "10px", color: "#9AAE9C", fontFamily: CHART_FONT },
			},
		},
		legend: { enabled: false },
		tooltip: {
			...TOOLTIP_BASE,
			formatter() {
				const src = sorted[sorted.length - 1 - (this.point.index ?? 0)];
				return `<b>${src?.host ?? this.x}</b><br/>
					Citations: <b>${this.y?.toLocaleString()}</b><br/>
					Outputs: ${src?.responseCount.toLocaleString() ?? "–"}<br/>
					${src?.providers.length ? `Providers: ${src.providers.join(", ")}` : ""}`;
			},
		},
		plotOptions: {
			bar: {
				borderRadius: 4,
				colorByPoint: true,
				colors: rows.map((_, i) => {
					const pct = i / Math.max(rows.length - 1, 1);
					const h = 130;
					const s = 35 + pct * 20;
					const l = 65 - pct * 28;
					return `hsl(${h},${s}%,${l}%)`;
				}),
				dataLabels: {
					enabled: true,
					format: "{y}",
					style: { fontSize: "10px", color: "#5A7060", fontWeight: "600", textOutline: "none" },
					inside: false,
					align: "left",
				},
			},
		},
		series: [
			{
				type: "bar",
				data: rows.map((r) => r.citationCount),
				name: "Citations",
			},
		],
	}), [rows, sorted]);

	return (
		<div
			className="rounded-xl border"
			style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
		>
			<div className="px-4 py-3" style={{ borderBottom: "1px solid #F2EDE6" }}>
				<div className="text-sm font-semibold" style={{ color: "#2A3A2C" }}>
					Top Sources by Citations
				</div>
				<div className="text-xs mt-0.5" style={{ color: "#9AAE9C" }}>
					Showing top {rows.length} domains
				</div>
			</div>
			<div className="px-2 pt-2 pb-1">
				<HighchartsReact highcharts={Highcharts} options={options} />
			</div>
		</div>
	);
}

function ProviderCoverageChart({
	sources,
	totalResponses,
	responsesWithCitations,
}: {
	sources: CitationLinksSourceStat[];
	totalResponses: number;
	responsesWithCitations: number;
}) {
	// Count sources per provider
	const providerCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const src of sources) {
			for (const p of src.providers) {
				counts[p] = (counts[p] ?? 0) + src.citationCount;
			}
		}
		return counts;
	}, [sources]);

	const pieData = Object.entries(providerCounts)
		.sort(([, a], [, b]) => b - a)
		.map(([name, y]) => ({
			name: name.charAt(0).toUpperCase() + name.slice(1),
			y,
			color: PROVIDER_COLORS[name] ?? "#C8C8C8",
		}));

	const donutOptions = useMemo((): Highcharts.Options => ({
		chart: {
			type: "pie",
			backgroundColor: "#FFFFFF",
			style: { fontFamily: CHART_FONT },
			height: 200,
			margin: [8, 8, 8, 8],
			animation: { duration: 600 },
		},
		title: { text: undefined },
		credits: { enabled: false },
		tooltip: {
			...TOOLTIP_BASE,
			pointFormat: "<b>{point.y}</b> citations ({point.percentage:.0f}%)",
		},
		plotOptions: {
			pie: {
				innerSize: "58%",
				borderWidth: 2,
				borderColor: "#FFFFFF",
				dataLabels: {
					enabled: true,
					format: "{point.name}",
					style: { fontSize: "11px", color: "#5A7060", fontWeight: "600", textOutline: "none" },
					distance: 14,
				},
			},
		},
		series: [{ type: "pie", data: pieData, name: "Citations" }],
	}), [pieData]);

	const citePct = totalResponses > 0
		? Math.round((responsesWithCitations / totalResponses) * 100)
		: 0;

	const coverageOptions = useMemo((): Highcharts.Options => ({
		chart: {
			type: "pie",
			backgroundColor: "#FFFFFF",
			style: { fontFamily: CHART_FONT },
			height: 200,
			margin: [8, 8, 8, 8],
			animation: { duration: 600 },
		},
		title: { text: undefined },
		credits: { enabled: false },
		tooltip: {
			...TOOLTIP_BASE,
			pointFormat: "<b>{point.y}</b> responses ({point.percentage:.0f}%)",
		},
		plotOptions: {
			pie: {
				innerSize: "58%",
				borderWidth: 2,
				borderColor: "#FFFFFF",
				dataLabels: {
					enabled: false,
				},
			},
		},
		series: [{
			type: "pie",
			name: "Responses",
			data: [
				{ name: "With citations", y: responsesWithCitations, color: "#4A8C50" },
				{ name: "Without", y: totalResponses - responsesWithCitations, color: "#E8E4DC" },
			],
		}],
	}), [responsesWithCitations, totalResponses]);

	return (
		<div className="grid grid-cols-2 gap-4">
			{/* Provider share */}
			{pieData.length > 0 && (
				<div
					className="rounded-xl border"
					style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
				>
					<div className="px-4 py-3" style={{ borderBottom: "1px solid #F2EDE6" }}>
						<div className="text-sm font-semibold" style={{ color: "#2A3A2C" }}>
							Citations by Provider
						</div>
						<div className="text-xs mt-0.5" style={{ color: "#9AAE9C" }}>
							Total citation volume per LLM
						</div>
					</div>
					<div className="px-2 pt-1 pb-2">
						<HighchartsReact highcharts={Highcharts} options={donutOptions} />
					</div>
				</div>
			)}

			{/* Coverage */}
			<div
				className="rounded-xl border"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div className="px-4 py-3" style={{ borderBottom: "1px solid #F2EDE6" }}>
					<div className="text-sm font-semibold" style={{ color: "#2A3A2C" }}>
						Citation Coverage
					</div>
					<div className="text-xs mt-0.5" style={{ color: "#9AAE9C" }}>
						{citePct}% of responses include at least one citation
					</div>
				</div>
				<div className="px-2 pt-1 pb-2 flex items-center justify-center">
					<div className="relative">
						<HighchartsReact highcharts={Highcharts} options={coverageOptions} />
						<div
							className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
							style={{ top: 8, bottom: 8 }}
						>
							<span className="text-2xl font-bold" style={{ color: "#2A3A2C" }}>
								{citePct}%
							</span>
							<span className="text-[10px]" style={{ color: "#9AAE9C" }}>cited</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function CitationLinks() {
	const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
		undefined,
	);
	const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
	const [limit, setLimit] = useState(25);
	const [domainFilter, setDomainFilter] = useState<"all" | "internal" | "external">("all");

	const query = useQuery({
		queryKey: ["citation-links", selectedRunId, selectedProviders],
		queryFn: () =>
			api.citationLinks({ runId: selectedRunId, providers: selectedProviders }),
		staleTime: 2 * 60 * 1000,
	});

	const data = query.data;

	const isInternal = (host: string) => host === "highcharts.com" || host.endsWith(".highcharts.com");

	const filteredSources = useMemo((): CitationLinksSourceStat[] => {
		const sources = data?.sources ?? [];
		if (domainFilter === "internal") return sources.filter((s) => isInternal(s.host));
		if (domainFilter === "external") return sources.filter((s) => !isInternal(s.host));
		return sources;
	}, [data, domainFilter]);

	const avgCitationsPerCited = useMemo(() => {
		if (!data || data.responsesWithCitations === 0) return 0;
		return Number(
			(data.totalCitations / data.responsesWithCitations).toFixed(1),
		);
	}, [data]);

	const citationDomainSplit = useMemo(() => {
		const sources = data?.sources ?? [];
		const internal = sources.filter((s) => isInternal(s.host));
		const external = sources.filter((s) => !isInternal(s.host));
		return {
			internal,
			external,
			internalCitations: internal.reduce((sum, s) => sum + s.citationCount, 0),
			externalCitations: external.reduce((sum, s) => sum + s.citationCount, 0),
		};
	}, [data]);

	function toggleProvider(value: string) {
		setSelectedProviders((prev) =>
			prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
		);
		setSelectedRunId((id) => id);
	}

	const availableRuns = data?.availableRuns ?? [];
	const currentRunId = data?.runId ?? null;

	return (
		<div className="max-w-[1360px] space-y-5">
			{/* Header */}
			<div className="flex items-end justify-between">
				<div>
					<h1
						className="text-xl font-bold tracking-tight"
						style={{ color: "#2A3A2C" }}
					>
						Citation Links
					</h1>
					<p className="text-sm mt-0.5" style={{ color: "#9AAE9C" }}>
						Sources cited by LLMs across benchmark responses
					</p>
				</div>
			</div>

			{/* Controls */}
			<div className="flex flex-wrap items-center gap-3">
				{availableRuns.length > 0 && (
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium" style={{ color: "#7A8E7C" }}>
							Run
						</span>
						<select
							className="text-xs rounded-lg px-2.5 py-1.5 border font-medium"
							style={{
								background: "#FFFFFF",
								borderColor: "#DDD0BC",
								color: "#2A3A2C",
								outline: "none",
							}}
							value={currentRunId ?? ""}
							onChange={(e) => setSelectedRunId(e.target.value || undefined)}
						>
							{availableRuns.map((run) => (
								<option key={run.id} value={run.id}>
									{formatRunLabel(
										run.runMonth,
										run.createdAt,
										run.webSearchEnabled,
									)}
								</option>
							))}
						</select>
					</div>
				)}

				<div className="flex items-center gap-1.5">
					<span
						className="text-xs font-medium mr-1"
						style={{ color: "#7A8E7C" }}
					>
						Provider
					</span>
					<button
						type="button"
						className="text-xs px-2.5 py-1 rounded-full border font-medium transition-colors"
						style={{
							background: selectedProviders.length === 0 ? "#2A5C2E" : "#FFFFFF",
							borderColor: selectedProviders.length === 0 ? "#2A5C2E" : "#DDD0BC",
							color: selectedProviders.length === 0 ? "#FFFFFF" : "#5A7060",
						}}
						onClick={() => setSelectedProviders([])}
					>
						All
					</button>
					{PROVIDER_OPTIONS.map((opt) => {
						const active = selectedProviders.includes(opt.value);
						return (
							<button
								type="button"
								key={opt.value}
								className="text-xs px-2.5 py-1 rounded-full border font-medium transition-colors"
								style={{
									background: active ? "#2A5C2E" : "#FFFFFF",
									borderColor: active ? "#2A5C2E" : "#DDD0BC",
									color: active ? "#FFFFFF" : "#5A7060",
								}}
								onClick={() => toggleProvider(opt.value)}
							>
								{opt.label}
							</button>
						);
					})}
				</div>

				<div className="flex items-center gap-1.5">
				<span className="text-xs font-medium mr-1" style={{ color: "#7A8E7C" }}>Domain</span>
				{(["all", "internal", "external"] as const).map((opt) => (
					<button
						key={opt}
						type="button"
						className="text-xs px-2.5 py-1 rounded-full border font-medium transition-colors capitalize"
						style={{
							background: domainFilter === opt ? "#2A5C2E" : "#FFFFFF",
							borderColor: domainFilter === opt ? "#2A5C2E" : "#DDD0BC",
							color: domainFilter === opt ? "#FFFFFF" : "#5A7060",
						}}
						onClick={() => setDomainFilter(opt)}
					>
						{opt === "internal" ? "Highcharts.com" : opt === "external" ? "External" : "All"}
					</button>
				))}
			</div>

			<div className="flex items-center gap-2 ml-auto">
					<span className="text-xs font-medium" style={{ color: "#7A8E7C" }}>
						Show
					</span>
					<div className="flex gap-1">
						{LIMIT_OPTIONS.map((opt) => (
							<button
								type="button"
								key={opt.value}
								className="text-xs px-2.5 py-1 rounded-full border font-medium"
								style={{
									background: limit === opt.value ? "#2A5C2E" : "#FFFFFF",
									borderColor: limit === opt.value ? "#2A5C2E" : "#DDD0BC",
									color: limit === opt.value ? "#FFFFFF" : "#5A7060",
								}}
								onClick={() => setLimit(opt.value)}
							>
								{opt.label}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Loading / error */}
			{query.isLoading && (
				<div
					className="rounded-xl border p-6 text-sm text-center"
					style={{ background: "#FFFFFF", borderColor: "#DDD0BC", color: "#9AAE9C" }}
				>
					Loading citation data…
				</div>
			)}

			{query.isError && (
				<div
					className="rounded-xl border p-6 text-sm"
					style={{ background: "#FFF8F5", borderColor: "#F0D4A8", color: "#8A5A21" }}
				>
					{String(
						query.error instanceof Error ? query.error.message : query.error,
					)}
				</div>
			)}

			{data && (
				<>
					{/* Stat cards */}
					<div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
						<StatCard
							label="Total Citations"
							value={data.totalCitations}
							sub={`across ${data.totalResponses.toLocaleString()} responses`}
						/>
						<StatCard
							label="Unique Sources"
							value={data.uniqueSources}
							sub="distinct domains cited"
						/>
						<StatCard
							label="Responses with Citations"
							value={data.responsesWithCitations}
							sub={
								data.totalResponses > 0
									? `${((data.responsesWithCitations / data.totalResponses) * 100).toFixed(0)}% of total`
									: undefined
							}
						/>
						<StatCard
							label="Avg Citations / Response"
							value={avgCitationsPerCited}
							sub="among cited responses"
						/>
					</div>

					{/* Internal vs external split */}
					<div className="rounded-2xl border overflow-hidden" style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}>
						<div className="px-4 py-3 border-b" style={{ borderColor: "#EDE7DC", background: "#FDFCF9" }}>
							<div className="text-sm font-semibold" style={{ color: "#3A4D3C" }}>Internal vs external sources</div>
							<div className="text-xs mt-0.5" style={{ color: "#9AAE9C" }}>Highcharts.com properties vs third-party domains</div>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: "#EDE7DC" }}>
							<div className="p-4">
								<div className="flex items-center gap-2 mb-3">
									<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#4A8C50" }} />
									<span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#4A8C50" }}>Highcharts.com</span>
									<span className="ml-auto text-xs font-semibold tabular-nums" style={{ color: "#4A5E4C" }}>
										{citationDomainSplit.internalCitations.toLocaleString()} citations
									</span>
								</div>
								{citationDomainSplit.internal.slice(0, 8).map((s, i) => (
									<div key={s.key} className="flex items-center gap-2 py-1.5" style={{ borderTop: i === 0 ? "none" : "1px solid #F0EBE2" }}>
										<span className="flex-1 text-[12px] truncate" style={{ color: "#3A4D3C" }}>{s.host}{s.title && s.title !== s.host ? ` · ${s.title}` : ""}</span>
										<span className="text-[11px] tabular-nums font-medium flex-shrink-0" style={{ color: "#8A9B8C" }}>{s.citationCount}</span>
									</div>
								))}
								{citationDomainSplit.internal.length === 0 && (
									<p className="text-xs" style={{ color: "#B5C4B7" }}>No internal citations in this run</p>
								)}
							</div>
							<div className="p-4">
								<div className="flex items-center gap-2 mb-3">
									<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#C7A456" }} />
									<span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9A7A30" }}>External domains</span>
									<span className="ml-auto text-xs font-semibold tabular-nums" style={{ color: "#4A5E4C" }}>
										{citationDomainSplit.externalCitations.toLocaleString()} citations
									</span>
								</div>
								{citationDomainSplit.external.slice(0, 8).map((s, i) => (
									<div key={s.key} className="flex items-center gap-2 py-1.5" style={{ borderTop: i === 0 ? "none" : "1px solid #F0EBE2" }}>
										<span className="flex-1 text-[12px] truncate" style={{ color: "#3A4D3C" }}>{s.host}</span>
										<span className="text-[11px] tabular-nums font-medium flex-shrink-0" style={{ color: "#8A9B8C" }}>{s.citationCount}</span>
									</div>
								))}
								{citationDomainSplit.external.length === 0 && (
									<p className="text-xs" style={{ color: "#B5C4B7" }}>No external citations in this run</p>
								)}
							</div>
						</div>
					</div>

										{filteredSources.length > 0 && (
						<>
							{/* Charts row */}
							{filteredSources.length > 0 && (
								<ProviderCoverageChart
									sources={filteredSources}
									totalResponses={data.totalResponses}
									responsesWithCitations={data.responsesWithCitations}
								/>
							)}

							{/* Top sources bar chart */}
							<TopSourcesChart sources={filteredSources} limit={limit} />

							{/* Leaderboard table */}
							<CitationSourceLeaderboard
								items={filteredSources}
								title="Most Cited Sources"
								subtitle={`${data.runMonth ?? "Latest run"} · ${data.uniqueSources.toLocaleString()} unique domains · ${data.totalCitations.toLocaleString()} total citations`}
								limit={limit}
							/>
						</>
					)}

					{filteredSources.length === 0 && (
						<div
							className="rounded-xl border p-8 text-sm text-center"
							style={{ background: "#FFFFFF", borderColor: "#DDD0BC", color: "#9AAE9C" }}
						>
							No citation sources found for this run.
						</div>
					)}
				</>
			)}
		</div>
	);
}
