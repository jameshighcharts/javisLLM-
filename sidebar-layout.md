# Sidebar Navigation — Exact Layout Spec

Source of truth: `ui/src/components/Layout.tsx`

---

## Desktop Sidebar

| Property | Value |
|---|---|
| Width | `220px` (fixed, `flex-shrink-0`) |
| Height | Full viewport (`h-[100dvh]`) |
| Background | `#3D5C40` |
| Right border | `1px solid rgba(255,255,255,0.08)` |
| Layout | `flex flex-col` |

---

### Header row

| Property | Value |
|---|---|
| Height | `56px` (`h-14`) |
| Padding | `0 16px` (`px-4`) |
| Gap between icon + text | `12px` (`gap-3`) |
| Bottom border | `1px solid rgba(255,255,255,0.08)` |

**App icon button**

| Property | Value |
|---|---|
| Size | `28×28px` (`w-7 h-7`) |
| Border radius | `6px` (`rounded-md`) |
| Background | `#4A6B4E` |
| Border | `1px solid rgba(255,255,255,0.12)` |
| Content | `<img>` covering full area (`object-cover`) |
| Hover | `opacity: 0.8` |

**App name text**

| Property | Value |
|---|---|
| Name ("Javis") | `13px`, `font-weight: 600`, `color: #FEFAE8`, `letter-spacing: tight` |
| Subtitle ("The Ai Visability Tracker") | `10px`, `font-weight: 400`, `color: #5A7A5E` |

---

### Nav area

| Property | Value |
|---|---|
| Padding | `8px` top/bottom (`py-3`), `8px` left/right (`px-2`) |
| Item gap | `2px` (`space-y-0.5`) |
| Overflow | `overflow-y-auto` (scrollable) |

**Standard nav item (NavLink)**

| State | Background | Color | Font weight |
|---|---|---|---|
| Default | `transparent` | `#8FBB93` | `400` |
| Hover | `rgba(255,255,255,0.07)` | `#C8A87A` | `400` |
| Active | `rgba(255,255,255,0.14)` | `#FDFCF8` | `500` |

| Property | Value |
|---|---|
| Padding | `7px 10px` |
| Border radius | `6px` |
| Font size | `13px` |
| Gap (icon → label) | `9px` |
| Transition | `all 0.1s` |

**Icon**

| Property | Value |
|---|---|
| Size | `15×15px` (`width="15" height="15"`) |
| ViewBox | `0 0 24 24` |
| Stroke | `currentColor`, `strokeWidth={1.75}` |
| Fill | `none` |
| Flex shrink | `0` |

**Nav items list**

| Label | Route | Icon shape |
|---|---|---|
| Dashboard | `/dashboard` | 4 rounded rectangles (2×2 grid) |
| Analytics | `/competitors` | Bar chart (3 bars ascending) — has children |
| Query Lab | `/query-lab` | Conical flask with horizontal line |
| Prompts | `/prompts` | Chat bubble with dots |
| Runs | `/runs` | Right arrow with horizontal line through it |

**Expandable group (Analytics)**

- Parent button: same padding/font/colors as standard nav item
- Chevron icon: `12×12px`, `strokeWidth={2}`, rotates `90deg` when open (transition `0.15s ease`)
- Children indented: `padding: 7px 10px 7px 30px` (left indent `30px`)
- Child font size: `12px`
- Child bullet icon: `12×12px` circle dot (`<circle cx="12" cy="12" r="2.5" />`)

**"Soon" badge** (when `item.soon === true`)

| Property | Value |
|---|---|
| Font size | `9px` |
| Font weight | `600` |
| Text | `SOON` uppercase |
| Letter spacing | `0.06em` |
| Padding | `2px 6px` (`px-1.5 py-0.5`) |
| Border radius | `full` |
| Background | `rgba(255,255,255,0.10)` |
| Color | `rgba(255,255,255,0.35)` |

---

### Footer

