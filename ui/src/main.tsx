import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import SolidGauge from 'highcharts/modules/solid-gauge'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

HighchartsMore(Highcharts)
SolidGauge(Highcharts)

// warm pastel cream/sage/tan chart theme
Highcharts.setOptions({
  chart: {
    style: { fontFamily: "'Inter', system-ui, sans-serif" },
    animation: { duration: 400 },
  },
  colors: ['#8FBB93', '#C8A87A', '#D49880', '#A89CB8', '#C8B858', '#9DB8A0', '#C89078', '#7AAB7E'],
  credits: { enabled: false },
  title: { text: '' },
  subtitle: { text: '' },
  legend: {
    itemStyle: { fontWeight: '500', fontSize: '12px', color: '#2A3A2C' },
  },
  xAxis: {
    gridLineColor: '#EDE8E0',
    lineColor: '#DDD0BC',
    tickColor: '#DDD0BC',
    labels: { style: { color: '#7A8E7C', fontSize: '12px' } },
  },
  yAxis: {
    gridLineColor: '#EDE8E0',
    lineColor: 'transparent',
    tickColor: 'transparent',
    labels: { style: { color: '#7A8E7C', fontSize: '12px' } },
    title: { text: '' },
  },
  tooltip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD0BC',
    borderRadius: 8,
    shadow: false,
    style: { color: '#2A3A2C', fontSize: '13px' },
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
