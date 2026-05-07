/* biome-ignore-all lint/suspicious/noArrayIndexKey: display-only mapped lists in this file */
/* biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative inline icons */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
	BENCHMARK_MODEL_OPTIONS,
	BENCHMARK_MODEL_VALUES,
	dedupeModels,
} from "../modelOptions";
import type { BenchmarkQueueRun, BenchmarkWorkflowRun } from "../types";
import { formatUsd } from "../utils/modelPricing";

const TRIGGER_TOKEN_STORAGE_KEY = "benchmark_trigger_token";
const MAX_PROMPT_LIMIT = 10000;

function canUseSessionStorage(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.sessionStorage !== "undefined"
	);
}

function readStoredTriggerToken(): string {
	if (!canUseSessionStorage()) {
		return "";
	}
	return window.sessionStorage.getItem(TRIGGER_TOKEN_STORAGE_KEY)?.trim() ?? "";
}

function writeStoredTriggerToken(nextToken: string): void {
	if (!canUseSessionStorage()) {
		return;
	}
	const normalized = nextToken.trim();
	if (!normalized) {
		window.sessionStorage.removeItem(TRIGGER_TOKEN_STORAGE_KEY);
		return;
	}
	window.sessionStorage.setItem(TRIGGER_TOKEN_STORAGE_KEY, normalized);
}

function isWorkflowRun(
	run: BenchmarkWorkflowRun | BenchmarkQueueRun,
): run is BenchmarkWorkflowRun {
	return typeof (run as BenchmarkWorkflowRun).runNumber === "number";
}

function isQueueRun(
	run: BenchmarkWorkflowRun | BenchmarkQueueRun,
): run is BenchmarkQueueRun {
	return (
		typeof (run as BenchmarkQueueRun).id === "string" && !isWorkflowRun(run)
	);
}

function isActiveQueueRun(
	run: BenchmarkWorkflowRun | BenchmarkQueueRun,
): run is BenchmarkQueueRun {
	return (
		isQueueRun(run) && run.status !== "completed" && run.status !== "failed"
	);
}

function isWorkflowRunsResponse(
	value: unknown,
): value is { workflow: string; runs: BenchmarkWorkflowRun[] } {
	return Boolean(value && typeof value === "object" && "workflow" in value);
}

function isTerminalRun(run: BenchmarkWorkflowRun | BenchmarkQueueRun): boolean {
	if (isWorkflowRun(run)) {
		return run.status === "completed";
	}
	return run.status === "completed" || run.status === "failed";
}

function workflowRunStatusBadge(run: BenchmarkWorkflowRun) {
	if (run.status === "completed" && run.conclusion === "success") {
		return {
			label: "Succeeded",
			bg: "#ecfdf3",
			border: "#bbf7d0",
			text: "#166534",
		};
	}
	if (run.status === "completed" && run.conclusion === "failure") {
		return {
			label: "Failed",
			bg: "#fef2f2",
			border: "#fecaca",
			text: "#991b1b",
		};
	}
	if (run.status === "completed" && run.conclusion === "cancelled") {
		return {
			label: "Cancelled",
			bg: "#f8fafc",
			border: "#e2e8f0",
			text: "#475569",
		};
	}
	return {
		label: "Running",
		bg: "#fffbeb",
		border: "#fde68a",
		text: "#92400e",
	};
}

function queueRunStatusBadge(run: BenchmarkQueueRun) {
	if (run.status === "completed") {
		return {
			label: "Completed",
			bg: "#ecfdf3",
			border: "#bbf7d0",
			text: "#166534",
		};
	}
	if (run.status === "failed") {
		return {
			label: "Failed",
			bg: "#fef2f2",
			border: "#fecaca",
			text: "#991b1b",
		};
	}
	if (run.status === "running") {
		return {
			label: "Running",
			bg: "#fffbeb",
			border: "#fde68a",
			text: "#92400e",
		};
	}
	return {
		label: "Pending",
		bg: "#f8fafc",
		border: "#e2e8f0",
		text: "#475569",
	};
}

function formatRunDate(value: string) {
	if (!value) return "—";
	return new Date(value).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function formatCount(value: number) {
	return Math.max(0, Math.round(value)).toLocaleString();
}

function shortRunId(value: string) {
	if (!value) return "—";
	if (value.length <= 10) return value;
	return `${value.slice(0, 8)}…`;
}

// ── Web Search Toggle ─────────────────────────────────────────────────────────

function WebSearchToggle({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onChange(!checked)}
			className="inline-flex w-full sm:w-auto justify-center items-center gap-2.5 px-3 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-all"
			style={{
				background: checked ? "#F0F7F1" : "#F2EDE6",
				border: `1.5px solid ${checked ? "#C8DEC9" : "#DDD0BC"}`,
				color: checked ? "#2A5C2E" : "#7A8E7C",
			}}
		>
			{/* pill toggle */}
			<span
				className="relative flex-shrink-0"
				style={{
					width: 28,
					height: 16,
					borderRadius: 8,
					background: checked ? "#8FBB93" : "#DDD0BC",
					transition: "background 0.15s",
					display: "inline-block",
				}}
			>
				<span
					style={{
						position: "absolute",
						top: 2,
						left: checked ? 12 : 2,
						width: 12,
						height: 12,
						borderRadius: "50%",
						background: "#fff",
						transition: "left 0.15s",
						boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
					}}
				/>
			</span>
			Web search
		</button>
	);
}

