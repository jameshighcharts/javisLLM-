const VISIBILITY_PRESENCE_WEIGHT = 0.7;
const VISIBILITY_SHARE_OF_VOICE_WEIGHT = 0.3;

function roundTo(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function computeMentionRate(
	mentionsCount: number,
	responseCount: number,
): number {
	if (responseCount <= 0) {
		return 0;
	}
	return roundTo(mentionsCount / responseCount, 6);
}

export function computeMentionRatePct(
	mentionsCount: number,
	responseCount: number,
): number {
	return roundTo(computeMentionRate(mentionsCount, responseCount) * 100, 2);
}

export function computeShareOfVoiceRate(
	mentionsCount: number,
	totalMentions: number,
): number {
	if (totalMentions <= 0) {
		return 0;
	}
	return roundTo(mentionsCount / totalMentions, 6);
}

export function computeShareOfVoicePct(
	mentionsCount: number,
	totalMentions: number,
): number {
	return roundTo(
		computeShareOfVoiceRate(mentionsCount, totalMentions) * 100,
		2,
	);
}

export function computeAiVisibilityScore(
	presenceRate: number,
	shareOfVoiceRate: number,
): number {
	return roundTo(
		(VISIBILITY_PRESENCE_WEIGHT * presenceRate +
			VISIBILITY_SHARE_OF_VOICE_WEIGHT * shareOfVoiceRate) *
			100,
		2,
	);
}

export function computeAiVisibilityScoreFromCounts(
	mentionsCount: number,
	responseCount: number,
	totalMentions: number,
): number {
	return computeAiVisibilityScore(
		computeMentionRate(mentionsCount, responseCount),
		computeShareOfVoiceRate(mentionsCount, totalMentions),
	);
}
