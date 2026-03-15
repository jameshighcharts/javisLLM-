import type { CitationRef } from "../types";

export interface CitationSourceInput {
	responseId?: string | number;
	citationRefs?: CitationRef[] | null;
	citations?: string[] | null;
}

export interface CitationSourceStat {
	key: string;
	host: string;
	title: string;
	primaryUrl: string;
	citationCount: number;
	responseCount: number;
	uniqueUrlCount: number;
	providers: string[];
}

export function normalizeCitationHost(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	try {
		return new URL(trimmed).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return (
			trimmed
				.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
				.split("/")[0]
				.split("?")[0]
				.split("#")[0]
				.split("@")
				.at(-1)
				?.split(":")[0]
				?.toLowerCase()
				.replace(/^www\./, "")
				.trim() || ""
		);
	}
}

type AggregationBucket = {
	key: string;
	host: string;
	title: string;
	primaryUrl: string;
	citationCount: number;
	urls: Set<string>;
	responseIds: Set<string>;
	providers: Set<string>;
};

function normalizeRefUrl(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim();
}

function normalizeProvider(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim().toLowerCase();
}

function collectResponseRefs(input: CitationSourceInput): CitationRef[] {
	const refs = Array.isArray(input.citationRefs) ? input.citationRefs : [];
	if (refs.length > 0) {
		return refs
			.map((ref) => ({
				...ref,
				url: normalizeRefUrl(ref.url),
				host: normalizeCitationHost(ref.host || ref.url || ""),
				title: typeof ref.title === "string" ? ref.title.trim() : "",
			}))
			.filter((ref) => ref.url.length > 0);
	}

	const urls = Array.isArray(input.citations) ? input.citations : [];
	return urls
		.map((url, index) => {
			const normalizedUrl = normalizeRefUrl(url);
			const host = normalizeCitationHost(normalizedUrl);
			return {
				id: `legacy-${index + 1}`,
				url: normalizedUrl,
				host,
				title: host || normalizedUrl,
				provider: "openai",
			} satisfies CitationRef;
		})
		.filter((ref) => ref.url.length > 0);
}

export function aggregateCitationSources(
	inputs: CitationSourceInput[],
): CitationSourceStat[] {
	const buckets = new Map<string, AggregationBucket>();

	inputs.forEach((input, index) => {
		const responseId = String(input.responseId ?? `row-${index + 1}`);
		const refs = collectResponseRefs(input);
		const seenForResponse = new Set<string>();

		refs.forEach((ref) => {
			const url = normalizeRefUrl(ref.url);
			if (!url) return;
			const host = normalizeCitationHost(ref.host || url) || url;
			const key = host;

			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = {
					key,
					host,
					title: ref.title?.trim() || host,
					primaryUrl: url,
					citationCount: 0,
					urls: new Set<string>(),
					responseIds: new Set<string>(),
					providers: new Set<string>(),
				};
				buckets.set(key, bucket);
			}

			bucket.citationCount += 1;
			bucket.urls.add(url);
			const provider = normalizeProvider(ref.provider);
			if (provider) {
				bucket.providers.add(provider);
			}
			if (!seenForResponse.has(key)) {
				seenForResponse.add(key);
				bucket.responseIds.add(responseId);
			}

			const normalizedTitle =
				typeof ref.title === "string" ? ref.title.trim() : "";
			if (
				normalizedTitle &&
				(bucket.title === bucket.host || bucket.title === bucket.primaryUrl)
			) {
				bucket.title = normalizedTitle;
			}
			if (!bucket.primaryUrl || bucket.primaryUrl === bucket.host) {
				bucket.primaryUrl = url;
			}
		});
	});

	return [...buckets.values()]
		.map((bucket) => ({
			key: bucket.key,
			host: bucket.host,
			title: bucket.title,
			primaryUrl: bucket.primaryUrl,
			citationCount: bucket.citationCount,
			responseCount: bucket.responseIds.size,
			uniqueUrlCount: bucket.urls.size,
			providers: [...bucket.providers.values()].sort((left, right) =>
				left.localeCompare(right),
			),
		}))
		.sort((left, right) => {
			if (right.citationCount !== left.citationCount) {
				return right.citationCount - left.citationCount;
			}
			if (right.responseCount !== left.responseCount) {
				return right.responseCount - left.responseCount;
			}
			if (right.uniqueUrlCount !== left.uniqueUrlCount) {
				return right.uniqueUrlCount - left.uniqueUrlCount;
			}
			return left.host.localeCompare(right.host);
		});
}
