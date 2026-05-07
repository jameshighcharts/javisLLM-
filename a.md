# Reuse This Admin Panel Design (Navbar + Layout)

Use this when you want a new page with the exact same shell design as this frontend.

## What controls the design

- App shell layout: `frontend/src/app/layout.tsx`
- Sidebar component (brand, toggle, search, profile): `frontend/src/components/app-sidebar.tsx`
- Sidebar behavior + collapse logic: `frontend/src/components/ui/sidebar.tsx`
- Sidebar nav items: `frontend/src/components/sidebar/nav-data.ts`
- Sidebar groups/collapsible menus: `frontend/src/components/sidebar/nav-group.tsx`
- Theme wrapper: `frontend/src/components/theme-provider.tsx`
- Global design tokens/colors/radius/sidebar vars: `frontend/src/app/globals.css`

## Fast path (inside this same project)

You do not need to rebuild the layout.  
Just add a new page route and a nav item.

### 1) Create your page

Example:

`frontend/src/app/my-new-page/page.tsx`

```tsx
export default function MyNewPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">My New Page</h1>
      <p className="text-sm text-muted-foreground">
        New content inside the same admin shell.
      </p>
    </div>
  );
}
```

### 2) Add it to sidebar navigation

Edit `frontend/src/components/sidebar/nav-data.ts` and add a link in `navGeneral` (or another section), for example:

```ts
{
  title: "My New Page",
  href: "/my-new-page",
  icon: IconLayoutDashboard,
}
```

## If you want the same design in a different Next.js project

Copy these files/folders as-is first:

- `frontend/src/app/layout.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/components/app-sidebar.tsx`
- `frontend/src/components/sidebar/nav-data.ts`
- `frontend/src/components/sidebar/nav-group.tsx`
- `frontend/src/components/ui/sidebar.tsx`
- `frontend/src/components/theme-provider.tsx`

Also bring required UI dependencies/components used by those files (`button`, `avatar`, `tooltip`, `sheet`, `collapsible`, etc.) and keep the same Tailwind/shadcn setup.

## Keep the design identical

- Do not change wrapper structure in `layout.tsx`:
  - `ThemeProvider` -> `TooltipProvider` -> `SidebarProvider` -> `AppSidebar` + `SidebarInset`.
- Keep sidebar CSS variables in `globals.css` (`--sidebar-*`, `--radius`, core color tokens).
- Keep `Sidebar` with `collapsible="icon"` in `app-sidebar.tsx`.
- Keep spacing container on pages consistent (`space-y-*`, `px`, `pt/pb` rhythm already provided by layout).

## Verification

Run:

```bash
cd frontend
npm run build
```

If it builds, the shared admin shell is wired correctly and your new page will inherit the same navbar/layout design.
