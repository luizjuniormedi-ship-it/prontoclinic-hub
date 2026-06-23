import { SidebarMenuItem, SidebarMenuButton, SidebarMenuSubItem, SidebarMenuSubButton, SidebarMenuSub } from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";

type Icon = React.ComponentType<{ className?: string }>;

export type MenuItem = { title: string; url: string; icon: Icon };
export type SubItem = { title: string; url: string; icon?: Icon };

export function SidebarItem({ item, collapsed }: { item: MenuItem; collapsed: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <NavLink
          to={item.url}
          end={item.url === "/"}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{item.title}</span>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarSubItem({ item, collapsed }: { item: SubItem; collapsed: boolean }) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild>
        <NavLink
          to={item.url}
          className="flex items-center gap-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md px-2 py-1.5"
          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
        >
          {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0" />}
          {!collapsed && <span>{item.title}</span>}
        </NavLink>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

export function SidebarSubGroup({ items, collapsed }: { items: SubItem[]; collapsed: boolean }) {
  return (
    <SidebarMenuSub>
      {items.map((s) => (
        <SidebarSubItem key={s.title} item={s} collapsed={collapsed} />
      ))}
    </SidebarMenuSub>
  );
}