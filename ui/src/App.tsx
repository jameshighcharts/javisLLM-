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

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/runs" element={<Runs />} />
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
