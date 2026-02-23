import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { api } from '../api'

const NAV = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    to: '/prompts',
    label: 'Prompts',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  {
    to: '/prompt-drilldown',
    label: 'Prompt Drilldown',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h12M4 18h8" />
        <circle cx="18" cy="18" r="3" />
      </svg>
    ),
  },
  {
    to: '/runs',
    label: 'Runs',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 4L21 12L13 20" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12H21" />
      </svg>
    ),
  },
  {
    to: '/competitors',
    label: 'Competitors',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    to: '/logics',
    label: 'Logics',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6M10 7h4M12 7v5m0 0l-3 3m3-3l3 3M4 21h16" />
      </svg>
    ),
  },
]

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/runs': 'Run Benchmarks',
  '/prompts': 'Prompts',
  '/prompt-drilldown': 'Prompt Drilldown',
  '/prompts/drilldown': 'Prompt Drilldown',
  '/competitors': 'Competitors',
  '/logics': 'Logics',
}

const USING_SUPABASE =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  )

function ApiStatus() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 30_000,
  })
  const ok = data?.ok === true && !isError
  return (
    <div className="flex items-center gap-2" style={{ color: '#8FBB93' }}>
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: ok ? '#22c55e' : '#ef4444' }}
      />
      <span className="text-[11px]">{ok ? 'API connected' : 'API offline'}</span>
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname] ?? 'Javis'
  const [iconOpen, setIconOpen] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoSrc = clickCount % 2 === 0 ? '/video.mp4' : '/video2.mp4'

  function openVideo() {
    setClickCount((c) => c + 1)
    setIconOpen(true)
    setTimeout(() => videoRef.current?.play(), 50)
  }

  function closeVideo() {
    setIconOpen(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Icon lightbox */}
      <div
        onClick={closeVideo}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          opacity: iconOpen ? 1 : 0,
          pointerEvents: iconOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
            transform: iconOpen ? 'scale(1)' : 'scale(0.85)',
            opacity: iconOpen ? 1 : 0,
            transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease',
          }}
        >
          <video
            ref={videoRef}
            src={videoSrc}
            poster="/app-icon.jpg"
            controls
            style={{ display: 'block', width: 480, maxWidth: '90vw' }}
          />
          <button
            onClick={closeVideo}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.45)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
      {/* Sidebar — deep sage shell */}
      <aside
        className="flex flex-col w-[240px] flex-shrink-0"
        style={{ background: '#3D5C40', borderRight: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            type="button"
            onClick={openVideo}
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-opacity"
            style={{
              background: '#4A6B4E',
              border: '1px solid rgba(255,255,255,0.12)',
              overflow: 'hidden',
              cursor: 'pointer',
              padding: 0,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.8')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
            aria-label="View app icon"
          >
            <img
              src="/app-icon.jpg"
              alt="App icon"
              className="w-full h-full object-cover"
            />
          </button>
          <div>
            <div className="text-[13px] font-semibold leading-snug tracking-tight" style={{ color: '#FEFAE8' }}>Javis</div>
            <div className="text-[10px] leading-snug" style={{ color: '#5A7A5E' }}>The Ai Visability Tracker</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                padding: '7px 10px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: isActive ? '500' : '400',
                color: isActive ? '#FDFCF8' : '#8FBB93',
                background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
                textDecoration: 'none',
                transition: 'all 0.1s',
              })}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLAnchorElement
                if (!el.getAttribute('aria-current')) {
                  el.style.color = '#C8A87A'
                  el.style.background = 'rgba(255,255,255,0.07)'
                }
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLAnchorElement
                if (!el.getAttribute('aria-current')) {
                  el.style.color = '#8FBB93'
                  el.style.background = 'transparent'
                }
              }}
            >
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="px-4 py-4 space-y-1.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ApiStatus />
          <div className="text-[11px]" style={{ color: '#4A6848' }}>
            {USING_SUPABASE ? 'supabase' : ':8787'}
          </div>
        </div>
      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center h-14 px-6 flex-shrink-0"
          style={{ background: '#FDFCF8', borderBottom: '1px solid #DDD0BC' }}
        >
          <h1 className="text-sm font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
            {title}
          </h1>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-6 py-5" style={{ background: '#F2EDE6' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
