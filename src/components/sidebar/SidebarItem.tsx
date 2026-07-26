import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";

type Icon = React.ComponentType<{ className?: string }>;

export type MenuItem = {
  title: string;
  url: string;
  icon: Icon;
  description?: string;
  relatedRoutes?: string[];
};

export type SubItem = {
  title: string;
  url: string;
  icon?: Icon;
  description?: string;
};

function MenuTooltip({ title, description }: { title: string; description?: string }) {
  return (
    <TooltipContent side="right" align="center" className="max-w-xs">
      <p className="font-medium">{title}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </TooltipContent>
  );
}

export function SidebarItem({ item, collapsed }: { item: MenuItem; collapsed: boolean }) {
  const location = useLocation();
  const relatedRouteActive = (item.relatedRoutes ?? []).some((route) => (
    location.pathname === route || location.pathname.startsWith(`${route}/`)
  ));

  return (
    <SidebarMenuItem>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <SidebarMenuButton asChild>
            <NavLink
              to={item.url}
              end={item.url === "/"}
              forceActive={relatedRouteActive}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
              aria-label={item.description ? `${item.title}. ${item.description}` : item.title}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span>{item.title}</span>}
            </NavLink>
          </SidebarMenuButton>
        </TooltipTrigger>
        <MenuTooltip title={item.title} description={item.description} />
      </Tooltip>
    </SidebarMenuItem>
  );
}

export function SidebarSubItem({ item, collapsed }: { item: SubItem; collapsed: boolean }) {
  return (
    <SidebarMenuSubItem>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <SidebarMenuSubButton asChild>
            <NavLink
              to={item.url}
              className="flex items-center gap-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md px-2 py-1.5"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
              aria-label={item.description ? `${item.title}. ${item.description}` : item.title}
            >
              {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              {!collapsed && <span>{item.title}</span>}
            </NavLink>
          </SidebarMenuSubButton>
        </TooltipTrigger>
        <MenuTooltip title={item.title} description={item.description} />
      </Tooltip>
    </SidebarMenuSubItem>
  );
}

export function SidebarSubGroup({ items, collapsed }: { items: SubItem[]; collapsed: boolean }) {
  return (
    <SidebarMenuSub>
      {items.map((entry) => (
        <SidebarSubItem key={entry.title} item={entry} collapsed={collapsed} />
      ))}
    </SidebarMenuSub>
  );
}
