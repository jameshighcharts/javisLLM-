import { Suspense, lazy } from 'react'
import type { ComponentType, ElementType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Askill from './pages/Askill'
import CitationLinks from './pages/CitationLinks'
import Competitors from './pages/Competitors'
import CompetitorBlogs from './pages/CompetitorBlogs'
import Dashboard from './pages/Dashboard'
import Logics from './pages/Logics'
import PromptDrilldown from './pages/PromptDrilldown'
import PromptDrilldownHub from './pages/PromptDrilldownHub'
import ProductMentions from './pages/ProductMentions'
import Prompts from './pages/Prompts'
import PromptResearch from './pages/PromptResearch'
import Runs from './pages/Runs'
import UnderTheHood from './pages/UnderTheHood'

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

function RootRoute() {
  const { session, isInitialized } = useAuth()

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F2EDE6' }}>
        <div className="animate-pulse" style={{ color: '#8FBB93' }}>Loading...</div>
      </div>
    )
  }

  return <Navigate to={session ? '/dashboard' : '/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/okr/kr-2-1" element={<LazyPageRoute Page={OKR} label="KR 2.1" />} />
                  <Route path="/okr/kr-2-3" element={<LazyPageRoute Page={KR23} label="KR 2.3" />} />
                  <Route path="/runs" element={<Runs />} />
                  <Route path="/gantt" element={<LazyPageRoute Page={Gantt} label="Gantt" />} />
                  <Route path="/prompts" element={<Prompts />} />
                  <Route path="/prompt-research" element={<PromptResearch />} />
                  <Route path="/product-mentions" element={<ProductMentions />} />
                  <Route path="/query-lab" element={<Prompts queryLabOnly />} />
                  <Route path="/prompt-drilldown" element={<PromptDrilldownHub />} />
                  <Route path="/prompts/drilldown" element={<PromptDrilldown />} />
                  <Route path="/competitors" element={<Competitors />} />
                  <Route path="/competitor-blogs" element={<CompetitorBlogs />} />
                  <Route path="/citation-links" element={<CitationLinks />} />
                  <Route path="/askill" element={<Askill />} />
                  <Route path="/logics" element={<Logics />} />
                  <Route path="/under-the-hood" element={<UnderTheHood />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
