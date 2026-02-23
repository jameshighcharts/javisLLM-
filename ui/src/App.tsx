import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Competitors from './pages/Competitors'
import Config from './pages/Config'
import Dashboard from './pages/Dashboard'
import Prompts from './pages/Prompts'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/prompts" element={<Prompts />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/config" element={<Config />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
