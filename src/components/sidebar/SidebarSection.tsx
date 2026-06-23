import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { ChevronRight } from "lucide-react";
import { canAccessRoute } from "@/config/routePermissions";
import { SidebarItem, SidebarSubGroup, MenuItem, SubItem } from "./SidebarItem";

export type MenuGroup = {
  label?: string;
  items: MenuItem[];
  subItems?: { groupTitle: string; items: SubItem[] }[];
};

function filterItems(items: MenuItem[], roleName: string | null | undefined): MenuItem[] {
  return items.filter((item) => canAccessRoute(roleName, item.url));
}

function filterSubItems(items: SubItem[], roleName: string | null | undefined): SubItem[] {
  return items.filter((item) => canAccessRoute(roleName, item.url));
}

function GroupLabel({ label, collapsed }: { label?: string; collapsed: boolean }) {
  if (!label || collapsed) return null;
  return (
    <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3">
      {label}
    </SidebarGroupLabel>
  );
}

/**
 * Renderiza um grupo "flat" (sem sub-grupos colapsáveis).
 */
export function FlatSection({ group, collapsed, roleName }: { group: MenuGroup; collapsed: boolean; roleName: string | null | undefined }) {
  const items = filterItems(group.items, roleName);
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      <GroupLabel label={group.label} collapsed={collapsed} />
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((it) => <SidebarItem key={it.title} item={it} collapsed={collapsed} />)}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * Renderiza um grupo colapsável com sub-grupos temáticos.
 */
export function CollapsibleSection({
  group, collapsed, roleName,
}: { group: MenuGroup; collapsed: boolean; roleName: string | null | undefined }) {
  const allowedSub = (group.subItems ?? []).map((g) => ({
    groupTitle: g.groupTitle,
    items: filterSubItems(g.items, roleName),
  })).filter((g) => g.items.length > 0);

  const allowedMain = filterItems(group.items, roleName);

  if (allowedSub.length === 0 && allowedMain.length === 0) return null;

  if (allowedSub.length === 0) {
    return <FlatSection group={group} collapsed={collapsed} roleName={roleName} />;
  }

  return (
    <SidebarGroup>
      <GroupLabel label={group.label} collapsed={collapsed} />
      <SidebarGroupContent>
        <SidebarMenu>
          <Collapsible defaultOpen className="group/collapsible">
            <CollapsibleTrigger asChild>
              <SidebarMenuButton className="flex items-center justify-between w-full text-sidebar-foreground/80">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  {!collapsed && "Menu"}
                </span>
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {allowedSub.map((sub) => (
                <div key={sub.groupTitle} className="px-2 mt-2">
                  {!collapsed && (
                    <p className="px-2 py-1 text-[10px] uppercase text-sidebar-muted">{sub.groupTitle}</p>
                  )}
                  <SidebarSubGroup items={sub.items} collapsed={collapsed} />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}