| Property | Value |
|---|---|
| Padding | `16px` (`px-4 py-4`) |
| Top border | `1px solid rgba(255,255,255,0.08)` |
| Item gap | `6px` (`space-y-1.5`) |

**API status indicator**

| Property | Value |
|---|---|
| Dot size | `6px` (`w-1.5 h-1.5`), `rounded-full` |
| Dot color (ok) | `#22c55e` |
| Dot color (error) | `#ef4444` |
| Label text | `11px`, `color: #8FBB93` |
| Gap | `8px` (`gap-2`) |

**Data source label**

| Property | Value |
|---|---|
| Font size | `11px` |
| Color | `#4A6848` |
| Content | `"supabase"` or `":8787"` depending on env |

---

## Mobile Drawer

| Property | Value |
|---|---|
| Width | `270px` max, capped at `88vw` |
| Background | `#3D5C40` |
| Right border | `1px solid rgba(255,255,255,0.08)` |
| Open transform | `translateX(0)` |
| Closed transform | `translateX(-100%)` |
| Transition | `transform 0.22s ease` |
| Backdrop | `rgba(0,0,0,0.38)` overlay, `transition: background 0.2s ease` |

Header height: `56px` (`h-14`). Has close `×` button (`32×32px`, `rounded-md`).

Nav item padding: `10px 10px` (vs `7px 10px` on desktop).
Child item padding: `8px 10px 8px 32px`.
Font sizes and colors identical to desktop.

---

## Mobile Bottom Nav (≤ md breakpoint)

| Property | Value |
|---|---|
| Position | `fixed inset-x-0 bottom-0 z-30` |
| Background | `rgba(253,252,248,0.98)` |
| Backdrop filter | `blur(10px)` |
| Top border | `1px solid #DDD0BC` |
| Bottom padding | `env(safe-area-inset-bottom)` |
| Layout | `grid grid-cols-5` |

**Each tab item**

| State | Color | Background | Top border |
|---|---|---|---|
| Default | `#7A8E7C` | `transparent` | `2px solid transparent` |
| Active | `#2A3A2C` | `rgba(143,187,147,0.14)` | `2px solid #8FBB93` |

| Property | Value |
|---|---|
| Min height | `56px` |
| Layout | `flex flex-col items-center justify-center` |
| Gap (icon → label) | `4px` (`gap-1`) |
| Padding | `8px 4px` (`pt-2 pb-2 px-1`) |
| Font size | `11px` |
| Font weight | Active `600`, default `500` |
| Line height | `1.1` |

---

## Top Header Bar (content area)

| Property | Value |
|---|---|
| Min height | `56px` (`min-h-14`) |
| Padding | `0 16px` mobile (`px-4`), `0 24px` sm+ (`sm:px-6`), `8px` vertical (`py-2`) |
| Background | `#FDFCF8` |
| Bottom border | `1px solid #DDD0BC` |
| Page title | `14px` (`text-sm`), `font-weight: 600`, `color: #2A3A2C`, `tracking-tight` |

---

## Color Palette Reference

| Token | Hex | Used for |
|---|---|---|
| Sidebar bg | `#3D5C40` | Sidebar background |
| Nav icon default | `#8FBB93` | Inactive nav icon/label |
| Nav icon hover | `#C8A87A` | Hovered nav item |
| Nav item active bg | `rgba(255,255,255,0.14)` | Active nav item background |
| Nav item hover bg | `rgba(255,255,255,0.07)` | Hovered nav item background |
| App name | `#FEFAE8` | Sidebar app name |
| Subtitle | `#5A7A5E` | Sidebar subtitle text |
| Footer label | `#4A6848` | Footer data source label |
| Divider | `rgba(255,255,255,0.08)` | All sidebar internal borders |
| Icon button bg | `#4A6B4E` | App icon button background |
| Content bg | `#F2EDE6` | Main content area |
| Header bg | `#FDFCF8` | Top header bar |
| Header border | `#DDD0BC` | Top header bottom border |
