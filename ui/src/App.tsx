import { Suspense, lazy } from 'react'
import type { ComponentType, ElementType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import CitationLinks from './pages/CitationLinks'
import Competitors from './pages/Competitors'
import Dashboard from './pages/Dashboard'
import Logics from './pages/Logics'
import PromptDrilldown from './pages/PromptDrilldown'
import PromptDrilldownHub from './pages/PromptDrilldownHub'
import Prompts from './pages/Prompts'
import Runs from './pages/Runs'

type PageModule = { default: ComponentType<any> }
const pageModules = import.meta.glob('./pages/{Gantt,KR23,OKR}.tsx') as Record<
  string,
  () => Promise<PageModule>
>

function resolveLazyPage(path: string): ElementType | null {
  const loader = pageModules[path]
  return loader ? lazy(loader) : null
}

const Gantt = resolveLazyPage('./pages/Gantt.tsx')
const KR23 = resolveLazyPage('./pages/KR23.tsx')
const OKR = resolveLazyPage('./pages/OKR.tsx')

function LazyPageFallback() {
  return (
    <div
      className="rounded-xl border p-4 text-sm"
      style={{ background: '#FFFFFF', borderColor: '#DDD0BC', color: '#6E8370' }}
    >
      Loading page...
    </div>
  )
}

function MissingPageFallback({ label }: { label: string }) {
  return (
    <div
      className="rounded-xl border p-4 text-sm"
      style={{ background: '#FFFFFF', borderColor: '#F0D4A8', color: '#8A5A21' }}
    >
      {label} is not available in this build.
    </div>
  )
}

function LazyPageRoute({
  Page,
  label,
}: {
  Page: ElementType | null
  label: string
}) {
  if (!Page) {
    return <MissingPageFallback label={label} />
  }
  return (
    <Suspense fallback={<LazyPageFallback />}>
      <Page />
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/okr" element={<Navigate to="/okr/kr-2-1" replace />} />
          <Route path="/okr/kr-2-1" element={<LazyPageRoute Page={OKR} label="KR 2.1" />} />
          <Route path="/okr/kr-2-3" element={<LazyPageRoute Page={KR23} label="KR 2.3" />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/gantt" element={<LazyPageRoute Page={Gantt} label="Gantt" />} />
          <Route path="/prompts" element={<Prompts />} />
          <Route path="/prompt-drilldown" element={<PromptDrilldownHub />} />
          <Route path="/prompts/drilldown" element={<PromptDrilldown />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/citation-links" element={<CitationLinks />} />
          <Route path="/logics" element={<Logics />} />
          <Route path="/diagnostics" element={<Navigate to="/logics" replace />} />
          <Route path="/tests" element={<Navigate to="/logics" replace />} />
          <Route path="/config" element={<Navigate to="/prompts" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
