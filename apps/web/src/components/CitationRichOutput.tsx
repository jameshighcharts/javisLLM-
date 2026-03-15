/* biome-ignore-all lint/suspicious/noArrayIndexKey: display-only mapped lists in this file */
import { type ReactNode, useMemo } from "react";
import type { CitationRef } from "../types";

type CitationRichOutputVariant = "default" | "search-cache";

type CitationPanelItem = {
	id: string;
	url: string | null;
	title: string;
	host: string;
	snippet: string;
};

function isValidCitationBounds(
	ref: CitationRef,
	textLength: number,
): ref is CitationRef & { startIndex: number; endIndex: number } {
	return (
		typeof ref.startIndex === "number" &&
		Number.isFinite(ref.startIndex) &&
		typeof ref.endIndex === "number" &&
		Number.isFinite(ref.endIndex) &&
		ref.startIndex >= 0 &&
		ref.endIndex > ref.startIndex &&
		ref.endIndex <= textLength
	);
}

function truncate(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeCitationHost(url: string): string {
	const trimmed = String(url || "").trim();
	if (!trimmed) return "";
	try {
		return new URL(trimmed).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return "";
	}
}

function toPanelItemFromRef(
	ref: CitationRef,
	index: number,
): CitationPanelItem {
	const url = String(ref.url || "").trim();
	const host = String(ref.host || "").trim() || normalizeCitationHost(url);
	const title =
		String(ref.title || "").trim() || host || url || `Source ${index + 1}`;
	const snippet = String(ref.snippet || "").trim();
	return {
		id: String(ref.id || `ref-${index}`),
		url: url || null,
		title,
		host,
		snippet,
	};
}

function toPanelItemFromFallbackCitation(
	raw: string,
	index: number,
): CitationPanelItem | null {
	const value = String(raw || "").trim();
	if (!value) return null;
	const isLink = /^https?:\/\//i.test(value);
	const host = isLink ? normalizeCitationHost(value) : "";
	return {
		id: `fallback-${index}`,
		url: isLink ? value : null,
		title: host || value,
		host,
		snippet: "",
	};
}

type CitationRichOutputProps = {
	text: string;
	citationRefs?: CitationRef[];
	citations?: string[];
	emptyText?: string;
	query?: string | null;
	variant?: CitationRichOutputVariant;
};

export default function CitationRichOutput({
	text,
	citationRefs = [],
	citations = [],
	emptyText = "No output text recorded.",
	query,
	variant = "default",
}: CitationRichOutputProps) {
	const isSearchCacheVariant = variant === "search-cache";
	const normalizedText = text ?? "";
	const normalizedQuery = String(query || "").trim();
	const normalizedRefs = Array.isArray(citationRefs) ? citationRefs : [];

	const orderedRefs = useMemo(() => {
		const seen = new Set<string>();
		const refs = normalizedRefs
			.filter((ref) => typeof ref.url === "string" && ref.url.trim().length > 0)
			.slice()
			.sort((left, right) => {
				const leftEnd =
					typeof left.endIndex === "number" && Number.isFinite(left.endIndex)
						? left.endIndex
						: Number.POSITIVE_INFINITY;
				const rightEnd =
					typeof right.endIndex === "number" && Number.isFinite(right.endIndex)
						? right.endIndex
						: Number.POSITIVE_INFINITY;
				if (leftEnd !== rightEnd) return leftEnd - rightEnd;
				return left.url.localeCompare(right.url);
			});
		return refs.filter((ref) => {
			const key = `${ref.url}|${ref.title}|${ref.host}|${ref.startIndex ?? ""}|${ref.endIndex ?? ""}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [normalizedRefs]);

	const anchoredRefs = useMemo(
		() =>
			orderedRefs.filter((ref) =>
				isValidCitationBounds(ref, normalizedText.length),
			),
		[orderedRefs, normalizedText.length],
	);

	const inlineText = useMemo(() => {
		if (!normalizedText) return null;
		if (anchoredRefs.length === 0) return normalizedText;

		const refsByEnd = new Map<number, CitationRef[]>();
		for (const ref of anchoredRefs) {
			const endIndex = ref.endIndex as number;
			const bucket = refsByEnd.get(endIndex) ?? [];
			bucket.push(ref);
			refsByEnd.set(endIndex, bucket);
		}

		const nodes: ReactNode[] = [];
		const orderedEnds = [...refsByEnd.keys()].sort(
			(left, right) => left - right,
		);
		let cursor = 0;

		for (const endIndex of orderedEnds) {
			if (endIndex > cursor) {
				nodes.push(normalizedText.slice(cursor, endIndex));
				cursor = endIndex;
			}
			const refsForEnd = refsByEnd.get(endIndex) ?? [];
			for (const ref of refsForEnd) {
				const label = truncate(ref.title || ref.host || "source", 28);
				const pillStyles = isSearchCacheVariant
					? {
							border: "1px solid #D8DEE6",
							background: "#EFF3F8",
							color: "#334155",
							fontSize: 9,
							fontWeight: 700,
							lineHeight: "14px",
						}
					: {
							border: "1px solid #DDD0BC",
							background: "#F2EDE6",
							color: "#3D5840",
							fontSize: 10,
							fontWeight: 600,
							lineHeight: "15px",
						};
				nodes.push(
					<a
						key={`inline-${ref.id || ref.url}-${endIndex}`}
						href={ref.url}
						target="_blank"
						rel="noreferrer"
						style={{
							display: "inline-flex",
							alignItems: "center",
							marginLeft: 6,
							marginRight: 2,
							marginTop: 1,
							marginBottom: 1,
							padding: "1px 8px",
							borderRadius: 999,
							border: pillStyles.border,
							background: pillStyles.background,
							color: pillStyles.color,
							fontSize: pillStyles.fontSize,
							fontWeight: pillStyles.fontWeight,
							lineHeight: pillStyles.lineHeight,
							textDecoration: "none",
							verticalAlign: "middle",
						}}
					>
						{label}
					</a>,
				);
			}
		}

		if (cursor < normalizedText.length) {
			nodes.push(normalizedText.slice(cursor));
		}

		return nodes;
	}, [anchoredRefs, isSearchCacheVariant, normalizedText]);

	const fallbackCitationUrls = useMemo(() => {
		if (orderedRefs.length > 0) {
			return orderedRefs.map((ref) => ref.url);
		}
		return [
			...new Set(
				(citations ?? [])
					.map((item) => String(item ?? "").trim())
					.filter(Boolean),
			),
		];
	}, [citations, orderedRefs]);

	const panelItems = useMemo(() => {
		if (orderedRefs.length > 0) {
			return orderedRefs.map((ref, index) => toPanelItemFromRef(ref, index));
		}
		return fallbackCitationUrls
			.map((citation, index) =>
				toPanelItemFromFallbackCitation(citation, index),
			)
			.filter((item): item is CitationPanelItem => Boolean(item));
	}, [fallbackCitationUrls, orderedRefs]);

	const showAnchoredLayout = anchoredRefs.length > 0;
	const showSidebar = panelItems.length > 0;

	if (!normalizedText.trim()) {
		if (isSearchCacheVariant) {
			return (
				<div
					className="rounded-xl px-4 py-4 text-sm"
					style={{
						background: "#FFFFFF",
						border: "1px solid #DDD0BC",
						color: "#6B7280",
					}}
				>
					{emptyText}
				</div>
			);
		}
		return (
			<div
				className="rounded-lg px-3 py-3 text-sm"
				style={{
					background: "#FDFCF8",
					border: "1px solid #F2EDE6",
					color: "#9AAE9C",
				}}
			>
				{emptyText}
			</div>
		);
	}

	if (isSearchCacheVariant) {
		return (
			<div
				className="rounded-xl overflow-hidden"
				style={{ background: "#FFFFFF", border: "1px solid #DDD0BC" }}
			>
				{normalizedQuery ? (
					<div
						className="px-3 sm:px-4 py-3"
						style={{ background: "#F4F5F7", borderBottom: "1px solid #E5E7EB" }}
					>
						<div
							className="inline-flex max-w-full rounded-2xl px-3 py-2 text-sm break-words"
							style={{
								background: "#E9ECF1",
								color: "#111827",
								lineHeight: 1.4,
							}}
						>
							{normalizedQuery}
						</div>
					</div>
				) : null}

				<div
					className={
						showSidebar
							? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(250px,330px)]"
							: "grid grid-cols-1"
					}
				>
					<div
						className="px-3 sm:px-5 py-4 sm:py-5 text-sm whitespace-pre-wrap"
						style={{ color: "#111827", lineHeight: 1.65 }}
					>
						{inlineText}
					</div>

					{showSidebar ? (
						<aside
							className="px-3 sm:px-4 py-4 border-t lg:border-t-0 lg:border-l"
							style={{ borderColor: "#E5E7EB", background: "#FAFAFB" }}
						>
							<div
								className="text-xs font-semibold uppercase tracking-wide"
								style={{ color: "#6B7280", marginBottom: 10 }}
							>
								Citations
							</div>
							<div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
								{panelItems.map((item, index) => {
									const citationBody = (
										<>
											<div
												className="text-[10px] font-medium"
												style={{ color: "#6B7280", marginBottom: 3 }}
											>
												#{index + 1} · {item.host || "source"}
											</div>
											<div
												className="text-xs font-semibold"
												style={{ color: "#111827", lineHeight: 1.35 }}
											>
												{truncate(item.title, 110)}
											</div>
											{item.snippet ? (
												<div
													className="text-[11px]"
													style={{
														color: "#4B5563",
														lineHeight: 1.4,
														marginTop: 4,
													}}
												>
													{truncate(item.snippet, 160)}
												</div>
											) : null}
										</>
									);

									if (!item.url) {
										return (
											<div
												key={item.id}
												className="block rounded-lg px-3 py-2"
												style={{
													border: "1px solid #E5E7EB",
													background: "#FFFFFF",
												}}
											>
												{citationBody}
											</div>
										);
									}

									return (
										<a
											key={item.id}
											href={item.url}
											target="_blank"
											rel="noreferrer"
											className="block rounded-lg px-3 py-2"
											style={{
												border: "1px solid #E5E7EB",
												background: "#FFFFFF",
												textDecoration: "none",
											}}
										>
											{citationBody}
										</a>
									);
								})}
							</div>
						</aside>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div
			className="grid gap-3"
			style={{
				gridTemplateColumns: showAnchoredLayout
					? "minmax(0, 1fr) minmax(230px, 300px)"
					: "1fr",
			}}
		>
			<div
				className="rounded-lg px-3 py-3 text-sm whitespace-pre-wrap"
				style={{
					background: "#FDFCF8",
					border: "1px solid #F2EDE6",
					color: "#2A3A2C",
					lineHeight: 1.5,
				}}
			>
				{inlineText}
			</div>

			{showAnchoredLayout ? (
				<div
					className="rounded-lg px-3 py-3"
					style={{ background: "#FFFFFF", border: "1px solid #E5DDD0" }}
				>
					<div
						className="text-[10px] font-semibold uppercase tracking-wide"
						style={{ color: "#9AAE9C", marginBottom: 8 }}
					>
						Citations
					</div>
					<div className="space-y-2">
						{orderedRefs.map((ref, index) => (
							<a
								key={`panel-${ref.id || ref.url}-${index}`}
								href={ref.url}
								target="_blank"
								rel="noreferrer"
								style={{
									display: "block",
									textDecoration: "none",
									background: "#FDFCF8",
									border: "1px solid #F2EDE6",
									borderRadius: 8,
									padding: "8px 9px",
								}}
							>
								<div
									style={{ fontSize: 10, color: "#9AAE9C", marginBottom: 2 }}
								>
									#{index + 1} · {ref.host || "source"}
								</div>
								<div
									style={{
										fontSize: 11,
										color: "#2A3A2C",
										fontWeight: 600,
										lineHeight: 1.3,
										marginBottom: ref.snippet ? 3 : 0,
									}}
								>
									{truncate(ref.title || ref.url, 70)}
								</div>
								{ref.snippet && (
									<div
										style={{ fontSize: 11, color: "#607860", lineHeight: 1.35 }}
									>
										{truncate(ref.snippet, 130)}
									</div>
								)}
							</a>
						))}
					</div>
				</div>
			) : fallbackCitationUrls.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{fallbackCitationUrls.slice(0, 8).map((citation, index) => {
						const isLink = /^https?:\/\//i.test(citation);
						if (isLink) {
							return (
								<a
									key={`fallback-link-${index}`}
									href={citation}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
									style={{
										background: "#F2EDE6",
										color: "#3D5840",
										border: "1px solid #DDD0BC",
									}}
								>
									source {index + 1}
								</a>
							);
						}
						return (
							<span
								key={`fallback-text-${index}`}
								className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
								style={{
									background: "#F2EDE6",
									color: "#3D5840",
									border: "1px solid #DDD0BC",
								}}
							>
								{truncate(citation, 64)}
							</span>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
