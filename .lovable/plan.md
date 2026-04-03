

## Plan: Role-Based Access Control (RBAC)

### Current State
- `useAuth` loads `role_name` from Supabase (`user_profiles` → `roles`).
- `usePermissions` uses **mock data** (`adminMockData.ts`) — not connected to the real role system.
- Sidebar shows all items to all users. No route protection beyond authentication.

### Architecture

A single **route permission map** (`src/config/routePermissions.ts`) will define which `role_name` values can access each route. This is the central source of truth — no hardcoded checks scattered across pages.

```text
routePermissions.ts
       │
       ├──▶ ProtectedRoute (wraps pages in App.tsx)
       ├──▶ AppSidebar (filters menu items)
       └──▶ usePermissionGate (reusable hook)
```

### Files to Create

1. **`src/config/routePermissions.ts`** — Central permission map
   - Maps each route path to allowed roles array
   - `"*"` means all authenticated users
   - Exports `canAccessRoute(roleName, path)` helper
   - Role definitions: `admin`, `recepcao`, `medico`, `financeiro`, `diagnostico`, `gestor`, `administrativo`
   - Route mapping per the requirements (e.g., `recepcao` → `/patients`, `/schedule`, `/reception`, `/callcenter`)

2. **`src/hooks/usePermissionGate.ts`** — Reusable hook
   - Takes a route path, returns `{ allowed: boolean, role: string | null }`
   - Uses `useAuth().user.role_name` + `canAccessRoute()`
   - Logs denied access attempts to console (preparation for audit_logs table)

3. **`src/components/ProtectedRoute.tsx`** — Route guard component
   - Wraps page content; checks permission via `usePermissionGate`
   - If denied → renders `AccessDenied`
   - If loading → renders spinner

4. **`src/pages/AccessDeniedPage.tsx`** — Fallback page
   - Shows "Acesso Negado" with user's role info
   - Link to go back to Dashboard

### Files to Modify

5. **`src/App.tsx`** — Wrap each protected route with `ProtectedRoute`
   - Replace `<AppLayout><Page /></AppLayout>` with `<AppLayout><ProtectedRoute path="/..."><Page /></ProtectedRoute></AppLayout>`

6. **`src/components/AppSidebar.tsx`** — Filter menu items
   - Import `canAccessRoute` and `useAuth`
   - Filter each items array: `items.filter(item => canAccessRoute(user?.role_name, item.url))`
   - Hide entire group if no items visible

7. **`src/hooks/usePermissions.ts`** — Replace mock-based logic
   - Remove mock imports
   - Use `role_name` from `useAuth` + `canAccessRoute` from config
   - Keep `hasPermission` and `hasModuleAccess` signatures but backed by role map

### Permission Map (Summary)

| Role | Accessible Routes |
|------|------------------|
| admin | All (`*`) |
| recepcao | `/`, `/patients/**`, `/schedule`, `/callcenter`, `/reception` |
| medico | `/`, `/schedule`, `/attendance/**`, `/records`, `/dicom/reports` |
| financeiro | `/`, `/financial`, `/billing-production`, `/professional-payment` |
| diagnostico | `/`, `/worklist`, `/pacs`, `/dicom/**` |
| gestor | `/`, `/companies`, `/settings`, `/financial`, `/billing-production` |
| administrativo | `/`, `/admin/**`, `/master-data`, `/companies`, `/settings` |

### Technical Details
- Route matching uses `startsWith` for wildcard paths (e.g., `/patients` matches `/patients/new`)
- `admin` role bypasses all checks
- Users with `null` role_name get access only to `/` (dashboard)
- Console warns on denied access: `[ACCESS_DENIED] role=X path=Y`
- No database changes required — uses existing `roles.name` field

