export type ModelPricingProvider = 'OpenAI' | 'Anthropic' | 'Google'

export type ModelPricing = {
  model: string
  provider: ModelPricingProvider
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  sourceUrl: string
  sourceLabel: string
  sourceDate: string
  notes?: string
}

export type ResolvedModelPricing = ModelPricing & {
  requestedModel: string
  matchedBy: 'exact' | 'family'
  inferred: boolean
}

type CostBreakdown = {
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
}

const OPENAI_PRICING_URL = 'https://openai.com/api/pricing/'
const OPENAI_PLATFORM_PRICING_URL = 'https://platform.openai.com/pricing'
const ANTHROPIC_PRICING_URL = 'https://docs.claude.com/en/docs/about-claude/pricing'
const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'

const PRICING_BY_MODEL: Record<string, ModelPricing> = {
  'gpt-5.2': {
    model: 'gpt-5.2',
    provider: 'OpenAI',
    inputUsdPerMillion: 1.75,
    outputUsdPerMillion: 14,
    sourceUrl: OPENAI_PRICING_URL,
    sourceLabel: 'OpenAI API pricing',
    sourceDate: '2026-02-26',
  },
  'gpt-4o': {
    model: 'gpt-4o',
    provider: 'OpenAI',
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10,
    sourceUrl: OPENAI_PLATFORM_PRICING_URL,
    sourceLabel: 'OpenAI platform pricing',
    sourceDate: '2026-02-26',
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    provider: 'OpenAI',
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    sourceUrl: OPENAI_PLATFORM_PRICING_URL,
    sourceLabel: 'OpenAI platform pricing',
    sourceDate: '2026-02-26',
  },
  'claude-sonnet-4-5-20250929': {
    model: 'claude-sonnet-4-5-20250929',
    provider: 'Anthropic',
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    sourceUrl: ANTHROPIC_PRICING_URL,
    sourceLabel: 'Claude API pricing',
    sourceDate: '2026-02-26',
  },
  'claude-opus-4-1-20250805': {
    model: 'claude-opus-4-1-20250805',
    provider: 'Anthropic',
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    sourceUrl: ANTHROPIC_PRICING_URL,
    sourceLabel: 'Claude API pricing',
    sourceDate: '2026-02-26',
  },
  'claude-opus-4-20250514': {
    model: 'claude-opus-4-20250514',
    provider: 'Anthropic',
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    sourceUrl: ANTHROPIC_PRICING_URL,
    sourceLabel: 'Claude API pricing',
    sourceDate: '2026-02-26',
  },
  'gemini-2.5-flash': {
    model: 'gemini-2.5-flash',
    provider: 'Google',
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
    sourceUrl: GOOGLE_PRICING_URL,
    sourceLabel: 'Gemini API pricing',
    sourceDate: '2026-02-26',
  },
}

type FamilyPricingRule = {
  test: (normalizedModel: string) => boolean
  pricing: ModelPricing
  notes?: string
}

const FAMILY_RULES: FamilyPricingRule[] = [
  {
    test: (model) => model === 'gpt-5.2' || model.startsWith('gpt-5.2-'),
    pricing: PRICING_BY_MODEL['gpt-5.2'],
  },
  {
    test: (model) => model === 'gpt-4o',
    pricing: PRICING_BY_MODEL['gpt-4o'],
  },
  {
    test: (model) => model === 'gpt-4o-mini' || model.startsWith('gpt-4o-mini-'),
    pricing: PRICING_BY_MODEL['gpt-4o-mini'],
  },
  {
    test: (model) => model === 'claude-sonnet-4-5' || model.startsWith('claude-sonnet-4-5-'),
    pricing: PRICING_BY_MODEL['claude-sonnet-4-5-20250929'],
  },
  {
    test: (model) => model === 'claude-sonnet-4' || model.startsWith('claude-sonnet-4-'),
    pricing: PRICING_BY_MODEL['claude-sonnet-4-5-20250929'],
    notes: 'Claude Sonnet 4 is priced the same as Sonnet 4.5 per Claude docs.',
  },
  {
    test: (model) => model.startsWith('claude-opus-4-5'),
    pricing: PRICING_BY_MODEL['claude-opus-4-1-20250805'],
    notes:
      'Opus 4.5-specific pricing is not published in Claude docs; using Opus 4.1 rate as a fallback.',
  },
  {
    test: (model) => model === 'claude-opus-4-1' || model.startsWith('claude-opus-4-1-'),
    pricing: PRICING_BY_MODEL['claude-opus-4-1-20250805'],
  },
  {
    test: (model) => model === 'claude-opus-4' || model.startsWith('claude-opus-4-'),
    pricing: PRICING_BY_MODEL['claude-opus-4-20250514'],
  },
  {
    test: (model) => model === 'gemini-2.5-flash' || model.startsWith('gemini-2.5-flash-'),
    pricing: PRICING_BY_MODEL['gemini-2.5-flash'],
  },
]

export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase()
}

export function getResolvedModelPricing(model: string): ResolvedModelPricing | null {
  const normalized = normalizeModelId(model)
  if (!normalized) return null

  const exact = PRICING_BY_MODEL[normalized]
  if (exact) {
    return {
      ...exact,
      requestedModel: model,
      matchedBy: 'exact',
      inferred: false,
    }
  }

  const familyRule = FAMILY_RULES.find((rule) => rule.test(normalized))
  if (!familyRule) return null

  return {
    ...familyRule.pricing,
    requestedModel: model,
    matchedBy: 'family',
    inferred: true,
    notes: familyRule.notes ?? familyRule.pricing.notes,
  }
}

export function calculateTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: Pick<ModelPricing, 'inputUsdPerMillion' | 'outputUsdPerMillion'>,
): CostBreakdown {
  const safeInput = Math.max(0, Math.round(inputTokens))
  const safeOutput = Math.max(0, Math.round(outputTokens))
  const inputCostUsd = (safeInput / 1_000_000) * pricing.inputUsdPerMillion
  const outputCostUsd = (safeOutput / 1_000_000) * pricing.outputUsdPerMillion
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  }
}

export function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  const abs = Math.abs(safe)
  const minimumFractionDigits = abs > 0 && abs < 0.01 ? 4 : 2
  const maximumFractionDigits = abs > 0 && abs < 0.01 ? 6 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(safe)
}

export function formatUsdPerMillion(value: number): string {
  return `${formatUsd(value)} / 1M`
}

export const MODEL_PRICING_CATALOG: ModelPricing[] = Object.values(PRICING_BY_MODEL).sort(
  (left, right) => left.model.localeCompare(right.model),
)
