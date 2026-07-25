import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { getNavigationItemForPath, getWorkspaceLabel } from "@/config/navigation";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional id on the h1, useful for aria-labelledby on the page wrapper. */
  titleId?: string;
}

export function PageHeader({ title, description, actions, titleId }: PageHeaderProps) {
  const location = useLocation();
  const navigationItem = getNavigationItemForPath(location.pathname);
  const workspaceLabel = navigationItem ? getWorkspaceLabel(navigationItem.workspace) : null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {workspaceLabel && (
          <nav aria-label="Localização da página" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span>{workspaceLabel}</span>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <span aria-current="page">{title}</span>
          </nav>
        )}
        <h1 id={titleId} className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}