// ── Runs Page ─────────────────────────────────────────────────────────────────

export default function Runs() {
	const queryClient = useQueryClient();

	const [triggerToken, setTriggerToken] = useState(() =>
		readStoredTriggerToken(),
	);
	const [ourTerms, setOurTerms] = useState("Highcharts");
	const [allowMultipleModels, setAllowMultipleModels] = useState(true);
	const [selectedModels, setSelectedModels] = useState<string[]>([
		BENCHMARK_MODEL_VALUES[0],
	]);
	const [runs, setRuns] = useState(1);
	const [temperature, setTemperature] = useState(0.7);
	const [webSearch, setWebSearch] = useState(true);
	const [runMonth, setRunMonth] = useState("");
	const [promptLimit] = useState("");
	const [promptFilter, setPromptFilter] = useState<"all" | "newest" | "tag">(
		"all",
	);
	const [cohortTag, setCohortTag] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const normalizedTriggerToken = triggerToken.trim();
	const hasTriggerToken = normalizedTriggerToken.length > 0;
	const modelOptionsQuery = useQuery({
		queryKey: ["benchmark-models"],
		queryFn: () => api.benchmarkModels(),
		staleTime: 5 * 60_000,
		retry: false,
	});
	const modelOptions = useMemo(
		() =>
			modelOptionsQuery.data?.models && modelOptionsQuery.data.models.length > 0
				? modelOptionsQuery.data.models
				: BENCHMARK_MODEL_OPTIONS,
		[modelOptionsQuery.data?.models],
	);
	const modelValues = useMemo(
		() => modelOptions.map((option) => option.value),
		[modelOptions],
	);
	const defaultModelValues = useMemo(() => {
		const allowed = new Set(modelValues);
		const fromApi =
			modelOptionsQuery.data?.defaultModelIds?.filter((id) =>
				allowed.has(id),
			) ?? [];
		return fromApi.length > 0
			? fromApi
			: [modelValues[0] ?? BENCHMARK_MODEL_VALUES[0]];
	}, [modelOptionsQuery.data?.defaultModelIds, modelValues]);
	const effectiveModels = useMemo(
		() =>
			allowMultipleModels
				? dedupeModels(selectedModels)
				: dedupeModels(selectedModels).slice(0, 1),
		[allowMultipleModels, selectedModels],
	);

	useEffect(() => {
		writeStoredTriggerToken(triggerToken);
	}, [triggerToken]);

	useEffect(() => {
		if (!allowMultipleModels) {
			setSelectedModels((current) => {
				const normalized = dedupeModels(current);
				return normalized.length > 0
					? [normalized[0]]
					: [defaultModelValues[0] ?? BENCHMARK_MODEL_VALUES[0]];
			});
		}
	}, [allowMultipleModels, defaultModelValues]);

	useEffect(() => {
		if (modelValues.length === 0) {
			return;
		}
		const allowed = new Set(modelValues);
		setSelectedModels((current) => {
			const retained = dedupeModels(current).filter((model) =>
				allowed.has(model),
			);
			if (retained.length > 0) {
				return retained;
			}
			return [defaultModelValues[0] ?? modelValues[0]];
		});
	}, [defaultModelValues, modelValues]);

	const runsQuery = useQuery({
		queryKey: ["benchmark-runs"],
		queryFn: () => api.benchmarkRuns(),
		refetchInterval: (query) => {
			const data = query.state.data as
				| { runs?: Array<BenchmarkWorkflowRun | BenchmarkQueueRun> }
				| undefined;
			const currentRuns = data?.runs ?? [];
			return currentRuns.some((run) => isActiveQueueRun(run)) ? 3_000 : 15_000;
		},
		retry: false,
	});
	const runCostsQuery = useQuery({
		queryKey: ["run-costs"],
		queryFn: () => api.runCosts(30),
		refetchInterval: 60_000,
		retry: false,
	});
	const configQuery = useQuery({
		queryKey: ["config"],
		queryFn: () => api.config(),
		retry: false,
	});
	const totalPromptCount = configQuery.data?.config.queries.length ?? null;
	const tagsByQuery = configQuery.data?.config.queryTags ?? {};
	const knownPromptTags = useMemo(() => {
		const seen = new Set<string>();
		for (const tags of Object.values(tagsByQuery)) {
			for (const rawTag of tags ?? []) {
				const normalized = String(rawTag || "")
					.trim()
					.toLowerCase();
				if (!normalized) continue;
				seen.add(normalized);
			}
		}
		return [...seen].sort((left, right) => left.localeCompare(right));
	}, [tagsByQuery]);
	const normalizedCohortTag = useMemo(
		() => cohortTag.trim().toLowerCase(),
		[cohortTag],
	);
	const tagMatchedPromptCount = useMemo(() => {
		if (!normalizedCohortTag) {
			return null;
		}
		const configQueries = configQuery.data?.config.queries ?? [];
		if (configQueries.length > 0) {
			let matched = 0;
			for (const query of configQueries) {
				const tags = tagsByQuery[query] ?? [];
				const hasMatch = (tags ?? []).some(
					(tag) =>
						String(tag || "")
							.trim()
							.toLowerCase() === normalizedCohortTag,
				);
				if (hasMatch) {
					matched += 1;
				}
			}
			return matched;
		}

		if (Object.keys(tagsByQuery).length > 0) {
			let matched = 0;
			for (const tags of Object.values(tagsByQuery)) {
				const hasMatch = (tags ?? []).some(
					(tag) =>
						String(tag || "")
							.trim()
							.toLowerCase() === normalizedCohortTag,
				);
				if (hasMatch) {
					matched += 1;
				}
			}
			return matched;
		}
		return null;
	}, [normalizedCohortTag, configQuery.data?.config.queries, tagsByQuery]);
	const normalizedPromptLimit = useMemo(() => {
		const raw = promptLimit.trim();
		if (!raw) return undefined;
		const parsed = Math.trunc(Number(raw));
		if (!Number.isFinite(parsed) || parsed < 1) return undefined;
		if (parsed > MAX_PROMPT_LIMIT) return MAX_PROMPT_LIMIT;
		if (typeof totalPromptCount === "number" && totalPromptCount > 0) {
			return Math.min(parsed, totalPromptCount);
		}
		return parsed;
	}, [promptLimit, totalPromptCount]);
	const effectivePromptLimit = useMemo(() => {
		if (typeof normalizedPromptLimit === "number") {
			return normalizedPromptLimit;
		}
		if (promptFilter === "newest") {
			return 1;
		}
		return undefined;
	}, [normalizedPromptLimit, promptFilter]);
	const promptScopeLabel = useMemo(() => {
		if (promptFilter === "tag") {
			if (!normalizedCohortTag) {
				if (knownPromptTags.length > 0) {
					return `Select a tag filter. ${knownPromptTags.length} tags available.`;
				}
				return "Select a tag filter to run only matching prompts.";
			}
			if (typeof tagMatchedPromptCount === "number") {
				if (normalizedPromptLimit) {
					const effectiveCount = Math.min(
						tagMatchedPromptCount,
						normalizedPromptLimit,
					);
					return `Tag "${normalizedCohortTag}" matches ${tagMatchedPromptCount} prompts. Will run ${effectiveCount}.`;
				}
				return `Tag "${normalizedCohortTag}" matches ${tagMatchedPromptCount} prompts.`;
			}
			return `Will run prompts tagged "${normalizedCohortTag}".`;
		}

		if (promptFilter === "newest") {
			if (typeof totalPromptCount === "number") {
				const effectiveCount = Math.min(
					totalPromptCount,
					effectivePromptLimit ?? totalPromptCount,
				);
				if (effectiveCount <= 1) {
					return totalPromptCount === 1
						? "Will run the only active prompt."
						: "Will run the newest prompt.";
				}
				if (effectiveCount < totalPromptCount) {
					return `Will run newest ${effectiveCount} of ${totalPromptCount} prompts.`;
				}
				return `Will run newest ${totalPromptCount} active prompts.`;
			}
			if ((effectivePromptLimit ?? 0) <= 1) {
				return "Will run the newest prompt.";
			}
			return `Will run newest ${effectivePromptLimit} prompts.`;
		}

		if (typeof totalPromptCount === "number") {
			if (normalizedPromptLimit) {
				return `Will run first ${normalizedPromptLimit} of ${totalPromptCount} prompts.`;
			}
			return `Will run all ${totalPromptCount} prompts.`;
		}
		if (normalizedPromptLimit) {
			return `Will run first ${normalizedPromptLimit} prompts.`;
		}
		return "Will run all prompts.";
	}, [
		promptFilter,
		normalizedCohortTag,
		tagMatchedPromptCount,
		effectivePromptLimit,
		normalizedPromptLimit,
		totalPromptCount,
		knownPromptTags.length,
	]);

	const triggerMutation = useMutation({
		mutationFn: () =>
			api.triggerBenchmark(
				{
					model: effectiveModels[0],
					models: effectiveModels,
					runs,
					temperature,
					webSearch,
					ourTerms,
					runMonth: runMonth || undefined,
					promptLimit:
						promptFilter === "newest"
							? effectivePromptLimit
							: normalizedPromptLimit,
					promptOrder: promptFilter === "newest" ? "newest" : "default",
					cohortTag:
						promptFilter === "tag"
							? normalizedCohortTag || undefined
							: undefined,
				},
				normalizedTriggerToken || undefined,
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["benchmark-runs"] });
			queryClient.invalidateQueries({ queryKey: ["dashboard"] });
			queryClient.invalidateQueries({ queryKey: ["run-costs"] });
			queryClient.invalidateQueries({ queryKey: ["under-the-hood"] });
		},
	});

	const activeRun = useMemo(
		() => runsQuery.data?.runs.find((run) => !isTerminalRun(run)) ?? null,
		[runsQuery.data?.runs],
	);
	const queueContractEnabled = useMemo(
		() => Boolean(runsQuery.data && !isWorkflowRunsResponse(runsQuery.data)),
		[runsQuery.data],
	);
	const activeQueueRun = useMemo(
		() =>
			(runsQuery.data?.runs ?? []).find((run): run is BenchmarkQueueRun =>
				isActiveQueueRun(run),
			) ?? null,
		[runsQuery.data?.runs],
	);
	const hasActiveQueueRun = Boolean(activeQueueRun);

	const stopMutation = useMutation({
		mutationFn: (runId: string) =>
			api.stopBenchmark(
				{
					runId,
				},
				normalizedTriggerToken || undefined,
			),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["benchmark-runs"] });
			queryClient.invalidateQueries({ queryKey: ["dashboard"] });
			queryClient.invalidateQueries({ queryKey: ["run-costs"] });
			queryClient.invalidateQueries({ queryKey: ["under-the-hood"] });
		},
	});

	const canRun =
		!triggerMutation.isPending &&
		!stopMutation.isPending &&
		hasTriggerToken &&
		effectiveModels.length > 0 &&
		Boolean(ourTerms.trim()) &&
		(promptFilter !== "tag" || Boolean(normalizedCohortTag));
	const canStopActiveRun =
		queueContractEnabled &&
		hasTriggerToken &&
		Boolean(activeQueueRun) &&
		!stopMutation.isPending;

	const runsErrorMessage = useMemo(() => {
		if (!runsQuery.isError) return "";
		const message =
			(runsQuery.error as Error).message || "Unable to load runs.";
		if (message === "Unauthorized trigger token.") {
			return hasTriggerToken
				? "Run service rejected the provided trigger token."
				: "Recent runs are still protected on this deployment.";
		}
		if (message === "Internal server error.") {
			return "Server is not ready to list runs. Ask an admin to verify benchmark API env vars.";
		}
		return message;
	}, [hasTriggerToken, runsQuery.isError, runsQuery.error]);

	const triggerErrorMessage = useMemo(() => {
		if (!triggerMutation.isError) return "";
		const message =
			(triggerMutation.error as Error).message || "Unable to trigger run.";
		if (
			message.includes("Unexpected inputs provided") &&
			message.includes("model_count")
		) {
			return "Trigger workflow is out of sync. Pull latest main and retry.";
		}
		if (
			message.includes("Unexpected inputs provided") &&
			message.includes("prompt_limit")
		) {
			return "Prompt-limit workflow support is not deployed yet. Pull latest main and retry.";
		}
		if (
			message.includes("prompt_order") ||
			message.includes("p_prompt_order") ||
			(message.includes("enqueue_benchmark_run") &&
				message.includes("function"))
		) {
			return "Prompt filter order is not deployed in Supabase yet. Apply latest migrations and retry.";
		}
		return message;
	}, [triggerMutation.isError, triggerMutation.error]);
	const stopErrorMessage = useMemo(() => {
		if (!stopMutation.isError) return "";
		const message =
			(stopMutation.error as Error).message || "Unable to stop run.";
		if (message === "No active queue runs found.") {
			return "No active queue run found to stop.";
		}
		return message;
	}, [stopMutation.isError, stopMutation.error]);

	function handleStopActiveRun() {
		if (!activeQueueRun || stopMutation.isPending) {
			return;
		}
		const label = activeQueueRun.runMonth
			? `${activeQueueRun.runKind === "cohort" ? "Cohort" : "Full"} ${activeQueueRun.runMonth}`
			: shortRunId(activeQueueRun.id);
		const confirmed = window.confirm(
			`Stop ${label}? This will cancel queued/pending jobs for the run.`,
		);
		if (!confirmed) {
			return;
		}
		stopMutation.mutate(activeQueueRun.id);
	}

	const inputStyle = {
		border: "1px solid #DDD0BC",
		background: "#FFFFFF",
		color: "#2A3A2C",
		outline: "none",
	};

	return (
		<div className="max-w-[1100px] space-y-4">
			<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

			{/* ── Trigger card ── */}
			<div
				className="rounded-xl border shadow-sm"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div
					className="px-5 py-3.5 flex items-center justify-between gap-3"
					style={{ borderBottom: "1px solid #F2EDE6" }}
				>
					<span className="text-sm font-semibold" style={{ color: "#2A3A2C" }}>
						Run Benchmark
					</span>
					<div className="flex items-center gap-3">
						{/* Status pill */}
						{activeRun ? (
							<span
								className="text-xs px-2.5 py-1 rounded-full font-semibold"
								style={{
									background: "#fffbeb",
									border: "1px solid #fde68a",
									color: "#92400e",
								}}
							>
								{isWorkflowRun(activeRun)
									? `Run #${activeRun.runNumber} in progress`
									: `In progress${activeRun.progress ? ` · ${Math.round(activeRun.progress.completionPct)}%` : ""}`}
							</span>
						) : runsQuery.data ? (
							<span
								className="text-xs px-2.5 py-1 rounded-full"
								style={{
									background: "#F0F7F1",
									border: "1px solid #C8DEC9",
									color: "#2A5C2E",
								}}
							>
								No active run
							</span>
						) : null}
						{runCostsQuery.data && runCostsQuery.data.runCount > 0 && (
							<span
								className="text-xs tabular-nums"
								style={{ color: "#7A8E7C" }}
							>
								Est. cost (last {runCostsQuery.data.runCount}):{" "}
								<strong>
									{formatUsd(runCostsQuery.data.totals.estimatedTotalCostUsd)}
								</strong>
							</span>
						)}
						<Link
							to="/prompts"
							className="text-xs"
							style={{ color: "#6B8470" }}
						>
							Edit Prompts ↗
						</Link>
					</div>
				</div>

				<div className="px-5 py-4 space-y-3">
					{/* Token row */}
					<div className="flex gap-2">
						<input
							type="password"
							value={triggerToken}
							onChange={(event) => setTriggerToken(event.target.value)}
							className="flex-1 px-3 py-2 rounded-lg text-sm"
							style={inputStyle}
							placeholder="Paste BENCHMARK_TRIGGER_TOKEN"
							autoComplete="off"
						/>
						<button
							type="button"
							onClick={() => setTriggerToken("")}
							disabled={!hasTriggerToken}
							className="px-3 py-2 rounded-lg text-sm font-medium"
							style={{
								border: "1px solid #DDD0BC",
								background: "#FFFFFF",
								color: hasTriggerToken ? "#536654" : "#9AAE9C",
								cursor: hasTriggerToken ? "pointer" : "not-allowed",
							}}
						>
							Clear
						</button>
					</div>

					{/* Action row */}
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => triggerMutation.mutate()}
							disabled={!canRun}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
							style={{
								background: canRun ? "#2A6032" : "#E8E0D2",
								color: canRun ? "#FFFFFF" : "#9AAE9C",
								cursor: canRun ? "pointer" : "not-allowed",
								boxShadow: canRun ? "0 1px 8px rgba(42,96,50,0.22)" : "none",
								border: `1.5px solid ${canRun ? "#1E4A26" : "transparent"}`,
							}}
						>
							{triggerMutation.isPending ? (
								<>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
										strokeLinecap="round"
										style={{ animation: "spin 0.9s linear infinite" }}
									>
										<path d="M21 12a9 9 0 1 1-6.219-8.56" />
									</svg>
									Queueing…
								</>
							) : (
								<>
									<svg
										width="11"
										height="11"
										viewBox="0 0 24 24"
										fill={canRun ? "white" : "#9AAE9C"}
										stroke="none"
									>
										<polygon points="5,3 19,12 5,21" />
									</svg>
									Run Benchmark
								</>
							)}
						</button>

						<button
							type="button"
							onClick={() => runsQuery.refetch()}
							className="px-3 py-2 rounded-lg text-sm font-medium"
							style={{
								border: "1px solid #DDD0BC",
								color: "#2A3A2C",
								background: "#FFFFFF",
								cursor: "pointer",
							}}
						>
							Refresh
						</button>

						{queueContractEnabled && (
							<button
								type="button"
								onClick={handleStopActiveRun}
								disabled={!canStopActiveRun}
								className="px-3 py-2 rounded-lg text-sm font-medium"
								style={{
									border: "1px solid #FCA5A5",
									color: canStopActiveRun ? "#991B1B" : "#D4A8A8",
									background: "#FFFFFF",
									cursor: canStopActiveRun ? "pointer" : "not-allowed",
								}}
							>
								{stopMutation.isPending ? "Stopping…" : "Stop"}
							</button>
						)}

						<WebSearchToggle checked={webSearch} onChange={setWebSearch} />

						<div style={{ flex: 1 }} />

						{/* Config dropdown */}
						<button
							type="button"
							onClick={() => setShowAdvanced((v) => !v)}
							className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
							style={{
								background: showAdvanced ? "#F2EDE6" : "transparent",
								border: `1px solid ${showAdvanced ? "#DDD0BC" : "#E8E0D2"}`,
								color: showAdvanced ? "#2A3A2C" : "#7A8E7C",
								cursor: "pointer",
							}}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<circle cx="12" cy="12" r="3" />
								<path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M20 12h2M2 12h2M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41" />
							</svg>
							Config
							<svg
								width="11"
								height="11"
								viewBox="0 0 12 12"
								fill="none"
								style={{
									transition: "transform 0.15s",
									transform: showAdvanced ? "rotate(180deg)" : "none",
								}}
							>
								<path
									d="M2 4l4 4 4-4"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						</button>
					</div>

					{/* Config dropdown panel */}
					<div
						style={{
							overflow: "hidden",
							maxHeight: showAdvanced ? 1000 : 0,
							opacity: showAdvanced ? 1 : 0,
							transition: "max-height 0.25s ease, opacity 0.2s ease",
						}}
					>
						<div
							className="rounded-xl p-4 space-y-4"
							style={{ background: "#FDFCF8", border: "1px solid #EDE8E0" }}
						>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								{/* Brand terms */}
								<label className="space-y-1 col-span-2 sm:col-span-1">
									<span
										className="text-xs font-medium"
										style={{ color: "#7A8E7C" }}
									>
										Brand terms
									</span>
									<input
										value={ourTerms}
										onChange={(e) => setOurTerms(e.target.value)}
										className="w-full px-3 py-2 rounded-lg text-sm"
										style={inputStyle}
										placeholder="Highcharts"
									/>
								</label>
								{/* Runs per prompt */}
								<label className="space-y-1">
									<span
										className="text-xs font-medium"
										style={{ color: "#7A8E7C" }}
									>
										Runs / prompt
									</span>
									<input
										type="number"
										min={1}
										max={3}
										value={runs}
										onChange={(e) =>
											setRuns(
												Math.max(1, Math.min(3, Number(e.target.value) || 1)),
											)
										}
										className="w-full px-3 py-2 rounded-lg text-sm"
										style={inputStyle}
									/>
								</label>
								{/* Temperature */}
								<label className="space-y-1">
									<span
										className="text-xs font-medium"
										style={{ color: "#7A8E7C" }}
									>
										Temperature
									</span>
									<input
										type="number"
										min={0}
										max={2}
										step={0.1}
										value={temperature}
										onChange={(e) => {
											const v = Number(e.target.value);
											setTemperature(
												Number.isFinite(v) ? Math.max(0, Math.min(2, v)) : 0.7,
											);
										}}
										className="w-full px-3 py-2 rounded-lg text-sm"
										style={inputStyle}
									/>
								</label>
								{/* Run month */}
								<label className="space-y-1">
									<span
										className="text-xs font-medium"
										style={{ color: "#7A8E7C" }}
									>
										Run month
									</span>
									<input
										type="month"
										value={runMonth}
										onChange={(e) => setRunMonth(e.target.value)}
										className="w-full px-3 py-2 rounded-lg text-sm"
										style={inputStyle}
									/>
								</label>
							</div>

							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
								{/* Prompt filter */}
								<div className="space-y-2">
									<span
										className="text-xs font-medium"
										style={{ color: "#7A8E7C" }}
									>
										Prompt filter
									</span>
									<select
										value={promptFilter}
										onChange={(e) =>
											setPromptFilter(
												e.target.value as "all" | "newest" | "tag",
											)
										}
										className="w-full px-3 py-2 rounded-lg text-sm"
										style={inputStyle}
									>
										<option value="all">All prompts</option>
										<option value="newest">Newest prompts</option>
										<option value="tag">Filter by tag</option>
									</select>
									{promptFilter === "tag" && (
										<>
											<input
												value={cohortTag}
												onChange={(e) => setCohortTag(e.target.value)}
												className="w-full px-3 py-2 rounded-lg text-sm"
												style={inputStyle}
												placeholder="cohort:seo-v1"
												list="run-cohort-tags"
											/>
											<datalist id="run-cohort-tags">
												{knownPromptTags.map((tag) => (
													<option key={tag} value={tag} />
												))}
											</datalist>
										</>
									)}
									<p className="text-xs" style={{ color: "#9AAE9C" }}>
										{promptScopeLabel}
									</p>
								</div>

								{/* Models */}
								<div className="space-y-2">
									<div className="flex items-center justify-between gap-2">
										<span
											className="text-xs font-medium"
											style={{ color: "#7A8E7C" }}
										>
											Models ({effectiveModels.length})
										</span>
										<div className="flex items-center gap-2">
											<label
												className="inline-flex items-center gap-1 text-xs"
												style={{ color: "#607860" }}
											>
												<input
													type="checkbox"
													checked={allowMultipleModels}
													onChange={(e) =>
														setAllowMultipleModels(e.target.checked)
													}
												/>
												Multiple
											</label>
											<button
												type="button"
												onClick={() =>
													setSelectedModels(
														allowMultipleModels
															? modelValues
															: [defaultModelValues[0] ?? modelValues[0]],
													)
												}
												className="px-2 py-0.5 rounded text-xs font-medium"
												style={{
													background: "#EEF5EF",
													border: "1px solid #C8DDC9",
													color: "#2C5D30",
												}}
											>
												All
											</button>
											<button
												type="button"
												onClick={() =>
													setSelectedModels([
														defaultModelValues[0] ?? modelValues[0],
													])
												}
												className="px-2 py-0.5 rounded text-xs font-medium"
												style={{
													background: "#F2EDE6",
													border: "1px solid #DDD0BC",
													color: "#607860",
												}}
											>
												Reset
											</button>
										</div>
									</div>
									<div className="grid grid-cols-1 gap-1.5">
										{modelOptions.map((option) => {
											const checked = selectedModels.includes(option.value);
											const disabled =
												!allowMultipleModels &&
												!checked &&
												effectiveModels.length >= 1;
											return (
												<label
													key={option.value}
													className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
													style={{
														border: `1px solid ${checked ? "#8FBB93" : "#DDD0BC"}`,
														background: checked ? "#EEF5EF" : "#FFFFFF",
														opacity: disabled ? 0.55 : 1,
														cursor: disabled ? "not-allowed" : "pointer",
													}}
												>
													<span className="flex min-w-0 items-center gap-2">
														<span
															className="truncate text-xs"
															style={{
																color: checked ? "#2A5C2E" : "#2A3A2C",
															}}
														>
															{option.label}
														</span>
														{option.kind === "latest" && (
															<span
																className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
																title={
																	option.resolvedValue
																		? `Resolved from latest slot to ${option.resolvedValue}`
																		: option.fallback
																			? `Falls back to ${option.fallback}`
																			: "Resolved when the run starts"
																}
																style={{
																	background: "#EAF3EF",
																	border: "1px solid #C8DDC9",
																	color: "#2C5D30",
																}}
															>
																Latest
															</span>
														)}
													</span>
													<input
														type="checkbox"
														checked={checked}
														disabled={disabled}
														onChange={(e) => {
															const isChecked = e.target.checked;
															if (!allowMultipleModels) {
																setSelectedModels(
																	isChecked ? [option.value] : [],
																);
																return;
															}
															setSelectedModels((cur) => {
																if (isChecked)
																	return dedupeModels([...cur, option.value]);
																const next = cur.filter(
																	(v) => v !== option.value,
																);
																return next.length > 0
																	? next
																	: [defaultModelValues[0] ?? modelValues[0]];
															});
														}}
													/>
												</label>
											);
										})}
									</div>
								</div>
							</div>
						</div>
					</div>

					{/* Feedback */}
					{triggerMutation.isSuccess && (
						<div
							className="rounded-lg px-3 py-2 text-sm"
							style={{
								background: "#ecfdf3",
								border: "1px solid #bbf7d0",
								color: "#166534",
							}}
						>
							{triggerMutation.data.message}
						</div>
					)}
					{triggerMutation.isError && (
						<div
							className="rounded-lg px-3 py-2 text-sm"
							style={{
								background: "#fef2f2",
								border: "1px solid #fecaca",
								color: "#991b1b",
							}}
						>
							{triggerErrorMessage}
						</div>
					)}
					{stopMutation.isSuccess && (
						<div
							className="rounded-lg px-3 py-2 text-sm"
							style={{
								background: "#ecfdf3",
								border: "1px solid #bbf7d0",
								color: "#166534",
							}}
						>
							{stopMutation.data.message}
						</div>
					)}
					{stopMutation.isError && (
						<div
							className="rounded-lg px-3 py-2 text-sm"
							style={{
								background: "#fef2f2",
								border: "1px solid #fecaca",
								color: "#991b1b",
							}}
						>
							{stopErrorMessage}
						</div>
					)}
					{runsQuery.isError && (
						<div
							className="rounded-lg px-3 py-2 text-xs"
							style={{
								background: "#fef2f2",
								border: "1px solid #fecaca",
								color: "#991b1b",
							}}
						>
							{runsErrorMessage}
						</div>
					)}
					{!hasTriggerToken && (
						<div
							className="rounded-lg px-3 py-2 text-sm"
							style={{
								background: "#f0f9ff",
								border: "1px solid #bae6fd",
								color: "#075985",
							}}
						>
							Trigger token is only needed to start or stop benchmark runs.
						</div>
					)}
				</div>
			</div>

			{/* Recent runs table */}
			<div
				className="rounded-xl border shadow-sm overflow-hidden"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div
					className="px-4 sm:px-5 py-4 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
					style={{ borderBottom: "1px solid #F2EDE6" }}
				>
					<div
						className="text-sm font-semibold tracking-tight"
						style={{ color: "#2A3A2C" }}
					>
						{queueContractEnabled
							? "Recent Queue Runs"
							: "Recent Workflow Runs"}
					</div>
					<div className="text-xs" style={{ color: "#9AAE9C" }}>
						{hasTriggerToken
							? hasActiveQueueRun
								? "Auto-refresh every 3s while running"
								: "Auto-refresh every 15s"
							: "Read-only view · runs auto-refresh every 15s"}
					</div>
				</div>

				{runsQuery.isLoading ? (
					<div className="p-5 space-y-2">
						{Array.from({ length: 5 }).map((_, i) => (
							<div
								key={i}
								className="h-11 rounded animate-pulse"
								style={{ background: "#F2EDE6" }}
							/>
						))}
					</div>
				) : (runsQuery.data?.runs ?? []).length === 0 ? (
					<div className="p-5 text-sm" style={{ color: "#7A8E7C" }}>
						No runs found yet.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px]">
							<thead>
								<tr style={{ borderBottom: "1px solid #F2EDE6" }}>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										Run
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										Status
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										Started
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										Updated
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-right"
										style={{ color: "#7A8E7C" }}
									>
										Progress / Logs
									</th>
								</tr>
							</thead>
							<tbody>
								{(runsQuery.data?.runs ?? []).map((run, i, all) => {
									const badge = isWorkflowRun(run)
										? workflowRunStatusBadge(run)
										: queueRunStatusBadge(run);
									const queueProgress =
										isQueueRun(run) && run.progress
											? {
													totalJobs: Math.max(
														0,
														Math.round(run.progress.totalJobs),
													),
													completedJobs: Math.max(
														0,
														Math.round(run.progress.completedJobs),
													),
													completionPct: Math.max(
														0,
														Math.min(
															100,
															Number(run.progress.completionPct || 0),
														),
													),
												}
											: null;
									return (
										<tr
											key={run.id}
											style={{
												borderBottom:
													i < all.length - 1 ? "1px solid #F2EDE6" : "none",
											}}
										>
											<td className="px-5 py-3.5">
												<div
													className="text-sm font-medium"
													style={{ color: "#2A3A2C" }}
												>
													{isWorkflowRun(run)
														? `#${run.runNumber}`
														: run.models || shortRunId(run.id)}
												</div>
												<div className="text-xs" style={{ color: "#9AAE9C" }}>
													{isWorkflowRun(run)
														? run.title
														: run.runMonth
															? `${run.runKind === "cohort" ? "Cohort" : "Full"} · ${run.runMonth}${
																	run.cohortTag ? ` · ${run.cohortTag}` : ""
																}`
															: shortRunId(run.id)}
												</div>
											</td>
											<td className="px-5 py-3.5">
												<span
													className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
													style={{
														background: badge.bg,
														border: `1px solid ${badge.border}`,
														color: badge.text,
													}}
												>
													{badge.label}
												</span>
											</td>
											<td
												className="px-5 py-3.5 text-sm"
												style={{ color: "#536654" }}
											>
												{formatRunDate(
													isWorkflowRun(run)
														? run.createdAt
														: (run.createdAt ?? ""),
												)}
											</td>
											<td
												className="px-5 py-3.5 text-sm"
												style={{ color: "#536654" }}
											>
												{isWorkflowRun(run)
													? formatRunDate(run.updatedAt)
													: "—"}
											</td>
											<td className="px-5 py-3.5 text-right">
												{isWorkflowRun(run) ? (
													<a
														href={run.htmlUrl}
														target="_blank"
														rel="noreferrer"
														className="text-sm font-medium underline"
														style={{ color: "#3D5C40" }}
													>
														Open
													</a>
												) : queueProgress ? (
													<div className="flex min-w-[180px] items-center justify-end gap-2">
														<div
															className="h-2 w-28 overflow-hidden rounded-full"
															style={{ background: "#E8E0D2" }}
														>
															<div
																className="h-full rounded-full"
																style={{
																	width: `${queueProgress.completionPct}%`,
																	background:
																		run.status === "failed"
																			? "#dc2626"
																			: run.status === "completed"
																				? "#15803d"
																				: "#8FBB93",
																}}
															/>
														</div>
														<span
															className="text-xs tabular-nums"
															style={{ color: "#607860" }}
														>
															{queueProgress.completedJobs}/
															{queueProgress.totalJobs}
														</span>
													</div>
												) : (
													<span
														className="text-xs"
														style={{ color: "#9AAE9C" }}
													>
														Pending
													</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Benchmark run costs table */}
			<div
				className="rounded-xl border shadow-sm overflow-hidden"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div
					className="px-4 sm:px-5 py-4 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
					style={{ borderBottom: "1px solid #F2EDE6" }}
				>
					<div
						className="text-sm font-semibold tracking-tight"
						style={{ color: "#2A3A2C" }}
					>
						Benchmark Run Costs
					</div>
					<div className="text-xs" style={{ color: "#9AAE9C" }}>
						Estimated input/output token spend per benchmark run
					</div>
				</div>

				{runCostsQuery.isLoading ? (
					<div className="p-5 space-y-2">
						{Array.from({ length: 5 }).map((_, i) => (
							<div
								key={i}
								className="h-11 rounded animate-pulse"
								style={{ background: "#F2EDE6" }}
							/>
						))}
					</div>
				) : runCostsQuery.isError ? (
					<div className="p-5 text-sm" style={{ color: "#B91C1C" }}>
						{(runCostsQuery.error as Error).message}
					</div>
				) : (runCostsQuery.data?.runs ?? []).length === 0 ? (
					<div className="p-5 text-sm" style={{ color: "#7A8E7C" }}>
						No benchmark token data found yet.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[800px]">
							<thead>
								<tr style={{ borderBottom: "1px solid #F2EDE6" }}>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										ID
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										Created
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-right"
										style={{ color: "#7A8E7C" }}
									>
										Responses
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-right"
										style={{ color: "#7A8E7C" }}
									>
										Unique prompts
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-right"
										style={{ color: "#7A8E7C" }}
									>
										Input tokens
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-right"
										style={{ color: "#7A8E7C" }}
									>
										Output tokens
									</th>
									<th
										className="px-5 py-3 text-xs font-medium text-left"
										style={{ color: "#7A8E7C" }}
									>
										Models
									</th>
								</tr>
							</thead>
							<tbody>
								{(runCostsQuery.data?.runs ?? []).map((run, i, all) => (
									<tr
										key={run.runId}
										style={{
											borderBottom:
												i < all.length - 1 ? "1px solid #F2EDE6" : "none",
										}}
									>
										<td className="px-5 py-3.5">
											<div
												className="text-sm font-medium tabular-nums"
												style={{ color: "#2A3A2C" }}
											>
												{shortRunId(run.runId)}
											</div>
											<div className="text-xs" style={{ color: "#9AAE9C" }}>
												{(run.runKind === "cohort" ? "Cohort" : "Full") +
													(run.runMonth ? ` · ${run.runMonth}` : "") +
													(run.cohortTag ? ` · ${run.cohortTag}` : "")}
											</div>
										</td>
										<td
											className="px-5 py-3.5 text-sm"
											style={{ color: "#536654" }}
										>
											{formatRunDate(run.createdAt ?? run.startedAt ?? "")}
										</td>
										<td
											className="px-5 py-3.5 text-sm text-right tabular-nums"
											style={{ color: "#2A3A2C" }}
										>
											{formatCount(run.responseCount)}
										</td>
										<td
											className="px-5 py-3.5 text-sm text-right tabular-nums"
											style={{ color: "#2A3A2C" }}
										>
											{run.uniquePrompts > 0
												? formatCount(run.uniquePrompts)
												: "—"}
										</td>
										<td
											className="px-5 py-3.5 text-sm text-right tabular-nums"
											style={{ color: "#2A3A2C" }}
										>
											{formatCount(run.inputTokens)}
										</td>
										<td
											className="px-5 py-3.5 text-sm text-right tabular-nums"
											style={{ color: "#2A3A2C" }}
										>
											{formatCount(run.outputTokens)}
										</td>
										<td
											className="px-5 py-3.5 text-xs"
											style={{ color: "#607860" }}
										>
											{run.models.length > 0 ? run.models.join(", ") : "—"}
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
