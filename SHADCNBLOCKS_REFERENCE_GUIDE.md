# Shadcnblocks Admin Reference Config Analysis Guide

A step-by-step methodology for inspecting every page and tab on [https://shadcnblocks-admin.vercel.app/](https://shadcnblocks-admin.vercel.app/) and extracting the exact layout, spacing, and component configs needed to replicate them locally.

---

## Table of Contents

1. [Overview of the Reference Site](#1-overview-of-the-reference-site)
2. [Tooling Setup](#2-tooling-setup)
3. [General Inspection Methodology](#3-general-inspection-methodology)
4. [Page-by-Page Reference Configs](#4-page-by-page-reference-configs)
   - [Dashboard 1 — Overview Tab](#41-dashboard-1--overview-tab)
   - [Dashboard 1 — Analytics Tab](#42-dashboard-1--analytics-tab)
   - [Dashboard 1 — Reports & Notifications Tabs](#43-dashboard-1--reports--notifications-tabs)
   - [Dashboard 2](#44-dashboard-2)
   - [Dashboard 3](#45-dashboard-3)
   - [Tasks](#46-tasks)
   - [Users](#47-users)
5. [Shared Component Configs](#5-shared-component-configs)
   - [Card Component](#51-card-component)
   - [Sidebar](#52-sidebar)
   - [Tab Triggers](#53-tab-triggers)
6. [Systematic Playwright Inspection Script](#6-systematic-playwright-inspection-script)
7. [Common Pitfalls](#7-common-pitfalls)
8. [Diff Checklist](#8-diff-checklist)

---

## 1. Overview of the Reference Site

The reference is built with **Next.js + shadcn/ui (old card API)** — specifically, it uses an older version of the Card primitives where padding lives in the card's children (CardHeader, CardContent), not on the card wrapper itself.

### Site Map

| Route | Page Name | Tabs |
|---|---|---|
| `/` | Dashboard 1 | Overview, Analytics, ~~Reports~~, ~~Notifications~~ |
| `/dashboard-2` | Dashboard 2 | None |
| `/dashboard-3` | Dashboard 3 | None |
| `/tasks` | Tasks | None |
| `/users` | Users | None |

> **Note:** Reports and Notifications tabs on Dashboard 1 are disabled (`disabled` attribute on the tab trigger). Do not waste time trying to click them via Playwright — they will timeout.

### Sidebar Layout

The sidebar is **240px wide** at all viewports. The main content area begins at `x: 240px`. The reference uses a collapsible sidebar with icon-only mode at narrow breakpoints. At 1440px, the sidebar is always expanded.

---

## 2. Tooling Setup

All inspection work is done with headless Playwright (Python). Install if needed:

```bash
pip install playwright
playwright install chromium
```

Always use a **1440×900 viewport** to match the reference's full-width layout. Narrower viewports activate responsive breakpoints and produce different class sets.

```python
browser = p.chromium.launch(headless=True)
page = browser.new_page(viewport={"width": 1440, "height": 900})
```

Always wait for `networkidle` before inspecting, then add a short fixed wait for JS-driven chart renders:

```python
page.goto(url, wait_until="networkidle")
page.wait_for_timeout(1000)
```

---

## 3. General Inspection Methodology

For any page or tab, run through these five extraction steps in order.

### Step 1 — Screenshot First

Take a full-page screenshot before touching the DOM. This is your ground truth for visual comparison.

```python
page.screenshot(path="/tmp/ref_page.png", full_page=True)
```

### Step 2 — Extract the Main Grid

Locate the outermost content grid — the one that controls the overall card layout. Look for `[class*="grid-cols"]` elements with `width > 800px`.

```python
grids = page.locator('[class*="grid"]').all()
for g in grids:
    cls = g.get_attribute("class")
    box = g.bounding_box()
    if box and box["width"] > 800:
        print(cls, box)
```

Key values to record per grid:
- `grid-cols-N` — number of columns
- `gap-N` — gap between cells (in Tailwind rem units: gap-5 = 1.25rem = 20px)
- `auto-rows-auto` vs explicit `grid-rows-N`
- Responsive prefixes: `md:`, `lg:`, `xl:`

### Step 3 — Extract Col-Span Patterns

Each card's column span tells you how wide it is relative to the parent grid.

```python
import re
html = page.locator('[role="tabpanel"]').first.inner_html()
# or: html = page.locator("main").first.inner_html()
col_spans = re.findall(r'class="([^"]*col-span[^"]*)"', html)
for span in set(col_spans):
    print(span)
```

### Step 4 — Measure Bounding Boxes

Pixel measurements give you exact heights to verify against. Focus on:
- The main grid container (overall layout height)
- Individual cards (height tells you if padding is correct)
- KPI mini-cards (should be ~108px at 1440px for the reference)
- Chart containers

```python
cards = page.locator('[class*="rounded-xl border shadow-sm"]').all()
for i, card in enumerate(cards[:10]):
    box = card.bounding_box()
    print(f"Card {i}: h={box['height']:.0f} w={box['width']:.0f} y={box['y']:.0f}")
```

### Step 5 — Extract Raw HTML of Tab Panels / Content

For precise class inspection, extract the inner HTML of the content area and write it to a file. Then regex-search it offline without re-fetching the page.

```python
panels = page.locator('[role="tabpanel"]').all()
for panel in panels:
    if panel.is_visible():
        with open("/tmp/ref_tab.html", "w") as f:
            f.write(panel.inner_html())
        break
```

Then inspect locally:

```python
with open("/tmp/ref_tab.html") as f:
    html = f.read()

# Find all unique grid patterns
grids = re.findall(r'class="([^"]*grid-cols[^"]*)"', html)
for g in set(grids): print(g)

# Find all card-level class strings
cards = re.findall(r'class="(bg-card[^"]*)"', html)
for c in set(cards): print(c)
```

---

## 4. Page-by-Page Reference Configs

### 4.1 Dashboard 1 — Overview Tab

**Route:** `/`
**Tab:** Overview (default active)

#### Main Grid

```
grid auto-rows-auto grid-cols-3 gap-5 md:grid-cols-6 lg:grid-cols-9
```

- **Baseline:** 3 columns on mobile
- **md (768px+):** 6 columns
- **lg (1024px+):** 9 columns
- **Gap:** `gap-5` = 1.25rem = 20px

#### Card Layout (at 1440px — lg grid = 9 cols)

| Card | col-span class | Width |
|---|---|---|
| Stat Card 1 (New Subscriptions) | `col-span-3 lg:col-span-2 xl:col-span-2` | 2/9 cols |
| Stat Card 2 (New Orders) | `col-span-3 lg:col-span-2 xl:col-span-2` | 2/9 cols |
| Stat Card 3 (Avg Order Revenue) | `col-span-3 lg:col-span-2 xl:col-span-2` | 2/9 cols |
| Total Revenue (KPI + mini chart) | `col-span-3` | 3/9 cols |
| Sale Activity chart | `col-span-3 md:col-span-6` | full width (6/9 at md, 3/9 alone) |
| Subscriptions | `col-span-3 md:col-span-6 lg:col-span-3` | 3/9 at lg |
| Payments table | `col-span-3 md:col-span-6 lg:col-span-5 xl:col-span-6` | 6/9 at xl |
| Team Members | `col-span-3 md:col-span-6 lg:col-span-4 xl:col-span-3` | 3/9 at xl |

#### Measured Dimensions (at 1440×900)

- Main grid: `width=1152px, height=970px`
- Stat cards: `height≈148px`
- Total Revenue card: same row as stat cards, taller due to mini-chart

#### Stat Card Internal Structure

```html
<Card className="h-full w-full">                        <!-- no py-6/gap-6! -->
  <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
    <CardTitle className="text-sm font-medium">…</CardTitle>
    <Icon />
  </CardHeader>
  <CardContent className="px-4 pb-4">
    <div className="text-2xl font-bold">value</div>
    <p className="text-xs text-muted-foreground">label</p>
    <sparkline />
  </CardContent>
</Card>
```

---

### 4.2 Dashboard 1 — Analytics Tab

**Route:** `/`
**Tab:** Analytics

#### Main Grid

```
grid auto-rows-auto grid-cols-6 gap-5
```

- 6 columns, uniform at all breakpoints (responsive handled per-card)
- Gap: `gap-5` = 20px

#### Card Layout

| Card | col-span class | Description |
|---|---|---|
| Sales | `col-span-6 xl:col-span-3` | Half-width at xl, full at lg and below |
| Visitors | `col-span-6 xl:col-span-3` | Half-width at xl, full at lg and below |
| Traffic Source | `col-span-6 lg:col-span-3 xl:col-span-2` | Third-width at xl |
| Customers | `col-span-6 lg:col-span-3 xl:col-span-2` | Third-width at xl |
| Buyers Profile | `col-span-6 lg:col-span-3 xl:col-span-2` | Third-width at xl |

#### Sales / Visitors Card Internal Grid

```
grid grid-cols-4 gap-4 sm:grid-cols-5 sm:grid-rows-2
```

| Cell | class | Content |
|---|---|---|
| KPI card 1 | `col-span-2 row-start-1 row-end-2` | Net Sales / New Visitors |
| KPI card 2 | `col-span-2 sm:row-start-2 sm:row-end-3` | Orders / Returning |
| Chart | `col-span-4 sm:col-span-3 sm:row-span-3` | Bar / Area chart |

#### Measured Dimensions (at 1440×900)

| Element | Width | Height |
|---|---|---|
| Main grid | 1152px | 796px |
| Sales card | 566px | 404px |
| Visitors card | 566px | 404px |
| KPI mini-card (Net Sales) | 197px | 108px |
| KPI mini-card (Orders) | 197px | 108px |
| Inner content grid | 516px | 248px |
| Chart area | 303px | 240px (max-h-[240px]) |
| Traffic Source card | 371px | 372px |
| Customers card | 371px | 372px |
| Buyers Profile card | 371px | 372px |

#### KPI Mini-Card Class Structure

```html
<!-- Card outer — OLD shadcn style, no py-6/gap-6 -->
<div class="text-card-foreground rounded-xl border shadow-sm bg-muted h-full w-full">
  <!-- Header: base p-6 overridden to px-4 pt-2 pb-2 -->
  <div class="space-y-1.5 p-6 flex flex-row items-center justify-between px-4 pt-2 pb-2">
    <div class="tracking-tight flex items-center gap-2 text-sm font-medium">Title</div>
    <InfoCircle icon />
  </div>
  <!-- Content: base p-6 overridden to px-4 pt-0 pb-3 -->
  <div class="p-6 px-4 pt-0 pb-3">
    <div class="text-lg font-bold sm:text-2xl">$4,567,820</div>
    <div class="flex items-center gap-1 text-xs font-medium text-emerald-500">
      <TrendingUp icon /> 24.5% (+10)
    </div>
  </div>
</div>
```

**Effective padding at 1440px:**
- Header: `pt-2` (8px) / `pb-2` (8px) / `px-4` (16px)
- Content: `pt-0` / `pb-3` (12px) / `px-4` (16px)

#### Large Card (Sales/Visitors) Class Structure

```html
<!-- Card outer — OLD shadcn style -->
<div class="bg-card text-card-foreground rounded-xl border shadow-sm h-full w-full">
  <!-- Header: p-4 sm:p-6 -->
  <div class="flex flex-col space-y-1.5 p-4 sm:p-6">
    <div class="flex items-center justify-between">
      <div class="font-semibold tracking-tight text-lg">Sales</div>
      <TabsList Month/Week />
    </div>
    <div class="text-muted-foreground text-sm">Visualize sales performance trends</div>
  </div>
  <!-- Content: p-4 pt-0 sm:p-6 -->
  <div class="p-4 pt-0 sm:p-6">
    <div class="grid grid-cols-4 gap-4 sm:grid-cols-5 sm:grid-rows-2">
      <!-- KPI cards + chart -->
    </div>
  </div>
</div>
```

**Critical:** At `sm` (640px+) the CardContent `sm:p-6` sets `pt=24px`. This adds 24px of top padding above the inner grid, which is part of the total card height.

#### Bottom Row Cards (Traffic Source / Customers / Buyers Profile)

```html
<div class="bg-card text-card-foreground rounded-xl border shadow-sm h-full w-full">
  <!-- Header: flex flex-col space-y-1.5 p-6 -->
  <div class="flex flex-col space-y-1.5 p-6">
    <div class="flex items-center justify-between">
      <div class="font-semibold tracking-tight">Traffic Source</div>
      <TabsList or DotsMenu />
    </div>
    <div class="text-muted-foreground text-sm">Description</div>
  </div>
  <!-- Content: p-6 pt-0 -->
  <div class="p-6 pt-0">
    <Chart />
  </div>
  <!-- Footer (if present): flex items-center p-6 pt-0 -->
  <div class="flex items-center p-6 pt-0 flex-col gap-2 text-sm">
    Trending up by 5.2% this month
  </div>
</div>
```

---

### 4.3 Dashboard 1 — Reports & Notifications Tabs

These tabs have `disabled` attributes on their trigger buttons in the reference:

```html
<button disabled role="tab" data-disabled="" data-state="inactive" …>Reports</button>
```

**Do not attempt to click them with Playwright** — you will get a 30-second timeout.

In the local implementation, these tabs are implemented as placeholders (a simple table for Reports, a "coming soon" message for Notifications). No layout replication is needed from the reference for these tabs.

---

### 4.4 Dashboard 2

**Route:** `/dashboard-2`

#### Page Header

- Title: "Dashboard" with subtitle "Here're the details of your analysis."
- Actions: "Filter By" button + "Export" (primary) button

#### Main Grid

```
grid grid-cols-6 gap-5 lg:grid-cols-12
```

- **Default:** 6 columns
- **lg (1024px+):** 12 columns
- **Gap:** `gap-5` = 20px

#### Card Layout (at 1440px — 12 col grid)

**Row 1 — KPI Stats (4 cards)**

```
col-span-6        → first card (left half)
col-span-6        → second card (right half)  [uses nested grid]
```

The left two KPI cards use a **nested grid**:

```
col-span-6 grid grid-cols-6 gap-4
```

Inside which each stat card is:
```
col-span-3   →  Total Sales
col-span-3   →  Total Orders
col-span-3   →  Total Visitors
col-span-3   →  Refunded
```

The right column (Revenue chart):

```
col-span-6 lg:col-span-8   →  Revenue bar chart card
col-span-6 lg:col-span-4   →  (if separate column)
```

#### Measured Dimensions (at 1440×900)

| Element | Width | Height |
|---|---|---|
| Main grid | 1152px | 811px |
| KPI stat card (Total Sales) | ~275px | ~178px |
| Revenue chart card | ~759px | ~280px |
| Recent Activity table | ~693px | ~450px |
| Total Visitor donut card | ~440px | ~450px |

#### KPI Stat Card Structure

```html
<div class="bg-card text-card-foreground rounded-xl border shadow-sm h-full w-full">
  <div class="flex flex-col space-y-1.5 p-6">
    <div class="flex items-center gap-2 font-medium text-sm">
      <ColoredIcon />  Total Sales
      <MoreHorizontal />
    </div>
  </div>
  <div class="p-6 pt-0">
    <div class="text-3xl font-bold">$4,523,189</div>
    <div class="text-emerald-500 text-sm">↗ 10.2% +$1,454.89 today</div>
    <a class="text-sm font-medium">View Report →</a>
  </div>
</div>
```

---

### 4.5 Dashboard 3

**Route:** `/dashboard-3`

#### Page Header

- Title: "Overview Dashboard" with subtitle "Here, take a look at your sales."
- Actions: "Pick a date" + "Filter By" button

#### Main Grid

```
grid auto-rows-auto grid-cols-12 gap-5
```

- 12 columns at all viewports (responsive handled per card)
- `auto-rows-auto` for natural row height
- **Gap:** `gap-5` = 20px

#### Card Layout (at 1440px)

| Card | col-span class | Content |
|---|---|---|
| Budgets Consolidated (wide) | `col-span-12 xl:col-span-8` | Title + Desktop/Mobile KPIs + bar chart |
| Total Visitors Shape | `col-span-12 xl:col-span-4` | Donut chart + trending |
| Session | `col-span-12 lg:col-span-6 xl:col-span-3` | KPI stat |
| Page Views | `col-span-12 lg:col-span-6 xl:col-span-3` | KPI stat |
| Sales By Month | `col-span-12 lg:col-span-6 xl:col-span-3` | Radar / polar chart |
| Overview | `col-span-12 lg:col-span-6 xl:col-span-3` | Grouped bar chart |

#### Nested Grid Inside "Budgets Consolidated"

```
col-span-12 grid grid-cols-4 gap-5 lg:col-span-6 xl:col-span-5
```

Inside this sub-grid, the Desktop and Mobile KPI inline stats:
```
col-span-2   →  Desktop: 24,828
col-span-2   →  Mobile: 25,010
```

#### Measured Dimensions (at 1440×900)

| Element | Width | Height |
|---|---|---|
| Main grid | 1152px | 739px |
| Budgets card | ~768px | ~390px |
| Total Visitors Shape card | ~365px | ~390px |
| Bottom KPI cards (Session, Page Views) | ~265px | ~155px |
| Sales By Month radar card | ~265px | ~310px |

---

### 4.6 Tasks

**Route:** `/tasks`

#### Page Header

- Title: "Tasks" with subtitle "Here's a list of your tasks for this month!"
- Actions: "Import" (outline) + "Create Task" (primary) buttons

#### Layout

This page has **no grid** — it uses a full-width single column layout:

```
<div class="flex flex-1 flex-col">
  <header />           ← page title + action buttons
  <toolbar />          ← filter input + Status/Priority filter chips + View button
  <table />            ← data table
  <pagination />       ← row count + page controls
</div>
```

#### Filter Bar

```html
<div class="flex items-center gap-2 py-4">
  <Input placeholder="Filter tasks..." class="max-w-sm h-8" />
  <Button variant="outline" size="sm">+ Status</Button>
  <Button variant="outline" size="sm">+ Priority</Button>
  <Button variant="outline" size="sm" class="ml-auto">View ⚙</Button>
</div>
```

#### Table Structure

- 5 columns: **checkbox | Task ID | Type badge | Title | Status | Priority | Edit | More**
- Full-width: `width: 1152px` (sidebar-adjusted content area)
- Rows: `height ≈ 52px` per row
- Pagination: "0 of 100 row(s) selected" · "Rows per page: 10" · page controls
- Table uses a rounded border container: `rounded-md border`

#### Status Badge Colors

| Status | Color |
|---|---|
| In Progress | Blue/indigo border badge |
| Backlog | Muted grey badge |
| Todo | Grey outline badge |
| Done | Green badge |
| Canceled | Strikethrough / muted |

#### Priority Values & Icons

| Priority | Icon direction |
|---|---|
| High | Arrow up ↑ |
| Medium | Arrow right → |
| Low | Arrow down ↓ |

---

### 4.7 Users

**Route:** `/users`

#### Page Header

- Breadcrumb: `Home > Users`
- Title: "User List"
- Actions: "Invite User" (outline + icon) + "Add User" (primary + icon)

#### KPI Stats Row

```
grid gap-4 sm:grid-cols-2 lg:grid-cols-4
```

4 cards side by side at `lg`:

| Card | Value |
|---|---|
| Total Users | 12,000 |
| New Users | +350 |
| Pending Verifications | 42 |
| Active Users | 7,800 |

**Measured:** `height=114px` per stat card.

Each stat card uses the OLD card structure:

```html
<div class="bg-card text-card-foreground rounded-xl border shadow-sm">
  <div class="flex flex-col space-y-1.5 p-6">
    <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Icon />  Total Users  <InfoCircle />
    </div>
  </div>
  <div class="p-6 pt-0">
    <div class="text-3xl font-bold">12,000</div>
    <p class="text-xs text-muted-foreground">+5% than last month</p>
  </div>
</div>
```

#### Table

Same full-width table pattern as Tasks:
- Columns: **checkbox | Name | Email | Phone Number | Registered Date | Last Login Date | Status | Role | More**
- Filter bar: Filter input + Status/Role filter chips + View button
- Pagination: "0 of 30 row(s) selected" · "Rows per page: 10" · page controls

#### Status Badge Colors (Users)

| Status | Badge style |
|---|---|
| Active | Green outline |
| Inactive | Grey/muted |
| Invited | Blue |
| Suspended | Red/orange |

---

## 5. Shared Component Configs

### 5.1 Card Component

The reference uses the **old shadcn/ui Card API** (pre-2024). The critical difference from the current shadcn/ui default:

| | Old API (reference) | New API (current shadcn default) |
|---|---|---|
| Card outer | `rounded-xl border shadow-sm` | `flex flex-col gap-6 rounded-xl border py-6 shadow-sm` |
| CardHeader | `flex flex-col space-y-1.5 p-6` | `grid px-6` (no vertical padding) |
| CardContent | `p-6 pt-0` | `px-6` (no vertical padding) |
| CardFooter | `flex items-center p-6 pt-0` | `flex items-center px-6` |

**Effect:** The new API moves vertical spacing to the card wrapper (`py-6`) and removes it from children. This adds ~72px of extra height per card compared to the reference.

**Fix for local implementation (without reverting `card.tsx` globally):** Override with `py-0 gap-0` on the Card className for any Analytics-section card:

```tsx
// Large chart cards
<Card className="h-full w-full py-0 gap-0">
  <CardHeader className="p-4 sm:p-6">…</CardHeader>
  <CardContent className="p-4 pt-0 sm:p-6">…</CardContent>
</Card>

// KPI mini-cards (bg-muted variant)
<Card className="h-full w-full bg-muted py-0 gap-0">
  <CardHeader className="flex flex-row items-center justify-between px-4 pt-2 pb-2">…</CardHeader>
  <CardContent className="px-4 pt-0 pb-3">…</CardContent>
</Card>

// Bottom row cards (Traffic Source, Customers, Buyers Profile)
<Card className="h-full w-full py-0 gap-0">
  <CardHeader className="p-6">…</CardHeader>
  <CardContent className="p-6 pt-0">…</CardContent>
</Card>
```

This works because the `cn()` utility uses `tailwind-merge`, which resolves `py-6` vs `py-0` conflicts in favour of the override.

### 5.2 Sidebar

```
width: 240px (expanded)
```

The sidebar uses `SidebarProvider` with a collapsible icon-only mode. At 1440px it is always expanded. Key class patterns:

```
border-grid flex flex-1 flex-col    ← outer layout shell
w-[--sidebar-width]                  ← CSS variable driven width
```

The sidebar width CSS variable is `--sidebar-width: 16rem` (256px in the reference, ~240px local depending on padding adjustments).

### 5.3 Tab Triggers

The outer `TabsList` for the main Dashboard 1 tabs (horizontal, text + icon):

```html
<div role="tablist" class="inline-flex h-9 items-center text-muted-foreground …">
  <button role="tab" data-state="active">Overview</button>
  <button role="tab" data-state="inactive">Analytics</button>
  <button role="tab" data-state="inactive" disabled>Reports</button>
  <button role="tab" data-state="inactive" disabled>Notifications</button>
</div>
```

The inner `TabsList` for Month/Week toggles inside cards:

```html
<div role="tablist" class="bg-muted text-muted-foreground items-center justify-center rounded-lg grid h-auto w-full grid-cols-2 p-[3px]">
  <button role="tab" class="… py-[3px]">Month</button>
  <button role="tab" class="… py-[3px]">Week</button>
</div>
```

Key classes for the Month/Week toggle list:
```
bg-muted text-muted-foreground
items-center justify-center rounded-lg
grid h-auto w-full grid-cols-2
p-[3px]
```

Width is explicitly set: `w-[130px]` or `w-full` depending on context.

---

## 6. Systematic Playwright Inspection Script

Use this script as a starting point for any new page or tab. Run it once to capture all the raw data you need.

```python
"""
Reference site inspector — captures grid layout, col-spans,
card dimensions, and visible tab panel HTML for any route.

Usage:
    python inspect_page.py <route> [tab_name]

Examples:
    python inspect_page.py /
    python inspect_page.py / Analytics
    python inspect_page.py /dashboard-2
    python inspect_page.py /users
"""

import sys, re, json
from playwright.sync_api import sync_playwright

BASE_URL = "https://shadcnblocks-admin.vercel.app"
VIEWPORT = {"width": 1440, "height": 900}

def inspect(route="/", tab_name=None):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(f"{BASE_URL}{route}", wait_until="networkidle")
        page.wait_for_timeout(1000)

        # Navigate to tab if specified
        if tab_name:
            tab = page.locator('[role="tab"]', has_text=tab_name)
            if tab.count() > 0 and tab.first.is_enabled():
                tab.first.click()
                page.wait_for_timeout(800)
            else:
                print(f"WARNING: Tab '{tab_name}' not found or disabled")

        # Screenshot
        slug = route.strip("/") or "root"
        if tab_name:
            slug += f"_{tab_name.lower()}"
        page.screenshot(path=f"/tmp/ref_{slug}.png", full_page=True)
        print(f"Screenshot: /tmp/ref_{slug}.png")

        # Main grids
        print("\n=== GRID CONTAINERS ===")
        for g in page.locator('[class*="grid-cols"]').all():
            cls = g.get_attribute("class") or ""
            box = g.bounding_box()
            if box and box["width"] > 400:
                print(f"  {cls[:100]}")
                print(f"    -> w={box['width']:.0f} h={box['height']:.0f} y={box['y']:.0f}")

        # Tab panel HTML
        print("\n=== COL-SPAN PATTERNS ===")
        for panel in page.locator('[role="tabpanel"]').all():
            if panel.is_visible():
                html = panel.inner_html()
                spans = set(re.findall(r'class="([^"]*col-span[^"]*)"', html))
                for s in sorted(spans):
                    print(f"  {s[:80]}")
                with open(f"/tmp/ref_{slug}.html", "w") as f:
                    f.write(html)
                print(f"  (full HTML -> /tmp/ref_{slug}.html)")
                break

        # Card bounding boxes
        print("\n=== CARD DIMENSIONS ===")
        cards = page.locator('[class*="rounded-xl border shadow-sm"]').all()
        for i, card in enumerate(cards[:10]):
            box = card.bounding_box()
            if box:
                print(f"  Card {i}: h={box['height']:.0f} w={box['width']:.0f} x={box['x']:.0f} y={box['y']:.0f}")

        browser.close()

route = sys.argv[1] if len(sys.argv) > 1 else "/"
tab = sys.argv[2] if len(sys.argv) > 2 else None
inspect(route, tab)
```

### Running the Script

```bash
# Dashboard 1, Overview tab (default)
python inspect_page.py /

# Dashboard 1, Analytics tab
python inspect_page.py / Analytics

# Dashboard 2
python inspect_page.py /dashboard-2

# Dashboard 3
python inspect_page.py /dashboard-3

# Tasks
python inspect_page.py /tasks

# Users
python inspect_page.py /users
```

---

## 7. Common Pitfalls

### Pitfall 1: Card API Version Mismatch

The single biggest source of sizing errors. The reference uses the old Card API; the current shadcn/ui default ships the new API. Any mismatch adds ~72px of vertical space per card.

**How to detect:** Check if the rendered card HTML contains `py-6` and `gap-6` on the outermost card `div`. If yes, you have the new API. The reference never has these on the outer wrapper.

```python
cards_html = page.locator('[data-slot="card"]').first.get_attribute("class")
print(cards_html)   # should NOT contain py-6/gap-6 for reference
```

### Pitfall 2: Inspecting Before JS Renders

Charts (Recharts/Highcharts) render after hydration. If you measure bounding boxes immediately after `networkidle`, chart containers may be 0px tall.

**Fix:** Add `page.wait_for_timeout(1000)` after `networkidle`. For heavy chart pages (Dashboard 3), use `1500ms`.

### Pitfall 3: Clicking Disabled Tabs

Reports and Notifications tabs on Dashboard 1 have `disabled` on the button. Playwright's `locator.click()` will wait 30 seconds before failing.

**Fix:** Check `is_enabled()` before clicking:

```python
tab = page.locator('[role="tab"]', has_text="Reports")
if tab.count() > 0 and tab.first.is_enabled():
    tab.first.click()
else:
    print("Tab is disabled, skipping")
```

### Pitfall 4: Tailwind-Merge Class Conflicts

When overriding card classes with `className` prop, conflicting utilities (e.g. both `py-6` and `py-0`) must be resolved by `tailwind-merge`. If your `cn()` utility uses `tailwind-merge`, overrides work correctly. If it only uses `clsx`, both classes appear and CSS cascade order determines which wins (unpredictable).

**Verify your utils:**

```ts
// lib/utils.ts — must use twMerge for overrides to work
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### Pitfall 5: `sm:p-6` vs `sm:px-6 sm:pb-6`

For large Analytics tab cards, the reference uses `p-4 pt-0 sm:p-6` on CardContent. The `sm:p-6` sets **all four sides** at sm+, including `pt=24px`. Using `sm:px-6 sm:pb-6` instead omits the top padding at sm+, making the inner grid start flush against the header — 24px too tight.

### Pitfall 6: Viewport Width Matters for Responsive Classes

The reference site breakpoints:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

At 1440px viewport, `xl:` classes are active. This is why Analytics cards go from `col-span-6` (full width) to `xl:col-span-3` (half width). Always inspect at **1440px wide** to see the same layout as the reference screenshots.

### Pitfall 7: `h-full` Inside Auto-Rows Grids

Cards with `h-full` inside `auto-rows-auto` grids create a circular sizing dependency. The card tries to fill the grid cell, but the cell size is determined by the card content. In practice, the card's intrinsic height (from its children) sets the row height, and `h-full` just confirms the card fills the row — it does not cause infinite loops but can mask incorrect content heights.

---

## 8. Diff Checklist

After applying changes, run through this checklist to verify a page matches the reference.

### Layout Checklist

- [ ] Main grid `grid-cols-N` matches reference
- [ ] `gap-N` on main grid matches reference
- [ ] Each card's `col-span` and responsive breakpoints match
- [ ] `auto-rows-auto` vs `grid-rows-N` matches (affects implicit row creation)

### Card Spacing Checklist

- [ ] Card outer has no `py-6` or `gap-6` (or they are zeroed with `py-0 gap-0`)
- [ ] CardHeader padding matches: `p-4 sm:p-6` or `p-6` depending on card type
- [ ] CardContent padding matches: `p-4 pt-0 sm:p-6` or `p-6 pt-0` depending on card type
- [ ] CardFooter padding (if present): `p-6 pt-0`

### Measured Dimensions Checklist (at 1440×900)

Run the inspection script on both reference and localhost and compare:

```bash
python inspect_page.py / Analytics        # reference
# then change BASE_URL to localhost:3000 and re-run
```

| Metric | Tolerance |
|---|---|
| Main grid height | ±20px |
| Individual card height | ±15px |
| KPI mini-card height | ±5px |
| Card y-position (top of first row) | ±5px |

### Visual Checklist

- [ ] Screenshot reference and local at same viewport, compare side by side
- [ ] KPI values align vertically within their cards
- [ ] Charts fill the expected proportion of their container
- [ ] Row 1 cards and Row 2 cards have consistent gap between them
- [ ] Bottom row cards have equal heights (all h-full in an auto-rows row)

---

*Generated from analysis of [https://shadcnblocks-admin.vercel.app/](https://shadcnblocks-admin.vercel.app/) at 1440×900 viewport using Playwright headless inspection.*
