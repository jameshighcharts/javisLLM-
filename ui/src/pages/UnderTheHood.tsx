import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../api'
import type { UnderTheHoodRange } from '../types'
import {
  calculateTokenCostUsd,
  formatUsd,
  formatUsdPerMillion,
  getResolvedModelPricing,
  MODEL_PRICING_CATALOG,
} from '../utils/modelPricing'

const UNDER_THE_HOOD_RANGE_OPTIONS: Array<{ value: UnderTheHoodRange; label: string }> = [
  { value: '1d', label: '1d' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All time' },
]

// Shorten model names for chart labels
function shortModelName(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/^gemini-/, 'gemini-')
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

function formatDurationMs(value: number): string {
  const safe = Math.max(0, Math.round(value))
  if (safe < 1000) return `${safe} ms`
  return `${(safe / 1000).toFixed(2)} s`
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'n/a'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'n/a'
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString()
}

// ── Shared chart theme ──────────────────────────────────────────────────────
const CHART_BASE: Highcharts.Options = {
  chart: {
    backgroundColor: 'transparent',
    style: { fontFamily: 'inherit' },
    spacing: [12, 8, 12, 8],
  },
  credits: { enabled: false },
  title: { text: undefined },
  legend: {
    enabled: true,
    align: 'left',
    verticalAlign: 'top',
    itemStyle: { fontSize: '11px', fontWeight: '600', color: '#5A7060' },
    itemHoverStyle: { color: '#1E2E20' },
    symbolRadius: 3,
  },
  tooltip: {
    backgroundColor: '#1E2E20',
    borderColor: 'transparent',
    borderRadius: 10,
    style: { color: '#FFFFFF', fontSize: '12px' },
    shared: true,
  },
  plotOptions: {
    bar: {
      stacking: 'normal',
      borderRadius: 4,
      groupPadding: 0.12,
      pointPadding: 0.06,
    },
  },
  xAxis: {
    lineColor: '#EDE7DA',
    tickColor: 'transparent',
    labels: { style: { fontSize: '11px', color: '#7A8E7C' } },
  },
  yAxis: {
    gridLineColor: '#F0EBE2',
    labels: { style: { fontSize: '10px', color: '#9AAE9C' } },
    title: { text: undefined },
  },
}

// ── StatCard ────────────────────────────────────────────────────────────────
function StatCard({ label, value, help, accent }: {
  label: string; value: string; help?: string; accent?: 'green'
}) {
  return (
    <div className="rounded-xl border px-4 py-4 flex flex-col gap-1" style={{ background: '#FFFFFF', borderColor: '#E5DDD0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A8B8AA' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: accent === 'green' ? '#2A5C2E' : '#1E2E20', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {help && <div style={{ fontSize: 11, color: '#9AAE9C', marginTop: 1 }}>{help}</div>}
    </div>
  )
}

// ── SectionLabel ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#B4C4B6', whiteSpace: 'nowrap' }}>{children}</span>
      <div className="flex-1 h-px" style={{ background: '#EAE2D6' }} />
    </div>
  )
}

// ── Calculator Modal ─────────────────────────────────────────────────────────
function CalculatorModal({
  open, onClose,
  modelOptions, selectedModel, onModelChange,
  promptCount, onPromptCountChange,
  inputTokens, onInputTokensChange,
  outputTokens, onOutputTokensChange,
  pricing, costPerPrompt, totalCost, promptCountValue,
}: {
  open: boolean; onClose: () => void;
  modelOptions: string[]; selectedModel: string; onModelChange: (v: string) => void;
  promptCount: number; onPromptCountChange: (v: number) => void;
  inputTokens: number; onInputTokensChange: (v: number) => void;
  outputTokens: number; onOutputTokensChange: (v: number) => void;
  pricing: ReturnType<typeof getResolvedModelPricing>;
  costPerPrompt: ReturnType<typeof calculateTokenCostUsd> | null;
  totalCost: number; promptCountValue: number;
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,30,22,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: '#FFFFFF', border: '1px solid #DDD0BC' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #F0E8DC', background: '#FDFCF8' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1E2E20', letterSpacing: '-0.02em' }}>API Cost Calculator</div>
            <div style={{ fontSize: 12, color: '#8FA191', marginTop: 2 }}>Estimate spend from input/output tokens for a selected model.</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: '#F2EDE6', border: '1px solid #DDD0BC', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7A8E7C" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Inputs grid */}
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 space-y-1.5">
              <div style={{ fontSize: 11, fontWeight: 600, color: '#7A8E7C' }}>Model</div>
              <select
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm"
                style={{ border: '1px solid #DDD0BC', background: '#FDFCF8', color: '#2A3A2C', outline: 'none' }}
              >
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            {[
              { label: 'Prompt count', value: promptCount, onChange: onPromptCountChange },
              { label: 'Input tokens / prompt', value: inputTokens, onChange: onInputTokensChange },
              { label: 'Output tokens / prompt', value: outputTokens, onChange: onOutputTokensChange },
            ].map(({ label, value, onChange }) => (
              <label key={label} className="space-y-1.5">
                <div style={{ fontSize: 11, fontWeight: 600, color: '#7A8E7C' }}>{label}</div>
                <input
                  type="number" min={0} step={1} value={value}
                  onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm tabular-nums"
                  style={{ border: '1px solid #DDD0BC', background: '#FDFCF8', color: '#2A3A2C', outline: 'none' }}
                />
              </label>
            ))}
          </div>

          {/* Results */}
          {pricing ? (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E0D8CC' }}>
              <div className="px-4 py-3 flex flex-wrap gap-4" style={{ background: '#F5F0E8', borderBottom: '1px solid #E8E0D2' }}>
                <div>
                  <span style={{ fontSize: 10, color: '#9AAE9C' }}>Input </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2A3A2C', fontVariantNumeric: 'tabular-nums' }}>{formatUsdPerMillion(pricing.inputUsdPerMillion)}</span>
                </div>
                <div>
                  <span style={{ fontSize: 10, color: '#9AAE9C' }}>Output </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2A3A2C', fontVariantNumeric: 'tabular-nums' }}>{formatUsdPerMillion(pricing.outputUsdPerMillion)}</span>
                </div>
                <span style={{ fontSize: 10, color: '#B4C4B6' }}>{pricing.sourceLabel} · {pricing.sourceDate}</span>
              </div>
              <div className="divide-y" style={{ background: '#FFFFFF', borderColor: '#F0E8DC' }}>
                {[
                  { label: 'Input cost / prompt', val: formatUsd(costPerPrompt?.inputCostUsd ?? 0), muted: true },
                  { label: 'Output cost / prompt', val: formatUsd(costPerPrompt?.outputCostUsd ?? 0), muted: true },
                  { label: 'Cost / prompt', val: formatUsd(costPerPrompt?.totalCostUsd ?? 0), muted: false },
                ].map(({ label, val, muted }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5">
                    <span style={{ fontSize: 12, color: muted ? '#8FA191' : '#3D5840', fontWeight: muted ? 400 : 600 }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: muted ? '#5A7060' : '#2A3A2C', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-4 py-3" style={{ background: '#EEF5EF', borderTop: '1px solid #C8DDC9' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#2A5C2E' }}>Total ({formatInteger(promptCountValue)} prompt{promptCountValue === 1 ? '' : 's'})</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#2A5C2E', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{formatUsd(totalCost)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FFFBEB', border: '1px solid #FCD34D', color: '#92400E' }}>Pricing not found for this model.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function UnderTheHood() {
  const [selectedRange, setSelectedRange] = useState<UnderTheHoodRange>('30d')
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)

  const underTheHood = useQuery({
    queryKey: ['under-the-hood', selectedRange],
    queryFn: () => api.underTheHood(selectedRange),
    refetchInterval: 300_000,
  })

  const [calculatorModel, setCalculatorModel] = useState<string>('gpt-4o-mini')
  const [calculatorInputTokens, setCalculatorInputTokens] = useState<number>(1200)
  const [calculatorOutputTokens, setCalculatorOutputTokens] = useState<number>(650)
  const [calculatorPromptCount, setCalculatorPromptCount] = useState<number>(1)

  const summary = underTheHood.data?.summary
  const stats = useMemo(
    () =>
      summary
        ? [...summary.modelStats].sort((l, r) =>
            r.responseCount !== l.responseCount
              ? r.responseCount - l.responseCount
              : l.model.localeCompare(r.model),
          )
        : [],
    [summary],
  )

  const statsWithCosts = useMemo(
    () =>
      stats.map((item) => {
        const pricing = getResolvedModelPricing(item.model)
        const costs = pricing
          ? calculateTokenCostUsd(item.totalInputTokens, item.totalOutputTokens, pricing)
          : null
        const avgCostPerResponseUsd =
          costs && item.responseCount > 0 ? costs.totalCostUsd / item.responseCount : null
        return { ...item, pricing, costs, avgCostPerResponseUsd }
      }),
    [stats],
  )

  const pricingSources = useMemo(() => {
    const sourceMap = new Map<string, { label: string; url: string; date: string }>()
    for (const pricing of MODEL_PRICING_CATALOG) {
      sourceMap.set(pricing.sourceUrl, { label: pricing.sourceLabel, url: pricing.sourceUrl, date: pricing.sourceDate })
    }
    return [...sourceMap.values()]
  }, [])

  const calculatorModelOptions = useMemo(
    () =>
      [...new Set([
        ...statsWithCosts.map((i) => i.model),
        ...MODEL_PRICING_CATALOG.map((i) => i.model),
      ])].sort((l, r) => l.localeCompare(r)),
    [statsWithCosts],
  )
  const aggregatedChartModels = useMemo(
    () =>
      [...statsWithCosts.reduce((map, item) => {
        const label = shortModelName(item.model)
        const existing = map.get(label)
        if (existing) {
          existing.responseCount += item.responseCount
          existing.totalInputTokens += item.totalInputTokens
          existing.totalOutputTokens += item.totalOutputTokens
          if (item.costs) {
            existing.inputCostUsd += item.costs.inputCostUsd
            existing.outputCostUsd += item.costs.outputCostUsd
            existing.hasCosts = true
          }
          return map
        }

        map.set(label, {
          label,
          responseCount: item.responseCount,
          totalInputTokens: item.totalInputTokens,
          totalOutputTokens: item.totalOutputTokens,
          inputCostUsd: item.costs?.inputCostUsd ?? 0,
          outputCostUsd: item.costs?.outputCostUsd ?? 0,
          hasCosts: Boolean(item.costs),
        })
        return map
      }, new Map<string, {
        label: string
        responseCount: number
        totalInputTokens: number
        totalOutputTokens: number
        inputCostUsd: number
        outputCostUsd: number
        hasCosts: boolean
      }>()).values()]
        .sort((l, r) =>
          r.responseCount !== l.responseCount
            ? r.responseCount - l.responseCount
            : l.label.localeCompare(r.label),
        ),
    [statsWithCosts],
  )

  if (underTheHood.isError) {
    return (
      <div className="rounded-xl p-5 text-sm" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
        {(underTheHood.error as Error).message}
      </div>
    )
  }

  if (underTheHood.isLoading || !summary) {
    return (
      <div className="space-y-5 max-w-[1280px]">
        <div className="h-24 rounded-2xl animate-pulse" style={{ background: '#EDE7DA' }} />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-64 rounded-xl animate-pulse" style={{ background: '#F2EDE6' }} />
          <div className="h-64 rounded-xl animate-pulse" style={{ background: '#F2EDE6' }} />
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: '#F2EDE6' }} />
          ))}
        </div>
      </div>
    )
  }

  // ── Derived totals ──────────────────────────────────────────────────────
  const estimatedTotalCostUsd = statsWithCosts.reduce((s, i) => s + (i.costs?.totalCostUsd ?? 0), 0)
  const estimatedInputCostUsd = statsWithCosts.reduce((s, i) => s + (i.costs?.inputCostUsd ?? 0), 0)
  const estimatedOutputCostUsd = statsWithCosts.reduce((s, i) => s + (i.costs?.outputCostUsd ?? 0), 0)
  const pricedResponses = statsWithCosts.reduce((s, i) => s + (i.costs ? i.responseCount : 0), 0)
  const avgCostPerResponseUsd = pricedResponses > 0 ? estimatedTotalCostUsd / pricedResponses : 0
  const avgCostPerPromptUsd = summary.queryCount > 0 ? estimatedTotalCostUsd / summary.queryCount : 0
  const pricedModelCount = statsWithCosts.filter((i) => Boolean(i.costs)).length
  const unpricedModels = statsWithCosts.filter((i) => !i.costs).map((i) => i.model)

  // ── Calculator ─────────────────────────────────────────────────────────
  const selectedCalculatorModel = calculatorModelOptions.includes(calculatorModel)
    ? calculatorModel : (calculatorModelOptions[0] ?? 'gpt-4o-mini')
  const selectedCalculatorPricing = getResolvedModelPricing(selectedCalculatorModel)
  const calculatorCostPerPrompt = selectedCalculatorPricing
    ? calculateTokenCostUsd(calculatorInputTokens, calculatorOutputTokens, selectedCalculatorPricing)
    : null
  const calculatorTotalCostUsd = (calculatorCostPerPrompt?.totalCostUsd ?? 0) * Math.max(0, calculatorPromptCount)

  // ── Chart data ──────────────────────────────────────────────────────────
  const chartModels = aggregatedChartModels.filter((i) => i.totalInputTokens + i.totalOutputTokens > 0)
  const chartLabels = chartModels.map((i) => i.label)

  const tokenChartOptions: Highcharts.Options = {
    ...CHART_BASE,
    chart: { ...CHART_BASE.chart, type: 'bar', height: 280 },
    xAxis: { ...CHART_BASE.xAxis, categories: chartLabels },
    yAxis: {
      ...CHART_BASE.yAxis,
      title: { text: undefined },
      labels: {
        style: { fontSize: '10px', color: '#9AAE9C' },
        formatter() { return (this.value as number) >= 1_000_000 ? `${((this.value as number) / 1_000_000).toFixed(1)}M` : (this.value as number) >= 1_000 ? `${((this.value as number) / 1_000).toFixed(0)}K` : String(this.value) },
      },
    },
    tooltip: {
      ...CHART_BASE.tooltip,
      formatter() {
        const pts = (this as Highcharts.TooltipFormatterContextObject).points ?? []
        const total = pts.reduce((s, p) => s + (p.y ?? 0), 0)
        const rows = pts.map((p) => `<span style="color:${p.color as string}">●</span> ${p.series.name}: <b>${(p.y as number).toLocaleString()}</b>`).join('<br/>')
        return `<b>${(this as Highcharts.TooltipFormatterContextObject).x as string}</b><br/>${rows}<br/><span style="opacity:0.7">Total: ${total.toLocaleString()}</span>`
      },
    },
    series: [
      { name: 'Input tokens', type: 'bar', data: chartModels.map((i) => i.totalInputTokens), color: '#8FBB93' },
      { name: 'Output tokens', type: 'bar', data: chartModels.map((i) => i.totalOutputTokens), color: '#2A5C2E' },
    ],
  }

  const costChartModels = aggregatedChartModels.filter((i) => i.hasCosts)
  const costChartLabels = costChartModels.map((i) => i.label)

  const costChartOptions: Highcharts.Options = {
    ...CHART_BASE,
    chart: { ...CHART_BASE.chart, type: 'bar', height: 280 },
    xAxis: { ...CHART_BASE.xAxis, categories: costChartLabels },
    yAxis: {
      ...CHART_BASE.yAxis,
      title: { text: undefined },
      labels: {
        style: { fontSize: '10px', color: '#9AAE9C' },
        formatter() { return `$${(this.value as number).toFixed(4)}` },
      },
    },
    tooltip: {
      ...CHART_BASE.tooltip,
      formatter() {
        const pts = (this as Highcharts.TooltipFormatterContextObject).points ?? []
        const total = pts.reduce((s, p) => s + (p.y ?? 0), 0)
        const rows = pts.map((p) => `<span style="color:${p.color as string}">●</span> ${p.series.name}: <b>${formatUsd(p.y as number)}</b>`).join('<br/>')
        return `<b>${(this as Highcharts.TooltipFormatterContextObject).x as string}</b><br/>${rows}<br/><span style="opacity:0.7">Total: ${formatUsd(total)}</span>`
      },
    },
    series: [
      { name: 'Input cost', type: 'bar', data: costChartModels.map((i) => i.inputCostUsd), color: '#F0C87A' },
      { name: 'Output cost', type: 'bar', data: costChartModels.map((i) => i.outputCostUsd), color: '#C87A30' },
    ],
  }

  // ── Provider badge colors ───────────────────────────────────────────────
  function providerStyle(provider: string): { bg: string; color: string; border: string } {
    if (provider === 'Anthropic') return { bg: '#FEF6ED', color: '#B07030', border: '#F0D4A8' }
    if (provider === 'Google') return { bg: '#F0EEFB', color: '#7B54D0', border: '#D4C7F5' }
    return { bg: '#EEF5EF', color: '#3A6E40', border: '#C8DDC9' }
  }

  return (
    <div className="max-w-[1280px] space-y-6">

      {/* ── Calculator modal ── */}
      <CalculatorModal
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        modelOptions={calculatorModelOptions}
        selectedModel={selectedCalculatorModel}
        onModelChange={setCalculatorModel}
        promptCount={calculatorPromptCount}
        onPromptCountChange={setCalculatorPromptCount}
        inputTokens={calculatorInputTokens}
        onInputTokensChange={setCalculatorInputTokens}
        outputTokens={calculatorOutputTokens}
        onOutputTokensChange={setCalculatorOutputTokens}
        pricing={selectedCalculatorPricing}
        costPerPrompt={calculatorCostPerPrompt}
        totalCost={calculatorTotalCostUsd}
        promptCountValue={calculatorPromptCount}
      />

      {/* ── Pricing modal ── */}
      {pricingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,30,22,0.45)', backdropFilter: 'blur(3px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setPricingOpen(false) }}>
          <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ background: '#FFFFFF', border: '1px solid #DDD0BC' }}>
            <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #F0E8DC', background: '#FDFCF8' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1E2E20', letterSpacing: '-0.02em' }}>Model Pricing Catalog</div>
                <div style={{ fontSize: 12, color: '#8FA191', marginTop: 2 }}>Per-token pricing used for cost estimates.</div>
              </div>
              <button type="button" onClick={() => setPricingOpen(false)} style={{ background: '#F2EDE6', border: '1px solid #DDD0BC', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7A8E7C" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: '#F5F0E8', borderBottom: '2px solid #E5DDD0', position: 'sticky', top: 0 }}>
                    {['Model', 'Provider', 'Input / 1M', 'Output / 1M', 'Source', 'As of'].map((col, i) => (
                      <th key={col} className={`px-5 py-3 ${i < 2 ? 'text-left' : i < 4 ? 'text-right' : 'text-left'}`}
                        style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8A9E8C', whiteSpace: 'nowrap' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODEL_PRICING_CATALOG.map((p, idx) => {
                    const ps = providerStyle(p.provider)
                    return (
                      <tr key={p.model} style={{ borderBottom: '1px solid #F2EDE6', background: idx % 2 === 0 ? '#FFFFFF' : '#FDFCF8' }}>
                        <td className="px-5 py-3">
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20' }}>{p.model}</div>
                          {p.notes && <div style={{ fontSize: 11, color: '#9C6B2E', marginTop: 2 }}>{p.notes}</div>}
                        </td>
                        <td className="px-5 py-3">
                          <span style={{ fontSize: 11, fontWeight: 600, color: ps.color, background: ps.bg, border: `1px solid ${ps.border}`, borderRadius: 999, padding: '2px 9px' }}>{p.provider}</span>
                        </td>
                        <td className="px-5 py-3 text-right" style={{ fontSize: 13, fontWeight: 600, color: '#2A3A2C', fontVariantNumeric: 'tabular-nums' }}>{formatUsd(p.inputUsdPerMillion)}</td>
                        <td className="px-5 py-3 text-right" style={{ fontSize: 13, fontWeight: 600, color: '#2A3A2C', fontVariantNumeric: 'tabular-nums' }}>{formatUsd(p.outputUsdPerMillion)}</td>
                        <td className="px-5 py-3">
                          <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 w-fit" style={{ fontSize: 12, color: '#4A6450', textDecoration: 'none' }}>
                            {p.sourceLabel}
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 10L10 2M10 2H5M10 2V7" /></svg>
                          </a>
                        </td>
                        <td className="px-5 py-3" style={{ fontSize: 12, color: '#9AAE9C' }}>{p.sourceDate}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-model stats modal ── */}
      {statsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,30,22,0.45)', backdropFilter: 'blur(3px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setStatsOpen(false) }}>
          <div className="w-full max-w-[1100px] max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ background: '#FFFFFF', border: '1px solid #DDD0BC' }}>
            <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #F0E8DC', background: '#FDFCF8' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1E2E20', letterSpacing: '-0.02em' }}>Per-model Stats</div>
                <div style={{ fontSize: 12, color: '#8FA191', marginTop: 2 }}>Runtime, token, and cost breakdown by model.</div>
              </div>
              <button type="button" onClick={() => setStatsOpen(false)} style={{ background: '#F2EDE6', border: '1px solid #DDD0BC', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7A8E7C" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[1400px] border-collapse">
                <thead>
                  <tr style={{ background: '#F5F0E8', borderBottom: '2px solid #E5DDD0', position: 'sticky', top: 0 }}>
                    {['Model', 'Responses', 'Success', 'Fail', 'Web Search', 'Total Duration', 'Avg Duration', 'Input Tokens', 'Output Tokens', 'Input Rate', 'Output Rate', 'Input Cost', 'Output Cost', 'Total Cost', 'Cost / Response'].map((col, i) => (
                      <th key={col} className={`px-4 py-3 ${i === 0 ? 'text-left' : 'text-right'}`}
                        style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8A9E8C', whiteSpace: 'nowrap' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statsWithCosts.map((item, idx) => {
                    const ps = providerStyle(item.pricing?.provider ?? 'OpenAI')
                    return (
                      <tr key={`modal-${item.model}`} style={{ borderBottom: '1px solid #F2EDE6', background: idx % 2 === 0 ? '#FFFFFF' : '#FDFCF8' }}>
                        <td className="px-4 py-3">
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20' }}>{item.model}</div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: ps.color, background: ps.bg, border: `1px solid ${ps.border}`, borderRadius: 999, padding: '1px 7px' }}>{item.owner}</span>
                        </td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.responseCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#166534', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{item.successCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: item.failureCount > 0 ? '#B45309' : '#9AAE9C', fontWeight: item.failureCount > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>{item.failureCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.webSearchEnabledCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{formatDurationMs(item.totalDurationMs)}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{formatDurationMs(item.avgDurationMs)}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.totalInputTokens.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.totalOutputTokens.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#5A7060', fontVariantNumeric: 'tabular-nums' }}>{item.pricing ? formatUsdPerMillion(item.pricing.inputUsdPerMillion) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#5A7060', fontVariantNumeric: 'tabular-nums' }}>{item.pricing ? formatUsdPerMillion(item.pricing.outputUsdPerMillion) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.costs ? formatUsd(item.costs.inputCostUsd) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.costs ? formatUsd(item.costs.outputCostUsd) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20', fontVariantNumeric: 'tabular-nums' }}>{item.costs ? formatUsd(item.costs.totalCostUsd) : <span style={{ color: '#C4B8A8', fontWeight: 400 }}>—</span>}</td>
                        <td className="px-4 py-3 text-right" style={{ fontSize: 13, fontWeight: 700, color: '#2A5C2E', fontVariantNumeric: 'tabular-nums' }}>{item.avgCostPerResponseUsd !== null ? formatUsd(item.avgCostPerResponseUsd) : <span style={{ color: '#C4B8A8', fontWeight: 400 }}>—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="rounded-2xl border px-6 py-5" style={{ background: '#FFFFFF', borderColor: '#DDD0BC', boxShadow: '0 1px 4px rgba(30,40,25,0.05)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1E2E20', letterSpacing: '-0.03em', lineHeight: 1.1 }}>Under the Hood</h1>
            <p style={{ fontSize: 13, color: '#7A8E7C', marginTop: 4 }}>Model-level runtime, token, and estimated API cost metrics.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Segmented time range */}
            <div className="flex items-center gap-0.5 p-1 rounded-xl" style={{ background: '#F2EDE6', border: '1px solid #DDD0BC' }}>
              {UNDER_THE_HOOD_RANGE_OPTIONS.map((opt) => {
                const active = selectedRange === opt.value
                return (
                  <button key={opt.value} type="button" onClick={() => setSelectedRange(opt.value)}
                    style={{ padding: '5px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s', background: active ? '#2A5C2E' : 'transparent', color: active ? '#FFFFFF' : '#7A8E7C', boxShadow: active ? '0 1px 4px rgba(42,92,46,0.25)' : 'none' }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Action buttons row */}
        <div className="mt-4 flex flex-wrap gap-2 pt-3" style={{ borderTop: '1px solid #EDE7DA' }}>
          {[
            { label: 'Cost Calculator', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="12" y2="14" /></svg>, onClick: () => setCalculatorOpen(true) },
            { label: 'Model Pricing', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>, onClick: () => setPricingOpen(true) },
            { label: 'Per-model Stats', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>, onClick: () => setStatsOpen(true) },
          ].map(({ label, icon, onClick }) => (
            <button key={label} type="button" onClick={onClick}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{ background: '#F5F0E8', border: '1px solid #E5DDD0', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#5A7060' }}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {unpricedModels.length > 0 && (
        <div className="rounded-xl border px-4 py-3 flex items-start gap-3 text-sm" style={{ background: '#FFFBEB', borderColor: '#FCD34D', color: '#92400E' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Missing pricing for: <strong>{unpricedModels.join(', ')}</strong></span>
        </div>
      )}

      {/* ── Charts + their scorecards, side by side ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* LEFT: Token chart + Token scorecards */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border overflow-hidden flex flex-col" style={{ background: '#FFFFFF', borderColor: '#DDD0BC', height: 360 }}>
            <div className="px-5 pt-4 pb-2">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20', letterSpacing: '-0.01em' }}>Token Usage</div>
              <div style={{ fontSize: 11, color: '#9AAE9C', marginTop: 2 }}>Input vs output tokens per model</div>
            </div>
            {chartModels.length > 0 ? (
              <div className="px-3 pb-3">
                <HighchartsReact highcharts={Highcharts} options={tokenChartOptions} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm" style={{ color: '#9AAE9C' }}>No token data available.</div>
            )}
          </div>
          <div className="rounded-2xl p-4 space-y-3 flex-1" style={{ background: '#FBF4E8', border: '1px solid #EDD8B4' }}>
            <SectionLabel>Tokens</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Input Tokens" value={summary.tokenTotals.inputTokens.toLocaleString()} />
              <StatCard label="Output Tokens" value={summary.tokenTotals.outputTokens.toLocaleString()} />
              <StatCard label="Total Tokens" value={summary.tokenTotals.totalTokens.toLocaleString()} />
              <StatCard label="Model Owners" value={summary.modelOwners.length.toLocaleString()} />
              <StatCard
                label="Avg Input / Response"
                value={summary.totalResponses > 0 ? Math.round(summary.tokenTotals.inputTokens / summary.totalResponses).toLocaleString() : '—'}
              />
              <StatCard
                label="Avg Output / Response"
                value={summary.totalResponses > 0 ? Math.round(summary.tokenTotals.outputTokens / summary.totalResponses).toLocaleString() : '—'}
              />
            </div>
          </div>
        </div>

        {/* RIGHT: Cost chart + Cost scorecards */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border overflow-hidden flex flex-col" style={{ background: '#FFFFFF', borderColor: '#DDD0BC', height: 360 }}>
            <div className="px-5 pt-4 pb-2">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20', letterSpacing: '-0.01em' }}>API Cost Breakdown</div>
              <div style={{ fontSize: 11, color: '#9AAE9C', marginTop: 2 }}>Input vs output cost per model</div>
            </div>
            {costChartModels.length > 0 ? (
              <div className="px-3 pb-3">
                <HighchartsReact highcharts={Highcharts} options={costChartOptions} />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm" style={{ color: '#9AAE9C' }}>No cost data available.</div>
            )}
          </div>
          <div className="rounded-2xl p-4 space-y-3 flex-1" style={{ background: '#FBF4E8', border: '1px solid #EDD8B4' }}>
            <SectionLabel>Cost</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Estimated API Cost" value={formatUsd(estimatedTotalCostUsd)} help={`${pricedModelCount}/${statsWithCosts.length} models priced`} accent="green" />
              <StatCard label="Input Cost" value={formatUsd(estimatedInputCostUsd)} />
              <StatCard label="Output Cost" value={formatUsd(estimatedOutputCostUsd)} />
              <StatCard label="Avg Cost / Response" value={formatUsd(avgCostPerResponseUsd)} help="Across responses with known pricing" />
              <StatCard label="Avg Cost / Prompt" value={formatUsd(avgCostPerPromptUsd)} help={`Estimated across ${summary.queryCount.toLocaleString()} prompts`} />
              <StatCard label="Pricing Coverage" value={`${pricedModelCount}/${statsWithCosts.length}`} help="Models with known token pricing" />
            </div>
          </div>
        </div>

      </div>

      {/* ── Performance scorecards — full width ── */}
      <div className="space-y-2.5">
        <SectionLabel>Performance</SectionLabel>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="Models Tested" value={summary.models.length.toLocaleString()} />
          <StatCard label="Total Responses" value={summary.totalResponses.toLocaleString()} />
          <StatCard label="Total Duration" value={formatDurationMs(summary.durationTotals.totalDurationMs)} help="Across all model responses" />
          <StatCard label="Avg Duration / Response" value={formatDurationMs(summary.durationTotals.avgDurationMs)} />
        </div>
      </div>

      {/* ── Per-model stats table ── */}
      <div className="rounded-2xl border shadow-sm overflow-hidden" style={{ background: '#FFFFFF', borderColor: '#DDD0BC' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #F0E8DC', background: '#FDFCF8' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E2E20', letterSpacing: '-0.01em' }}>Per-model Stats</div>
            <div style={{ fontSize: 12, color: '#8FA191', marginTop: 1 }}>Runtime, token, and cost breakdown by model.</div>
          </div>
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums" style={{ background: '#EEF5EF', color: '#3A6E40', border: '1px solid #C8DDC9' }}>
            {statsWithCosts.length} model{statsWithCosts.length !== 1 ? 's' : ''}
          </span>
        </div>
        {statsWithCosts.length === 0 ? (
          <div className="p-6 text-sm" style={{ color: '#7A8E7C' }}>No model stats available yet. Trigger a run to populate this page.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1580px] border-collapse">
              <thead>
                <tr style={{ background: '#F5F0E8', borderBottom: '2px solid #E5DDD0' }}>
                  {['Model', 'Responses', 'Success', 'Fail', 'Web Search', 'Total Duration', 'Avg Duration', 'Input Tokens', 'Output Tokens', 'Input Rate', 'Output Rate', 'Input Cost', 'Output Cost', 'Total Cost', 'Cost / Response'].map((col, i) => (
                    <th key={col} className={`px-4 py-3 ${i === 0 ? 'text-left' : 'text-right'}`}
                      style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8A9E8C', whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statsWithCosts.map((item, idx) => {
                  const ps = providerStyle(item.pricing?.provider ?? 'OpenAI')
                  return (
                    <tr key={item.model} style={{ borderBottom: '1px solid #F2EDE6', background: idx % 2 === 0 ? '#FFFFFF' : '#FDFCF8' }}>
                      <td className="px-4 py-3">
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20' }}>{item.model}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span style={{ fontSize: 10, fontWeight: 600, color: ps.color, background: ps.bg, border: `1px solid ${ps.border}`, borderRadius: 999, padding: '1px 7px' }}>{item.owner}</span>
                          {item.pricing?.matchedBy === 'family' && (
                            <span style={{ fontSize: 10, color: '#B45309', background: '#FFF8EB', border: '1px solid #FDE68A', borderRadius: 999, padding: '1px 7px', fontWeight: 600 }}>family match</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.responseCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#166534', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{item.successCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: item.failureCount > 0 ? '#B45309' : '#9AAE9C', fontWeight: item.failureCount > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>{item.failureCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.webSearchEnabledCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{formatDurationMs(item.totalDurationMs)}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{formatDurationMs(item.avgDurationMs)}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.totalInputTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.totalOutputTokens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#5A7060', fontVariantNumeric: 'tabular-nums' }}>{item.pricing ? formatUsdPerMillion(item.pricing.inputUsdPerMillion) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#5A7060', fontVariantNumeric: 'tabular-nums' }}>{item.pricing ? formatUsdPerMillion(item.pricing.outputUsdPerMillion) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.costs ? formatUsd(item.costs.inputCostUsd) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, color: '#3D5840', fontVariantNumeric: 'tabular-nums' }}>{item.costs ? formatUsd(item.costs.outputCostUsd) : <span style={{ color: '#C4B8A8' }}>—</span>}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, fontWeight: 700, color: '#1E2E20', fontVariantNumeric: 'tabular-nums' }}>{item.costs ? formatUsd(item.costs.totalCostUsd) : <span style={{ color: '#C4B8A8', fontWeight: 400 }}>—</span>}</td>
                      <td className="px-4 py-3 text-right" style={{ fontSize: 13, fontWeight: 700, color: '#2A5C2E', fontVariantNumeric: 'tabular-nums' }}>{item.avgCostPerResponseUsd !== null ? formatUsd(item.avgCostPerResponseUsd) : <span style={{ color: '#C4B8A8', fontWeight: 400 }}>—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
