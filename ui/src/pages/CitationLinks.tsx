export default function CitationLinks() {
  return (
    <div className="max-w-[1360px] space-y-5">

      {/* Page header — blurred */}
      <div
        className="flex items-end justify-between"
        style={{ filter: 'blur(3px)', opacity: 0.35, pointerEvents: 'none', userSelect: 'none' }}
        aria-hidden="true"
      >
        <div>
          <div className="h-7 w-44 rounded-lg" style={{ background: '#C8C0B0' }} />
          <div className="h-4 w-64 rounded mt-2" style={{ background: '#DDD0BC' }} />
        </div>
        <div className="h-8 w-24 rounded-lg" style={{ background: '#C8DDC9' }} />
      </div>

      {/* Main content area */}
      <div className="relative">

        {/* ── Blurred mock dashboard ── */}
        <div
          className="space-y-4 select-none pointer-events-none"
          style={{ filter: 'blur(5px)', opacity: 0.55 }}
          aria-hidden="true"
        >
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { bg: '#FFFFFF', accent: '#EEF5EF', bar: '#8FBB93', pct: '72%', val: 'w-12' },
              { bg: '#FFFFFF', accent: '#FEF6ED', bar: '#C8A87A', pct: '49%', val: 'w-10' },
              { bg: '#FFFFFF', accent: '#F0EEFB', bar: '#9B8CB5', pct: '38%', val: 'w-14' },
              { bg: '#FFFFFF', accent: '#F2EDE6', bar: '#DDD0BC', pct: '21%', val: 'w-8'  },
            ].map((c, i) => (
              <div key={i} className="rounded-xl p-5" style={{ background: c.bg, border: '1px solid #DDD0BC' }}>
                <div className="h-2.5 w-20 rounded mb-3" style={{ background: '#DDD0BC' }} />
                <div className={`h-8 ${c.val} rounded-lg mb-3`} style={{ background: '#C8C0B0' }} />
                <div className="rounded-full overflow-hidden h-1.5 mb-1.5" style={{ background: c.accent }}>
                  <div className="h-full rounded-full" style={{ width: c.pct, background: c.bar }} />
                </div>
                <div className="h-2 w-24 rounded" style={{ background: '#E8E0D2' }} />
              </div>
            ))}
          </div>

          {/* Table + sidebar */}
          <div className="grid grid-cols-5 gap-4">
            <div className="col-span-3 rounded-xl overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid #DDD0BC' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#FDFCF8', borderBottom: '1px solid #F2EDE6' }}>
                <div className="h-3 w-36 rounded" style={{ background: '#DDD0BC' }} />
                <div className="h-3 w-14 rounded" style={{ background: '#E8E0D2' }} />
              </div>
              <div className="px-4 py-2.5 flex items-center gap-5" style={{ borderBottom: '1px solid #F2EDE6', background: '#FDFCF8' }}>
                {[72, 160, 52, 88, 64, 48].map((w, i) => (
                  <div key={i} className="h-2.5 rounded flex-shrink-0" style={{ background: '#DDD0BC', width: w }} />
                ))}
              </div>
              {[
                { bar: '#8FBB93', pct: '74%', cols: [100, 210] },
                { bar: '#D4836A', pct: '59%', cols: [80,  165] },
                { bar: '#8FBB93', pct: '52%', cols: [92,  185] },
                { bar: '#9B8CB5', pct: '41%', cols: [74,  145] },
                { bar: '#C8A87A', pct: '35%', cols: [110, 195] },
                { bar: '#D4C05A', pct: '28%', cols: [88,  155] },
                { bar: '#8FBB93', pct: '19%', cols: [96,  175] },
              ].map((row, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-5" style={{ borderBottom: '1px solid #F2EDE6' }}>
                  <div className="h-2.5 rounded flex-shrink-0" style={{ background: '#E8E0D2', width: row.cols[0] }} />
                  <div className="h-2.5 rounded flex-shrink-0" style={{ background: '#EEE5D8', width: row.cols[1] }} />
                  <div className="h-2.5 w-9 rounded flex-shrink-0" style={{ background: '#E8E0D2' }} />
                  <div className="flex items-center gap-2 flex-shrink-0" style={{ width: 88 }}>
                    <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: '#F2EDE6' }}>
                      <div className="h-full rounded-full" style={{ width: row.pct, background: row.bar }} />
                    </div>
                    <div className="h-2.5 w-6 rounded" style={{ background: '#DDD0BC' }} />
                  </div>
                  <div className="h-2.5 w-16 rounded flex-shrink-0" style={{ background: '#EEE5D8' }} />
                </div>
              ))}
            </div>

            <div className="col-span-2 space-y-4">
              {/* Bar chart */}
              <div className="rounded-xl p-5" style={{ background: '#FFFFFF', border: '1px solid #DDD0BC' }}>
                <div className="h-3 w-28 rounded mb-1" style={{ background: '#DDD0BC' }} />
                <div className="h-2.5 w-40 rounded mb-4" style={{ background: '#E8E0D2' }} />
                <div className="flex items-end gap-1.5 h-28">
                  {[32,45,38,60,52,74,65,82,70,91,84,100].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t transition-all"
                      style={{ height: `${h}%`, background: i >= 9 ? '#8FBB93' : i >= 6 ? '#C8DDC9' : '#E8E0D2' }} />
                  ))}
                </div>
                <div className="flex justify-between mt-2.5">
                  {['M','A','J','A','S','O','N','D','J','F'].map((m, i) => (
                    <div key={i} className="h-2 w-4 rounded" style={{ background: '#E8E0D2' }} />
                  ))}
                </div>
              </div>

              {/* Source breakdown */}
              <div className="rounded-xl p-5" style={{ background: '#FFFFFF', border: '1px solid #DDD0BC' }}>
                <div className="h-3 w-32 rounded mb-4" style={{ background: '#DDD0BC' }} />
                {[
                  { bar: '#8FBB93', pct: '68%', lw: 100 },
                  { bar: '#D4836A', pct: '53%', lw: 82  },
                  { bar: '#9B8CB5', pct: '42%', lw: 90  },
                  { bar: '#C8A87A', pct: '30%', lw: 70  },
                  { bar: '#DDD0BC', pct: '18%', lw: 60  },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-3 mb-3">
                    <div className="h-2.5 rounded flex-shrink-0" style={{ background: '#E8E0D2', width: row.lw }} />
                    <div className="flex-1 rounded-full overflow-hidden h-1.5" style={{ background: '#F2EDE6' }}>
                      <div className="h-full rounded-full" style={{ width: row.pct, background: row.bar }} />
                    </div>
                    <div className="h-2.5 w-5 rounded flex-shrink-0" style={{ background: '#DDD0BC' }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Overlay ── */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(242,237,230,0.5)', backdropFilter: 'blur(1px)' }}
        >
          <div
            className="flex flex-col items-center text-center px-12 py-9 rounded-2xl"
            style={{
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid #E8E0D2',
              boxShadow: '0 2px 48px rgba(0,0,0,0.07), 0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-3"
              style={{ color: '#C4BAB0' }}
            >
              Coming soon
            </div>
            <h2
              className="text-2xl font-bold tracking-tight mb-2"
              style={{ color: '#2A3A2C', letterSpacing: '-0.02em' }}
            >
              Citation Links
            </h2>
            <p className="text-sm max-w-[260px] leading-relaxed" style={{ color: '#9AAE9C' }}>
              Track where AI responses link to your product and your competitors.
            </p>
            <div
              className="mt-5 text-xs font-medium px-3.5 py-1.5 rounded-full"
              style={{ background: '#F2EDE6', color: '#B0A898', border: '1px solid #E8E0D2' }}
            >
              on its way
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
