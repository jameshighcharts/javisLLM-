import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { BenchmarkRunCostItem, UnderTheHoodRange } from "../types";
import {
	calculateTokenCostUsd,
	formatUsd,
	formatUsdPerMillion,
	getResolvedModelPricing,
} from "../utils/modelPricing";

const RANGE_OPTIONS: Array<{ value: UnderTheHoodRange; label: string }> = [
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
	{ value: "all", label: "All time" },
];

function formatInteger(value: number): string {
	return Math.max(0, Math.round(value)).toLocaleString();
}

function formatPercent(value: number): string {
	return `${Math.round(Math.max(0, value) * 100)}%`;
}

function formatTimestamp(value: string | null): string {
	if (!value) return "n/a";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "n/a";
	return parsed.toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function shortModelName(model: string): string {
	return model
		.replace(/^claude-/, "")
		.replace(/^gemini-/, "gemini-")
		.replace(/-\d{8}$/, "")
		.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function rangeButtonStyle(active: boolean) {
	return {
		background: active ? "#2A6032" : "#FFFFFF",
		color: active ? "#FFFFFF" : "#5D725F",
		border: `1px solid ${active ? "#1E4A26" : "#DDD0BC"}`,
		boxShadow: active ? "0 12px 30px rgba(42, 96, 50, 0.16)" : "none",
	};
}

function SummaryCard({
	label,
	value,
	help,
	tone = "default",
}: {
	label: string;
	value: string;
	help?: string;
	tone?: "default" | "accent";
}) {
	return (
		<div
			className="rounded-2xl border px-4 py-4 flex flex-col gap-1.5"
			style={{
				background: "#FFFFFF",
				borderColor: tone === "accent" ? "#C8DEC9" : "#E7DED0",
			}}
		>
			<div
				style={{
					fontSize: 10,
					fontWeight: 700,
					letterSpacing: "0.1em",
					textTransform: "uppercase",
					color: "#9FB0A2",
				}}
			>
				{label}
			</div>
			<div
				style={{
					fontSize: 28,
					fontWeight: 800,
					letterSpacing: "-0.03em",
					lineHeight: 1,
					color: tone === "accent" ? "#214E27" : "#1E2E20",
					fontVariantNumeric: "tabular-nums",
				}}
			>
				{value}
			</div>
			{help ? (
				<div style={{ fontSize: 11, color: "#8FA191", lineHeight: 1.4 }}>
					{help}
				</div>
			) : null}
		</div>
	);
}

function SectionHeading({
	eyebrow,
	title,
	description,
}: {
	eyebrow: string;
	title: string;
	description: string;
}) {
	return (
		<div className="space-y-1.5">
			<div
				style={{
					fontSize: 10,
					fontWeight: 700,
					textTransform: "uppercase",
					letterSpacing: "0.12em",
					color: "#A8B8AA",
				}}
			>
				{eyebrow}
			</div>
			<div style={{ fontSize: 18, fontWeight: 700, color: "#1E2E20" }}>
				{title}
			</div>
			<div style={{ fontSize: 13, color: "#738576", lineHeight: 1.5 }}>
				{description}
			</div>
		</div>
	);
}

function RunScopeLabel(run: BenchmarkRunCostItem) {
	if (run.runKind === "cohort") {
		return run.cohortTag ? `Cohort: ${run.cohortTag}` : "Cohort";
	}
	return run.runMonth ? `Full: ${run.runMonth}` : "Ad hoc";
}

export default function Costs() {
	const [range, setRange] = useState<UnderTheHoodRange>("30d");

	const overviewQuery = useQuery({
		queryKey: ["costs-overview", range],
		queryFn: () => api.underTheHood(range),
		refetchInterval: 60_000,
		retry: false,
	});
	const recentRunsQuery = useQuery({
		queryKey: ["run-costs", "costs-page"],
		queryFn: () => api.runCosts(30),
		refetchInterval: 60_000,
		retry: false,
	});

	const modelRows = useMemo(() => {
		const stats = overviewQuery.data?.summary.modelStats ?? [];
		return stats
			.map((stat) => {
				const pricing = getResolvedModelPricing(stat.model);
				const costs = pricing
					? calculateTokenCostUsd(
							stat.totalInputTokens,
							stat.totalOutputTokens,
							pricing,
						)
					: null;
				return {
					...stat,
					pricing,
					costs,
				};
			})
			.sort(
				(left, right) =>
					(right.costs?.totalCostUsd ?? 0) - (left.costs?.totalCostUsd ?? 0),
			);
	}, [overviewQuery.data]);

	const totalEstimatedCostUsd = modelRows.reduce(
		(sum, row) => sum + (row.costs?.totalCostUsd ?? 0),
		0,
	);
	const totalInputCostUsd = modelRows.reduce(
		(sum, row) => sum + (row.costs?.inputCostUsd ?? 0),
		0,
	);
	const totalOutputCostUsd = modelRows.reduce(
		(sum, row) => sum + (row.costs?.outputCostUsd ?? 0),
		0,
	);
	const pricedResponseCount = modelRows.reduce(
		(sum, row) => sum + (row.costs ? row.responseCount : 0),
		0,
	);
	const topCost = modelRows[0]?.costs?.totalCostUsd ?? 0;
	const pricedModelCount = modelRows.filter((row) => row.pricing).length;
	const unpricedModels = modelRows.filter((row) => !row.pricing);
	const coverageRatio =
		overviewQuery.data?.summary.totalResponses && overviewQuery.data.summary.totalResponses > 0
			? pricedResponseCount / overviewQuery.data.summary.totalResponses
			: 0;
	const avgCostPerResponseUsd =
		pricedResponseCount > 0 ? totalEstimatedCostUsd / pricedResponseCount : 0;
	const avgCostPerPromptUsd =
		overviewQuery.data?.summary.queryCount && overviewQuery.data.summary.queryCount > 0
			? totalEstimatedCostUsd / overviewQuery.data.summary.queryCount
			: 0;
	const avgCostPerRunUsd =
		recentRunsQuery.data?.runCount && recentRunsQuery.data.runCount > 0
			? recentRunsQuery.data.totals.estimatedTotalCostUsd /
				recentRunsQuery.data.runCount
			: 0;

	const latestRuns = recentRunsQuery.data?.runs ?? [];
	const sparkRuns = latestRuns.slice(0, 8).reverse();
	const costliestRun = useMemo(() => {
		return latestRuns.reduce<BenchmarkRunCostItem | null>((largest, run) => {
			if (!largest) return run;
			return run.estimatedTotalCostUsd > largest.estimatedTotalCostUsd
				? run
				: largest;
		}, null);
	}, [latestRuns]);

	return (
		<div className="max-w-[1280px] space-y-4">
			<div
				className="rounded-[28px] border overflow-hidden"
				style={{
					background:
						"linear-gradient(135deg, rgba(247,243,235,1) 0%, rgba(255,255,255,1) 54%, rgba(239,247,240,1) 100%)",
					borderColor: "#DDD0BC",
				}}
			>
				<div className="px-6 py-6 md:px-7 md:py-7 flex flex-col gap-5">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div className="max-w-3xl space-y-2">
							<div
								style={{
									fontSize: 11,
									fontWeight: 800,
									textTransform: "uppercase",
									letterSpacing: "0.14em",
									color: "#7D937F",
								}}
							>
								Costs
							</div>
							<h1
								style={{
									fontSize: 34,
									lineHeight: 1,
									fontWeight: 800,
									letterSpacing: "-0.04em",
									color: "#19311D",
								}}
							>
								Benchmark spend, without digging through hidden pages
							</h1>
							<p
								style={{
									fontSize: 14,
									lineHeight: 1.6,
									color: "#5E735F",
									maxWidth: 760,
								}}
							>
								Estimated spend is derived from recorded token usage and the
								model pricing catalog in this repo. Use this page for the
								general overview, then jump into runs or prompt drilldown when
								you need detail.
							</p>
						</div>

						<div className="flex flex-wrap gap-2">
							{RANGE_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									onClick={() => setRange(option.value)}
									className="rounded-full px-3.5 py-2 text-sm font-semibold transition-all"
									style={rangeButtonStyle(range === option.value)}
								>
									{option.label}
								</button>
							))}
							<Link
								to="/runs"
								className="rounded-full px-3.5 py-2 text-sm font-semibold"
								style={{
									background: "#FFFFFF",
									border: "1px solid #DDD0BC",
									color: "#5D725F",
								}}
							>
								Runs
							</Link>
							<Link
								to="/prompt-drilldown"
								className="rounded-full px-3.5 py-2 text-sm font-semibold"
								style={{
									background: "#FFFFFF",
									border: "1px solid #DDD0BC",
									color: "#5D725F",
								}}
							>
								Prompt Drilldown
							</Link>
						</div>
					</div>

					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<SummaryCard
							label="Estimated Spend"
							value={formatUsd(totalEstimatedCostUsd)}
							help={
								overviewQuery.data
									? `${overviewQuery.data.rangeLabel} window`
									: "Waiting for analytics"
							}
							tone="accent"
						/>
						<SummaryCard
							label="Avg Cost / Response"
							value={formatUsd(avgCostPerResponseUsd)}
							help={`${formatInteger(pricedResponseCount)} priced responses`}
						/>
						<SummaryCard
							label="Avg Cost / Prompt"
							value={formatUsd(avgCostPerPromptUsd)}
							help={
								overviewQuery.data
									? `${formatInteger(overviewQuery.data.summary.queryCount)} tracked prompts`
									: "Prompt-level estimate"
							}
						/>
						<SummaryCard
							label="Avg Cost / Run"
							value={formatUsd(avgCostPerRunUsd)}
							help={
								recentRunsQuery.data
									? `Last ${recentRunsQuery.data.runCount} runs`
									: "Recent run ledger"
							}
						/>
					</div>
				</div>
			</div>

			{overviewQuery.isError ? (
				<div
					className="rounded-2xl border px-4 py-3 text-sm"
					style={{
						background: "#FFF7ED",
						borderColor: "#F0D4A8",
						color: "#8A5A21",
					}}
				>
					Unable to load the cost overview:{" "}
					{(overviewQuery.error as Error).message || "unknown error"}
				</div>
			) : null}
			{recentRunsQuery.isError ? (
				<div
					className="rounded-2xl border px-4 py-3 text-sm"
					style={{
						background: "#FFF7ED",
						borderColor: "#F0D4A8",
						color: "#8A5A21",
					}}
				>
					Unable to load recent run costs:{" "}
					{(recentRunsQuery.error as Error).message || "unknown error"}
				</div>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
				<div
					className="rounded-[24px] border p-5 space-y-4"
					style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
				>
					<SectionHeading
						eyebrow="Drivers"
						title="Top model cost drivers"
						description="Largest estimated contributors to spend in the selected analytics window."
					/>

					{overviewQuery.isLoading && modelRows.length === 0 ? (
						<div className="space-y-3">
							{Array.from({ length: 5 }).map((_, index) => (
								<div
									key={`model-skeleton-${index}`}
									className="h-14 rounded-2xl animate-pulse"
									style={{ background: "#F3EEE5" }}
								/>
							))}
						</div>
					) : modelRows.length === 0 ? (
						<div
							className="rounded-2xl border px-4 py-6 text-sm text-center"
							style={{
								background: "#FBF8F3",
								borderColor: "#EEE4D4",
								color: "#8A9A8C",
							}}
						>
							No model usage is available for this range yet.
						</div>
					) : (
						<div className="space-y-3">
							{modelRows.slice(0, 8).map((row) => {
								const ratio =
									topCost > 0 && row.costs
										? Math.max(8, Math.round((row.costs.totalCostUsd / topCost) * 100))
										: 0;
								return (
									<div
										key={row.model}
										className="rounded-2xl border p-4"
										style={{ background: "#FCFAF7", borderColor: "#ECE1D1" }}
									>
										<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
											<div className="min-w-0">
												<div
													className="truncate"
													style={{
														fontSize: 15,
														fontWeight: 700,
														color: "#1F2E21",
													}}
												>
													{shortModelName(row.model)}
												</div>
												<div
													className="flex flex-wrap items-center gap-x-3 gap-y-1"
													style={{ fontSize: 12, color: "#768878" }}
												>
													<span>{row.owner}</span>
													<span>{formatInteger(row.responseCount)} responses</span>
													<span>{formatInteger(row.totalTokens)} tokens</span>
												</div>
											</div>
											<div className="text-left sm:text-right">
												<div
													style={{
														fontSize: 22,
														fontWeight: 800,
														color: row.costs ? "#204F27" : "#8D5A20",
														fontVariantNumeric: "tabular-nums",
													}}
												>
													{row.costs ? formatUsd(row.costs.totalCostUsd) : "Unpriced"}
												</div>
												<div style={{ fontSize: 11, color: "#8A9A8C" }}>
													{row.pricing
														? `${formatUsdPerMillion(row.pricing.inputUsdPerMillion)} in · ${formatUsdPerMillion(row.pricing.outputUsdPerMillion)} out`
														: "Add model pricing to improve coverage"}
												</div>
											</div>
										</div>
										<div
											className="mt-3 h-2 rounded-full overflow-hidden"
											style={{ background: "#E8E0D2" }}
										>
											<div
												className="h-full rounded-full"
												style={{
													width: `${ratio}%`,
													background: row.costs
														? "linear-gradient(90deg, #8FBB93 0%, #2A6032 100%)"
														: "#D1A46E",
												}}
											/>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				<div className="space-y-4">
					<div
						className="rounded-[24px] border p-5 space-y-4"
						style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
					>
						<SectionHeading
							eyebrow="Coverage"
							title="Pricing coverage"
							description="How much of the observed usage can be priced from the repo catalog."
						/>
						<div className="grid grid-cols-2 gap-3">
							<SummaryCard
								label="Input Spend"
								value={formatUsd(totalInputCostUsd)}
							/>
							<SummaryCard
								label="Output Spend"
								value={formatUsd(totalOutputCostUsd)}
							/>
							<SummaryCard
								label="Priced Models"
								value={`${pricedModelCount}/${modelRows.length}`}
								help="Observed models with known rates"
							/>
							<SummaryCard
								label="Response Coverage"
								value={formatPercent(coverageRatio)}
								help={
									overviewQuery.data
										? `${formatInteger(pricedResponseCount)} of ${formatInteger(overviewQuery.data.summary.totalResponses)} responses`
										: "Coverage by response volume"
								}
							/>
						</div>

						<div
							className="rounded-2xl border p-4"
							style={{ background: "#FBF8F3", borderColor: "#ECE1D1" }}
						>
							<div
								className="flex items-center justify-between gap-3"
								style={{ fontSize: 13, fontWeight: 700, color: "#233426" }}
							>
								<span>Missing pricing</span>
								<span style={{ color: "#8A9A8C", fontWeight: 600 }}>
									{unpricedModels.length} models
								</span>
							</div>
							{unpricedModels.length > 0 ? (
								<div className="mt-3 flex flex-wrap gap-2">
									{unpricedModels.map((row) => (
										<span
											key={row.model}
											className="rounded-full px-2.5 py-1 text-xs font-semibold"
											style={{
												background: "#FFF4E5",
												border: "1px solid #F1D1A8",
												color: "#8A5A21",
											}}
										>
											{shortModelName(row.model)}
										</span>
									))}
								</div>
							) : (
								<div
									className="mt-3 text-sm"
									style={{ color: "#6E8370", lineHeight: 1.5 }}
								>
									Every observed model in this range maps to a known price.
								</div>
							)}
						</div>
					</div>

					<div
						className="rounded-[24px] border p-5 space-y-4"
						style={{ background: "#FBF4E8", borderColor: "#EDD8B4" }}
					>
						<SectionHeading
							eyebrow="Recent Runs"
							title="Run snapshot"
							description="Quick read on the current benchmark ledger."
						/>
						<div className="grid grid-cols-2 gap-3">
							<SummaryCard
								label="Ledger Total"
								value={formatUsd(
									recentRunsQuery.data?.totals.estimatedTotalCostUsd ?? 0,
								)}
								help={
									recentRunsQuery.data
										? `${recentRunsQuery.data.runCount} recent runs`
										: "Recent spend"
								}
							/>
							<SummaryCard
								label="Costliest Run"
								value={formatUsd(costliestRun?.estimatedTotalCostUsd ?? 0)}
								help={costliestRun ? RunScopeLabel(costliestRun) : "No runs"}
							/>
						</div>
						{sparkRuns.length > 0 ? (
							<div className="space-y-2">
								<div
									style={{
										fontSize: 11,
										fontWeight: 700,
										textTransform: "uppercase",
										letterSpacing: "0.1em",
										color: "#A08E73",
									}}
								>
									Cost trend
								</div>
								<div className="flex items-end gap-2 h-24">
									{sparkRuns.map((run) => {
										const maxCost =
											costliestRun?.estimatedTotalCostUsd && costliestRun.estimatedTotalCostUsd > 0
												? costliestRun.estimatedTotalCostUsd
												: 1;
										const height = Math.max(
											12,
											Math.round((run.estimatedTotalCostUsd / maxCost) * 100),
										);
										return (
											<div
												key={run.runId}
												className="flex-1 flex flex-col items-center gap-2 min-w-0"
											>
												<div
													className="w-full rounded-t-xl"
													style={{
														height: `${height}%`,
														background:
															"linear-gradient(180deg, #D7B07B 0%, #8EBA91 48%, #2A6032 100%)",
													}}
													title={`${RunScopeLabel(run)} · ${formatUsd(run.estimatedTotalCostUsd)}`}
												/>
												<div
													className="truncate w-full text-center"
													style={{ fontSize: 10, color: "#8A7B65" }}
												>
													{run.runMonth ?? shortModelName(run.runId)}
												</div>
											</div>
										);
									})}
								</div>
							</div>
						) : (
							<div className="text-sm" style={{ color: "#7D8E7F" }}>
								No recent run data is available yet.
							</div>
						)}
					</div>
				</div>
			</div>

			<div
				className="rounded-[24px] border overflow-hidden"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div className="px-5 py-4 border-b" style={{ borderColor: "#EEE5D8" }}>
					<SectionHeading
						eyebrow="Ledger"
						title="Recent benchmark runs"
						description="Run-level estimated spend, token volume, and pricing gaps."
					/>
				</div>

				{recentRunsQuery.isLoading && latestRuns.length === 0 ? (
					<div className="p-5 space-y-3">
						{Array.from({ length: 6 }).map((_, index) => (
							<div
								key={`run-skeleton-${index}`}
								className="h-16 rounded-2xl animate-pulse"
								style={{ background: "#F3EEE5" }}
							/>
						))}
					</div>
				) : latestRuns.length === 0 ? (
					<div
						className="px-5 py-8 text-center text-sm"
						style={{ color: "#839686" }}
					>
						No benchmark runs are available yet.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full text-sm">
							<thead style={{ background: "#FBF8F3" }}>
								<tr style={{ color: "#7C8F7E" }}>
									<th className="px-5 py-3 text-left font-semibold">Run</th>
									<th className="px-4 py-3 text-left font-semibold">Ended</th>
									<th className="px-4 py-3 text-right font-semibold">Prompts</th>
									<th className="px-4 py-3 text-right font-semibold">Responses</th>
									<th className="px-4 py-3 text-right font-semibold">Tokens</th>
									<th className="px-4 py-3 text-right font-semibold">Cost</th>
									<th className="px-5 py-3 text-left font-semibold">Notes</th>
								</tr>
							</thead>
							<tbody>
								{latestRuns.map((run) => (
									<tr
										key={run.runId}
										className="align-top"
										style={{ borderTop: "1px solid #F1EADE" }}
									>
										<td className="px-5 py-4">
											<div
												style={{
													fontWeight: 700,
													color: "#203123",
													fontSize: 14,
												}}
											>
												{RunScopeLabel(run)}
											</div>
											<div
												className="flex flex-wrap gap-x-3 gap-y-1"
												style={{ color: "#7C8F7E", fontSize: 12, marginTop: 4 }}
											>
												<span>{run.models.length} models</span>
												<span>
													{run.webSearchEnabled ? "Web search on" : "Web search off"}
												</span>
											</div>
										</td>
										<td className="px-4 py-4" style={{ color: "#607160" }}>
											{formatTimestamp(run.endedAt ?? run.createdAt)}
										</td>
										<td
											className="px-4 py-4 text-right"
											style={{ color: "#203123", fontVariantNumeric: "tabular-nums" }}
										>
											{formatInteger(run.uniquePrompts)}
										</td>
										<td
											className="px-4 py-4 text-right"
											style={{ color: "#203123", fontVariantNumeric: "tabular-nums" }}
										>
											{formatInteger(run.responseCount)}
										</td>
										<td
											className="px-4 py-4 text-right"
											style={{ color: "#203123", fontVariantNumeric: "tabular-nums" }}
										>
											{formatInteger(run.totalTokens)}
										</td>
										<td
											className="px-4 py-4 text-right"
											style={{
												color: "#214E27",
												fontWeight: 700,
												fontVariantNumeric: "tabular-nums",
											}}
										>
											{formatUsd(run.estimatedTotalCostUsd)}
										</td>
										<td className="px-5 py-4">
											<div className="flex flex-wrap gap-2">
												<span
													className="rounded-full px-2.5 py-1 text-xs font-semibold"
													style={{
														background: "#F2F7F2",
														border: "1px solid #D7E4D8",
														color: "#416446",
													}}
												>
													{formatInteger(run.pricedResponseCount)}/
													{formatInteger(run.responseCount)} priced
												</span>
												{run.unpricedModels.length > 0 ? (
													<span
														className="rounded-full px-2.5 py-1 text-xs font-semibold"
														style={{
															background: "#FFF4E5",
															border: "1px solid #F1D1A8",
															color: "#8A5A21",
														}}
													>
														Missing: {run.unpricedModels.join(", ")}
													</span>
												) : (
													<span
														className="rounded-full px-2.5 py-1 text-xs font-semibold"
														style={{
															background: "#F0F7F1",
															border: "1px solid #C8DEC9",
															color: "#2A5C2E",
														}}
													>
														Full coverage
													</span>
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
