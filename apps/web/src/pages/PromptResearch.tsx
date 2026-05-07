import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ContentGapStatus, PromptResearchCohort } from "../types";

const TRIGGER_TOKEN_STORAGE_KEY = "benchmark_trigger_token";
const OPTIMIZATION_STATUSES: ContentGapStatus[] = [
	"backlog",
	"in_progress",
	"published",
	"verify",
	"closed",
];

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

export default function PromptResearch() {
	const qc = useQueryClient();
	const [triggerToken, setTriggerToken] = useState(() =>
		readStoredTriggerToken(),
	);
	const [newCohortTag, setNewCohortTag] = useState("cohort:weekly");
	const [newCohortName, setNewCohortName] = useState("");
	const [newCohortTargetPp, setNewCohortTargetPp] = useState("5");
	const [newCohortTargetWeeks, setNewCohortTargetWeeks] = useState("8");
	const [selectedCohortId, setSelectedCohortId] = useState("");

	useEffect(() => {
		const refreshToken = () => setTriggerToken(readStoredTriggerToken());
		refreshToken();
		window.addEventListener("focus", refreshToken);
		return () => window.removeEventListener("focus", refreshToken);
	}, []);

	const normalizedTriggerToken = triggerToken.trim();
	const hasTriggerToken = normalizedTriggerToken.length > 0;

	const cohortsQuery = useQuery({
		queryKey: ["prompt-research-cohorts"],
		queryFn: () => api.promptResearchCohorts(),
		retry: false,
	});
	const selectedCohort = useMemo(
		() =>
			(cohortsQuery.data ?? []).find(
				(cohort) => cohort.id === selectedCohortId,
			) ??
			(cohortsQuery.data ?? [])[0] ??
			null,
		[cohortsQuery.data, selectedCohortId],
	);
	const progressQuery = useQuery({
		queryKey: ["prompt-research-progress", selectedCohort?.id ?? "none"],
		queryFn: () => api.promptResearchProgress(selectedCohort?.id ?? ""),
		enabled: Boolean(selectedCohort?.id),
		retry: false,
	});
	const optimizationGapsQuery = useQuery({
		queryKey: ["optimization-queue"],
		queryFn: () => api.researchGaps({ limit: 200 }),
		retry: false,
	});
	const createCohortMutation = useMutation({
		mutationFn: (payload: {
			tag: string;
			displayName?: string;
			targetPp?: number;
			targetWeeks?: number;
		}) =>
			api.createPromptResearchCohort(
				payload,
				normalizedTriggerToken || undefined,
			),
		onSuccess: async (created) => {
			setSelectedCohortId(created.id);
			await Promise.all([
				qc.invalidateQueries({ queryKey: ["prompt-research-cohorts"] }),
				qc.invalidateQueries({ queryKey: ["prompt-research-progress"] }),
			]);
		},
	});
	const updateOptimizationStatusMutation = useMutation({
		mutationFn: (payload: {
			id: string;
			status: ContentGapStatus;
			linkedPageUrl?: string;
		}) =>
			api.researchUpdateGapStatus(
				payload.id,
				{ status: payload.status, linkedPageUrl: payload.linkedPageUrl },
				normalizedTriggerToken || undefined,
			),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["optimization-queue"] });
		},
	});

	useEffect(() => {
		if (!selectedCohortId && (cohortsQuery.data ?? []).length > 0) {
			setSelectedCohortId(cohortsQuery.data?.[0]?.id ?? "");
		}
	}, [cohortsQuery.data, selectedCohortId]);

	async function handleCreateCohort() {
		if (!hasTriggerToken || createCohortMutation.isPending) return;
		const tag = newCohortTag.trim().toLowerCase();
		if (!tag) return;

		const targetPp = Number(newCohortTargetPp);
		const targetWeeks = Number(newCohortTargetWeeks);

		await createCohortMutation.mutateAsync({
			tag,
			displayName: newCohortName.trim() || undefined,
			targetPp: Number.isFinite(targetPp) ? targetPp : undefined,
			targetWeeks: Number.isFinite(targetWeeks) ? targetWeeks : undefined,
		});
	}

	const optimizationByStatus = useMemo(() => {
		const grouped: Record<
			ContentGapStatus,
			Awaited<ReturnType<typeof api.researchGaps>>
		> = {
			backlog: [],
			in_progress: [],
			published: [],
			verify: [],
			closed: [],
		};
		for (const gap of optimizationGapsQuery.data ?? []) {
			grouped[gap.status].push(gap);
		}
		return grouped;
	}, [optimizationGapsQuery.data]);

	return (
		<div className="max-w-[1360px] space-y-5">
			<section
				className="rounded-xl border p-4 space-y-4"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h3
							className="text-sm font-semibold tracking-tight"
							style={{ color: "#2A3A2C" }}
						>
							Prompt Research
						</h3>
						<p className="text-xs mt-0.5" style={{ color: "#7A8E7C" }}>
							Cohort baseline lock and uplift tracking against target progress.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Link
							to="/runs"
							className="rounded-full px-3 py-1 text-xs font-semibold"
							style={{
								background: "#F2EDE6",
								border: "1px solid #DDD0BC",
								color: "#5C6E5D",
							}}
						>
							Open Runs
						</Link>
						{progressQuery.data && (
							<div
								className="rounded-full px-3 py-1 text-xs font-semibold tabular-nums"
								style={{
									background: "#EEF5EF",
									border: "1px solid #C8DEC9",
									color: "#2A5C2E",
								}}
							>
								Progress {progressQuery.data.progressPct.toFixed(1)}%
							</div>
						)}
					</div>
				</div>

				<div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
					<div
						className="rounded-lg p-3 space-y-2"
						style={{ background: "#FDFCF8", border: "1px solid #EDE8E0" }}
					>
						<div className="text-xs font-semibold" style={{ color: "#5D7260" }}>
							Create / Update Cohort
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							<input
								value={newCohortTag}
								onChange={(event) => setNewCohortTag(event.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									border: "1px solid #DDD0BC",
									background: "#FFFFFF",
									color: "#2A3A2C",
								}}
								placeholder="cohort:weekly"
							/>
							<input
								value={newCohortName}
								onChange={(event) => setNewCohortName(event.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									border: "1px solid #DDD0BC",
									background: "#FFFFFF",
									color: "#2A3A2C",
								}}
								placeholder="Weekly Monitoring"
							/>
							<input
								value={newCohortTargetPp}
								onChange={(event) => setNewCohortTargetPp(event.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									border: "1px solid #DDD0BC",
									background: "#FFFFFF",
									color: "#2A3A2C",
								}}
								placeholder="target pp"
							/>
							<input
								value={newCohortTargetWeeks}
								onChange={(event) =>
									setNewCohortTargetWeeks(event.target.value)
								}
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									border: "1px solid #DDD0BC",
									background: "#FFFFFF",
									color: "#2A3A2C",
								}}
								placeholder="target weeks"
							/>
						</div>
						<button
							type="button"
							disabled={!hasTriggerToken || createCohortMutation.isPending}
							onClick={() => {
								void handleCreateCohort();
							}}
							className="px-3 py-2 rounded-lg text-xs font-semibold"
							style={{
								background:
									hasTriggerToken && !createCohortMutation.isPending
										? "#2A6032"
										: "#E8E0D2",
								color:
									hasTriggerToken && !createCohortMutation.isPending
										? "#FFFFFF"
										: "#9AAE9C",
								border: `1px solid ${
									hasTriggerToken && !createCohortMutation.isPending
										? "#1E4A26"
										: "#DDD0BC"
								}`,
								cursor:
									hasTriggerToken && !createCohortMutation.isPending
										? "pointer"
										: "not-allowed",
							}}
						>
							{createCohortMutation.isPending ? "Saving…" : "Save Cohort"}
						</button>
						{!hasTriggerToken && (
							<p className="text-xs" style={{ color: "#9AAE9C" }}>
								Trigger token required for cohort writes. Set it on the Runs
								page.
							</p>
						)}
						{createCohortMutation.isError && (
							<p className="text-xs" style={{ color: "#B91C1C" }}>
								{(createCohortMutation.error as Error).message}
							</p>
						)}
					</div>

					<div
						className="rounded-lg p-3 space-y-3"
						style={{ background: "#FDFCF8", border: "1px solid #EDE8E0" }}
					>
						<div className="flex items-center gap-2">
							<span
								className="text-xs font-semibold"
								style={{ color: "#5D7260" }}
							>
								Active cohort
							</span>
							<select
								value={selectedCohort?.id ?? ""}
								onChange={(event) => setSelectedCohortId(event.target.value)}
								className="rounded-md px-2 py-1 text-xs"
								style={{
									border: "1px solid #DDD0BC",
									background: "#FFFFFF",
									color: "#3D5C40",
								}}
							>
								{(cohortsQuery.data ?? []).map(
									(cohort: PromptResearchCohort) => (
										<option key={cohort.id} value={cohort.id}>
											{cohort.displayName} ({cohort.tag})
										</option>
									),
								)}
							</select>
						</div>

						{progressQuery.isLoading ? (
							<div
								className="h-16 rounded animate-pulse"
								style={{ background: "#F2EDE6" }}
							/>
						) : progressQuery.isError ? (
							<p className="text-xs" style={{ color: "#B91C1C" }}>
								{(progressQuery.error as Error).message}
							</p>
						) : progressQuery.data ? (
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
								<div
									className="rounded-md px-2 py-2"
									style={{ background: "#EEF5EF", color: "#2C5D30" }}
								>
									Baseline {progressQuery.data.baselineRate?.toFixed(2) ?? "—"}%
								</div>
								<div
									className="rounded-md px-2 py-2"
									style={{ background: "#F3F7FB", color: "#2F5B84" }}
								>
									Current {progressQuery.data.currentRate?.toFixed(2) ?? "—"}%
								</div>
								<div
									className="rounded-md px-2 py-2"
									style={{ background: "#FFF6E8", color: "#A66619" }}
								>
									Uplift {progressQuery.data.upliftPp?.toFixed(2) ?? "—"}pp
								</div>
								<div
									className="rounded-md px-2 py-2"
									style={{ background: "#F4F1FF", color: "#6A4EB0" }}
								>
									Due{" "}
									{progressQuery.data.dueDate
										? new Date(progressQuery.data.dueDate).toLocaleDateString()
										: "—"}
								</div>
							</div>
						) : (
							<p className="text-xs" style={{ color: "#9AAE9C" }}>
								No cohort progress data yet.
							</p>
						)}
					</div>
				</div>
			</section>

			<section
				className="rounded-xl border p-4 space-y-3"
				style={{ background: "#FFFFFF", borderColor: "#DDD0BC" }}
			>
				<div
					className="text-sm font-semibold tracking-tight"
					style={{ color: "#2A3A2C" }}
				>
					Optimization Queue
				</div>
				{optimizationGapsQuery.isLoading ? (
					<div
						className="h-20 rounded animate-pulse"
						style={{ background: "#F2EDE6" }}
					/>
				) : optimizationGapsQuery.isError ? (
					<p className="text-xs" style={{ color: "#B91C1C" }}>
						{(optimizationGapsQuery.error as Error).message}
					</p>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
						{OPTIMIZATION_STATUSES.map((status) => (
							<div
								key={status}
								className="rounded-lg p-2 space-y-2"
								style={{ background: "#FDFCF8", border: "1px solid #EDE8E0" }}
							>
								<div
									className="text-xs font-semibold uppercase tracking-wider"
									style={{ color: "#7A8E7C" }}
								>
									{status} ({optimizationByStatus[status].length})
								</div>
								{optimizationByStatus[status].slice(0, 8).map((gap) => (
									<div
										key={gap.id}
										className="rounded-md p-2 space-y-1"
										style={{
											background: "#FFFFFF",
											border: "1px solid #E8E0D2",
										}}
									>
										<div
											className="text-xs font-medium"
											style={{ color: "#2A3A2C" }}
										>
											{gap.topicLabel}
										</div>
										<div
											className="text-[11px] tabular-nums"
											style={{ color: "#7A8E7C" }}
										>
											Score {(gap.compositeScore * 100).toFixed(1)}% · Evidence{" "}
											{gap.evidenceCount}
										</div>
										<select
											disabled={
												!hasTriggerToken ||
												updateOptimizationStatusMutation.isPending
											}
											value={gap.status}
											onChange={(event) =>
												updateOptimizationStatusMutation.mutate({
													id: gap.id,
													status: event.target.value as ContentGapStatus,
													linkedPageUrl: gap.linkedPageUrl || undefined,
												})
											}
											className="w-full rounded-md px-2 py-1 text-[11px]"
											style={{
												border: "1px solid #DDD0BC",
												background: "#FFFFFF",
												color: "#3D5C40",
											}}
										>
											{OPTIMIZATION_STATUSES.map((option) => (
												<option key={option} value={option}>
													{option}
												</option>
											))}
										</select>
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
