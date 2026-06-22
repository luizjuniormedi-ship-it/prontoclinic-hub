import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * IconButton — a button whose only visible content is an icon.
 *
 * Forces the developer to provide an `aria-label` (the type is required and
 * the field is non-optional). The label is duplicated in a visually-hidden
 * span so screen readers that don't honor aria-label still announce it.
 * When `withTooltip` is true (default), wraps the button in a Radix tooltip
 * showing the same label on hover/focus.
 *
 * Usage:
 *   <IconButton aria-label="Fechar modal" size="icon" onClick={onClose}>
 *     <X className="h-4 w-4" />
 *   </IconButton>
 */
export interface IconButtonProps extends ButtonProps {
  "aria-label": string;
  icon: React.ReactNode;
  /** Optional visible text shown next to the icon (rendered, not sr-only). */
  label?: string;
  /** When false, suppresses the surrounding Tooltip. Default: true. */
  withTooltip?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, children, withTooltip = true, "aria-label": ariaLabel, ...props },
    ref,
  ) {
    const button = (
      <Button aria-label={ariaLabel} ref={ref} {...props}>
        <span aria-hidden="true">{icon}</span>
        {label && <span>{label}</span>}
        {!label && <span className="sr-only">{ariaLabel}</span>}
        {children}
      </Button>
    );

    if (!withTooltip) return button;

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{ariaLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
