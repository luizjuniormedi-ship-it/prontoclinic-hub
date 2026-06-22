import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional id on the h1, useful for aria-labelledby on the page wrapper. */
  titleId?: string;
}

export function PageHeader({ title, description, actions, titleId }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 id={titleId} className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 mt-3 sm:mt-0">{actions}</div>}
    </div>
  );
}
