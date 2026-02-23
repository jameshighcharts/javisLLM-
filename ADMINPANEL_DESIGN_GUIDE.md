# Admin Panel Design Guide (Styling + Layout)

This is a visual spec for reusing the same admin-panel look and feel in new pages.
It focuses on design only (not app logic).

## 1. Visual Direction

- Clean data-heavy interface.
- Light mode default, dark mode fully supported.
- Soft card surfaces, subtle borders, compact spacing.
- Dense but readable dashboard rhythm.

## 2. Core Layout Blueprint

### Desktop shell

- Left sidebar:
  - Expanded width: `14rem`
  - Collapsed icon width: `3rem`
- Content area:
  - Main wrapper padding: `px-4 pb-4 pt-2`
  - Full-height flex layout with sidebar + content panel

### Mobile shell

- Sidebar switches to sheet/drawer style
- Drawer width: `16rem`

### Motion

- Sidebar width/collapse transitions are fast and linear:
  - `duration-200`
  - `ease-linear`

## 3. Design Tokens (Exact)

Defined in `frontend/src/app/globals.css`.

### Light mode

- `--background: #fff`
- `--foreground: #020817`
- `--card: #fff`
- `--muted: #f1f5f9`
- `--muted-foreground: #64748b`
- `--border: #e2e8f0`
- `--primary: #0f172a`
- `--radius: 0.6rem`

### Dark mode

- `--background: #070d1a`
- `--foreground: #f1f5f9`
- `--card: #0e1829`
- `--muted: #131f33`
- `--muted-foreground: #94a3b8`
- `--border: #1e2d45`
- `--ring: #cbd5e1`

### Chart palette

- `--chart-1: #9198F0`
- `--chart-2: #6DDFA0`
- `--chart-3: #F7A85E`
- `--chart-4: #7DBFCE`
- `--chart-5: #EBD95F`

## 4. Sidebar Visual Spec

Main files:

- `frontend/src/components/app-sidebar.tsx`
- `frontend/src/components/ui/sidebar.tsx`
- `frontend/src/components/sidebar/nav-data.ts`
- `frontend/src/components/sidebar/nav-group.tsx`

### Header zone

- Top row includes:
  - toggle button (`size-8`, rounded, subtle border)
  - brand block with logo tile and product name
- Search + theme controls on second row.

### Collapsed behavior (important for matching look)

- In icon-collapsed state:
  - hide brand text block
  - hide search row
  - keep compact icon navigation

### Nav item styling

- Primary nav button:
  - rounded medium corners
  - default height `h-8`
  - large variant `h-12`
  - icon + label horizontal alignment
- Active and hover states use sidebar accent surface.
- Sub-items are indented with a left border rail for hierarchy.

### Footer zone

- User card row mirrors header style:
  - avatar + name/email + chevron
  - same rounded/spacing language as top brand row

## 5. Typography + Density

- Font family: `Inter`, fallback system sans.
- Typical hierarchy:
  - page title: `text-2xl font-bold tracking-tight`
  - card titles: medium/semibold
  - support text: `text-sm text-muted-foreground`
- Data-first spacing:
  - page stack spacing often `space-y-4`
  - compact controls and tight card paddings

## 6. Page Composition Pattern

To keep new pages visually consistent:

1. Start with a title row and small muted description.
2. Use cards as primary content containers.
3. Keep chart/table sections in consistent vertical rhythm (`space-y-4` or `space-y-5`).
4. Use existing token colors (`foreground`, `muted-foreground`, `border`, `card`) instead of hardcoded colors.

## 7. Consistency Rules (Design)

Do:

- Reuse token-based colors from `globals.css`.
- Keep card radii and border softness consistent.
- Keep sidebar/nav dimensions unchanged.
- Keep compact vertical spacing and dashboard density.

Avoid:

- New ad-hoc color palettes per page.
- Bigger/louder component radii than existing shell.
- Changing sidebar widths or collapse behavior if you want the same look.
- Mixing very different typography scales.

## 8. Quick Checklist For New Pages

- Uses existing app shell (same sidebar + content inset)?
- Uses token colors only?
- Uses the same title/description rhythm?
- Uses cards and section spacing consistent with existing dashboards?
- Looks correct in both light and dark mode?
