export interface BenchmarkModelOption {
  value: string
  label: string
  owner: 'OpenAI' | 'Anthropic' | 'Google' | 'Unknown'
}

export const BENCHMARK_MODEL_OPTIONS: BenchmarkModelOption[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini', owner: 'OpenAI' },
  { value: 'gpt-4o', label: 'GPT-4o', owner: 'OpenAI' },
  { value: 'gpt-5.2', label: 'GPT 5.2', owner: 'OpenAI' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', owner: 'Anthropic' },
  { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5', owner: 'Anthropic' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', owner: 'Google' },
]

export const BENCHMARK_MODEL_VALUES = BENCHMARK_MODEL_OPTIONS.map((option) => option.value)

export function inferModelOwnerFromModelId(model: string): string {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return 'Unknown'
  if (
    normalized.startsWith('gpt') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('openai/')
  ) {
    return 'OpenAI'
  }
  if (normalized.startsWith('claude') || normalized.startsWith('anthropic/')) {
    return 'Anthropic'
  }
  if (normalized.startsWith('gemini') || normalized.startsWith('google/')) {
    return 'Google'
  }
  return 'Unknown'
}

export function dedupeModels(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}
