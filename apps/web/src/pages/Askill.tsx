import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { api } from "../api";
import type { AskillUrlStat } from "../types";

const PROVIDER_OPTIONS = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "google", label: "Google" },
];

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

function ProviderPill({ provider }: { provider: string }) {
	const colors: Record<string, { bg: string; text: string; border: string }> = {
		openai: { bg: "#EEF4FF", text: "#315B92", border: "#CCD9F0" },
		anthropic: { bg: "#F4F0FF", text: "#69459C", border: "#DACCF0" },
		google: { bg: "#FEF6E7", text: "#8C5E0F", border: "#F0DFB0" },
		"chatgpt-web": { bg: "#EEF4FF", text: "#315B92", border: "#CCD9F0" },
	};
	const c = colors[provider] ?? {
		bg: "#F2EDE6",
		text: "#6C7C6E",
		border: "#DDD0BC",
	};
	return (
		<span
			className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
			style={{
				background: c.bg,
				color: c.text,
				border: `1px solid ${c.border}`,
			}}
		>
			{provider}
		</span>
	);
}

function UrlTable({ rows }: { rows: AskillUrlStat[] }) {
	if (rows.length === 0) {
		return (
			<div
				className="rounded-xl border px-5 py-8 text-sm text-center"
				style={{
					background: "#FDFCF8",
					borderColor: "#E4D8C8",
					color: "#8A9B8C",
				}}
			>
				No citation URLs found for this selection.
			</div>
		);
	}

	return (
		<div
			className="rounded-2xl border overflow-hidden"
			style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
		>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[700px] border-collapse">
					<thead>
						<tr
							style={{
								background: "#FDFCF8",
								borderBottom: "1px solid #EEE5D8",
							}}
						>
							<th
								className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider w-8"
								style={{ color: "#8A9B8C" }}
							>
								#
							</th>
							<th
								className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider"
								style={{ color: "#8A9B8C" }}
							>
								URL
							</th>
							<th
								className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider"
								style={{ color: "#8A9B8C" }}
							>
								Citations
							</th>
							<th
								className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider"
								style={{ color: "#8A9B8C" }}
							>
								Responses
							</th>
							<th
								className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider"
								style={{ color: "#8A9B8C" }}
							>
								Providers
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => (
							<tr
								key={row.url}
								className="group"
								style={{
									borderBottom:
										index < rows.length - 1 ? "1px solid #F2EDE6" : "none",
									background: index % 2 === 1 ? "#FDFCF8" : "#FFFFFF",
								}}
							>
								{/* Rank */}
								<td
									className="px-4 py-3 text-sm tabular-nums align-top"
									style={{ color: "#BFAE98" }}
								>
									{index + 1}
								</td>

								{/* URL cell */}
								<td className="px-4 py-3 align-top max-w-[520px]">
									{row.title &&
										row.title !== row.url &&
										row.title !== row.host && (
											<div
												className="text-xs font-semibold mb-0.5 truncate"
												style={{ color: "#364D38" }}
												title={row.title}
											>
												{row.title}
											</div>
										)}
									<a
										href={row.url}
										target="_blank"
										rel="noreferrer"
										className="block text-sm font-medium break-all leading-snug hover:underline"
										style={{ color: "#2A5C2E" }}
										title={row.url}
									>
										{row.url}
									</a>
									<div
										className="text-[10px] mt-0.5"
										style={{ color: "#9AAE9C" }}
									>
										{row.host}
									</div>
								</td>

								{/* Citations */}
								<td
									className="px-4 py-3 text-right text-sm font-bold tabular-nums align-top"
									style={{ color: "#2A3A2C" }}
								>
									{row.citationCount}
								</td>

								{/* Responses */}
								<td
									className="px-4 py-3 text-right text-sm tabular-nums align-top"
									style={{ color: "#5A7060" }}
								>
									{row.responseCount}
								</td>

								{/* Providers */}
								<td className="px-4 py-3 align-top">
									<div className="flex flex-wrap gap-1">
										{row.providers.map((p) => (
											<ProviderPill key={p} provider={p} />
										))}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default function Askill() {
	const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
		undefined,
	);
	const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search);

	const query = useQuery({
		queryKey: ["askill", selectedRunId, selectedProviders],
		queryFn: () =>
			api.askill({ runId: selectedRunId, providers: selectedProviders }),
		staleTime: 2 * 60 * 1000,
	});

	const data = query.data;

	const filteredUrls = useMemo((): AskillUrlStat[] => {
		const q = deferredSearch.trim().toLowerCase();
		if (!data) return [];
		if (!q) return data.urls;
		return data.urls.filter(
			(u) =>
				u.url.toLowerCase().includes(q) ||
				u.title.toLowerCase().includes(q) ||
				u.host.toLowerCase().includes(q),
		);
	}, [data, deferredSearch]);

	function toggleProvider(value: string) {
		setSelectedProviders((prev) =>
			prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
		);
	}

	const availableRuns = data?.availableRuns ?? [];
	const currentRunId = data?.runId ?? null;

	return (
		<div className="max-w-[1200px] space-y-5">
			{/* Page header */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1
						className="text-xl font-bold tracking-tight"
						style={{ color: "#2A3A2C" }}
					>
						Askill
					</h1>
					<p className="text-sm mt-0.5" style={{ color: "#7A8E7C" }}>
						Every citation URL the LLMs used in responses that mentioned{" "}
						{data?.highchartsName ?? "Highcharts"}
					</p>
				</div>

				{/* Run selector */}
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
			</div>

			{/* Loading / error */}
			{query.isLoading && (
				<div
					className="rounded-xl border p-6 text-sm text-center"
					style={{
						background: "#FFFFFF",
						borderColor: "#DDD0BC",
						color: "#9AAE9C",
					}}
				>
					Loading citation data…
				</div>
			)}
			{query.isError && (
				<div
					className="rounded-xl border p-6 text-sm"
					style={{
						background: "#FFF8F5",
						borderColor: "#F0D4A8",
						color: "#8A5A21",
					}}
				>
					{String(
						query.error instanceof Error ? query.error.message : query.error,
					)}
				</div>
			)}

			{data && (
				<>
					{/* Overview stat strip */}
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						{[
							{
								label: "HC Mention Rate",
								value: `${data.mentionRatePct}%`,
								sub: `${data.highchartsMentions.toLocaleString()} / ${data.totalResponses.toLocaleString()} responses`,
								accent: true,
							},
							{
								label: "Total Citations",
								value: data.totalCitations.toLocaleString(),
								sub: "from HC-mentioned responses",
							},
							{
								label: "Unique URLs",
								value: data.uniqueUrls.toLocaleString(),
								sub: "distinct pages cited",
							},
							{
								label: "Unique Domains",
								value: data.uniqueDomains.toLocaleString(),
								sub: "distinct domains cited",
							},
						].map((card) => (
							<div
								key={card.label}
								className="rounded-2xl border p-4"
								style={{
									background: card.accent
										? "linear-gradient(135deg, #2F4F34 0%, #3E6643 100%)"
										: "#FFFFFF",
									borderColor: card.accent ? "#2F4F34" : "#DDD0BC",
									boxShadow: card.accent
										? "0 6px 20px rgba(47,79,52,0.2)"
										: "0 2px 6px rgba(42,58,44,0.04)",
								}}
							>
								<div
									className="text-[10px] font-semibold uppercase tracking-widest mb-1"
									style={{
										color: card.accent ? "rgba(255,255,255,0.6)" : "#9AAE9C",
									}}
								>
									{card.label}
								</div>
								<div
									className="text-2xl font-bold tabular-nums"
									style={{ color: card.accent ? "#FDFCF8" : "#2A3A2C" }}
								>
									{card.value}
								</div>
								<div
									className="text-xs mt-0.5"
									style={{
										color: card.accent ? "rgba(255,255,255,0.5)" : "#B0A898",
									}}
								>
									{card.sub}
								</div>
							</div>
						))}
					</div>

					{/* Filter bar */}
					<div
						className="rounded-2xl border px-4 py-3 flex flex-wrap items-center gap-4"
						style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
					>
						{/* Search */}
						<div className="relative flex-1 min-w-[180px]">
							<input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Filter by URL or domain…"
								className="w-full rounded-xl px-3 py-2 text-sm"
								style={{
									border: "1px solid #DDD0BC",
									background: "#FDFBF7",
									color: "#2A3A2C",
									outline: "none",
								}}
							/>
						</div>

						{/* Provider filter */}
						<div className="flex items-center gap-1.5 flex-shrink-0">
							<span
								className="text-xs font-medium mr-0.5"
								style={{ color: "#7A8E7C" }}
							>
								Provider
							</span>
							<button
								type="button"
								className="text-xs px-2.5 py-1 rounded-full border font-medium transition-colors"
								style={{
									background:
										selectedProviders.length === 0 ? "#2A5C2E" : "#FFFFFF",
									borderColor:
										selectedProviders.length === 0 ? "#2A5C2E" : "#DDD0BC",
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

						<div
							className="ml-auto text-xs font-medium"
							style={{ color: "#9AAE9C" }}
						>
							{filteredUrls.length.toLocaleString()} URL
							{filteredUrls.length !== 1 ? "s" : ""}
							{search.trim() ? " matching" : " total"}
						</div>
					</div>

					{/* URL table — the main focus */}
					<UrlTable rows={filteredUrls} />

					{/* Per-query summary — compact secondary section */}
					{data.queries.length > 0 && (
						<details
							className="rounded-2xl border overflow-hidden"
							style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
						>
							<summary
								className="px-5 py-3 cursor-pointer text-sm font-semibold select-none flex items-center justify-between"
								style={{ color: "#2A3A2C", listStyle: "none" }}
							>
								<span>Per-query HC mention breakdown</span>
								<span
									className="text-xs font-normal"
									style={{ color: "#9AAE9C" }}
								>
									{data.queries.length} queries
								</span>
							</summary>
							<div
								className="border-t overflow-x-auto"
								style={{ borderColor: "#F2EDE6" }}
							>
								<table className="w-full min-w-[560px] border-collapse">
									<thead>
										<tr
											style={{
												background: "#FDFCF8",
												borderBottom: "1px solid #EEE5D8",
											}}
										>
											<th
												className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider"
												style={{ color: "#8A9B8C" }}
											>
												Query
											</th>
											<th
												className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider"
												style={{ color: "#8A9B8C" }}
											>
												Responses
											</th>
											<th
												className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider"
												style={{ color: "#8A9B8C" }}
											>
												HC Mentions
											</th>
											<th
												className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider"
												style={{ color: "#8A9B8C" }}
											>
												Mention %
											</th>
											<th
												className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider"
												style={{ color: "#8A9B8C" }}
											>
												Citations
											</th>
											<th
												className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider"
												style={{ color: "#8A9B8C" }}
											>
												URLs
											</th>
										</tr>
									</thead>
									<tbody>
										{data.queries.map((q, index) => (
											<tr
												key={q.queryId}
												style={{
													borderBottom:
														index < data.queries.length - 1
															? "1px solid #F2EDE6"
															: "none",
													background: index % 2 === 1 ? "#FDFCF8" : "#FFFFFF",
												}}
											>
												<td
													className="px-4 py-2.5 text-sm max-w-xs"
													style={{ color: "#2A3A2C" }}
												>
													{q.queryText}
												</td>
												<td
													className="px-4 py-2.5 text-right text-sm tabular-nums"
													style={{ color: "#5A7060" }}
												>
													{q.responseCount}
												</td>
												<td
													className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums"
													style={{ color: "#2A3A2C" }}
												>
													{q.mentionCount}
												</td>
												<td
													className="px-4 py-2.5 text-right text-sm tabular-nums"
													style={{
														color:
															q.mentionRatePct >= 75
																? "#2F6633"
																: q.mentionRatePct >= 40
																	? "#8C6B17"
																	: "#9C4A3A",
														fontWeight: 600,
													}}
												>
													{q.mentionRatePct}%
												</td>
												<td
													className="px-4 py-2.5 text-right text-sm tabular-nums"
													style={{ color: "#5A7060" }}
												>
													{q.totalCitations > 0 ? q.totalCitations : "—"}
												</td>
												<td
													className="px-4 py-2.5 text-right text-sm tabular-nums"
													style={{ color: "#5A7060" }}
												>
													{q.uniqueSources > 0 ? q.uniqueSources : "—"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</details>
					)}
				</>
			)}
		</div>
	);
}
