import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { api } from '../api'

// ── Header extra slot ─────────────────────────────────────────────────────────
const HeaderExtraContext = createContext<(node: ReactNode) => void>(() => {})
export function useHeaderExtra() { return useContext(HeaderExtraContext) }

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
    to: '/citation-links',
    label: 'Citation Links',
    soon: true,
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121a4 4 0 005.657 0l4-4a4 4 0 00-5.657-5.657l-1.1 1.1" />
      </svg>
    ),
  },
  {
    to: '/logics',
    label: 'Appendix',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15z" />
      </svg>
    ),
  },
]

const MOBILE_NAV = NAV.filter((item) => !item.soon).slice(0, 5)

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/runs': 'Run Benchmarks',
  '/prompts': 'Prompts',
  '/prompts/drilldown': 'Prompt Drilldown',
  '/competitors': 'Competitors',
  '/citation-links': 'Citation Links',
  '/logics': 'Appendix',
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [headerExtra, setHeaderExtraRaw] = useState<ReactNode>(null)
  const setHeaderExtra = useCallback((node: ReactNode) => setHeaderExtraRaw(node), [])

  const videoSrc = clickCount % 2 === 0 ? '/video.mp4' : '/video2.mp4'

  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

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
    <HeaderExtraContext.Provider value={setHeaderExtra}>
      <div className="flex h-[100dvh] overflow-hidden">
        {/* Icon lightbox */}
        <div
          onClick={closeVideo}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
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

        {/* Mobile drawer */}
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ pointerEvents: mobileNavOpen ? 'auto' : 'none' }}
          aria-hidden={!mobileNavOpen}
        >
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0"
            style={{
              background: `rgba(0, 0, 0, ${mobileNavOpen ? 0.38 : 0})`,
              transition: 'background 0.2s ease',
            }}
            aria-label="Close navigation menu"
          />
          <aside
            className="relative h-full w-[270px] max-w-[88vw] flex flex-col"
            style={{
              background: '#3D5C40',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              transform: mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 0.22s ease',
            }}
          >
            <div
              className="flex items-center justify-between gap-3 px-4 h-14 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={openVideo}
                  className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{
                    background: '#4A6B4E',
                    border: '1px solid rgba(255,255,255,0.12)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  aria-label="View app icon"
                >
                  <img
                    src="/app-icon.jpg"
                    alt="App icon"
                    className="w-full h-full object-cover"
                  />
                </button>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-snug tracking-tight" style={{ color: '#FEFAE8' }}>Javis</div>
                  <div className="text-[10px] leading-snug truncate" style={{ color: '#5A7A5E' }}>The Ai Visability Tracker</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="w-8 h-8 rounded-md text-sm"
                style={{ color: '#FEFAE8', border: '1px solid rgba(255,255,255,0.12)' }}
                aria-label="Close menu"
              >
                ×
              </button>
            </div>

            <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  style={({ isActive }) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    padding: '10px 10px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: isActive ? '500' : '400',
                    color: isActive ? '#FDFCF8' : '#8FBB93',
                    background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
                    textDecoration: 'none',
                    transition: 'all 0.1s',
                  })}
                >
                  <span style={{ flexShrink: 0 }}>{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.soon && (
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}
                    >
                      soon
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>

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
        </div>

        {/* Desktop sidebar */}
        <aside
          className="hidden md:flex flex-col w-[220px] flex-shrink-0"
          style={{ background: '#3D5C40', borderRight: '1px solid rgba(255,255,255,0.08)' }}
        >
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
                <span className="flex-1">{item.label}</span>
                {item.soon && (
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}
                  >
                    soon
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

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
          <header
            className="flex items-center justify-between gap-3 min-h-14 px-4 sm:px-6 py-2 flex-shrink-0"
            style={{ background: '#FDFCF8', borderBottom: '1px solid #DDD0BC' }}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ border: '1px solid #DDD0BC', color: '#2A3A2C', background: '#FFFFFF' }}
                aria-label="Open navigation menu"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="text-sm font-semibold tracking-tight truncate" style={{ color: '#2A3A2C' }}>
                {title}
              </h1>
            </div>
            {headerExtra ? (
              <div className="min-w-0 flex items-center justify-end gap-2">{headerExtra}</div>
            ) : null}
          </header>

          <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 pb-28 md:pb-5" style={{ background: '#F2EDE6' }}>
            {children}
          </main>
        </div>

        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t md:hidden"
          style={{
            background: 'rgba(253,252,248,0.98)',
            borderColor: '#DDD0BC',
            backdropFilter: 'blur(10px)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="min-h-[56px] flex flex-col items-center justify-center gap-1 px-1 pt-2 pb-2"
                style={({ isActive }) => ({
                  color: isActive ? '#2A3A2C' : '#7A8E7C',
                  background: isActive ? 'rgba(143,187,147,0.14)' : 'transparent',
                  borderTop: isActive ? '2px solid #8FBB93' : '2px solid transparent',
                  textDecoration: 'none',
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 500,
                  lineHeight: 1.1,
                })}
              >
                <span aria-hidden>{item.icon}</span>
                <span className="truncate max-w-full">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </HeaderExtraContext.Provider>
  )
}
