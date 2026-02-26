export interface BenchmarkModelOption {
  value: string
  label: string
  owner: 'OpenAI' | 'Anthropic' | 'Google' | 'Unknown'
}

export const BENCHMARK_MODEL_OPTIONS: BenchmarkModelOption[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini', owner: 'OpenAI' },
  { value: 'gpt-4o', label: 'GPT-4o', owner: 'OpenAI' },
  { value: 'gpt-5.2', label: 'GPT 5.2', owner: 'OpenAI' },
  { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', owner: 'Anthropic' },
  { value: 'claude-4-6-sonnet-latest', label: 'Claude Sonnet 4.6', owner: 'Anthropic' },
  { value: 'claude-4-6-opus-latest', label: 'Claude Opus 4.6', owner: 'Anthropic' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', owner: 'Google' },
  { value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', owner: 'Google' },
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
