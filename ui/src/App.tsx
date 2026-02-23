import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Competitors from './pages/Competitors'
import Dashboard from './pages/Dashboard'
import Prompts from './pages/Prompts'
import Runs from './pages/Runs'
import Tests from './pages/Tests'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/prompts" element={<Prompts />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/diagnostics" element={<Tests />} />
          <Route path="/tests" element={<Tests />} />
          <Route path="/config" element={<Navigate to="/prompts" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
