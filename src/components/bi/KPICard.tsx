/**
 * KPICard.tsx
 *
 * Card individual de KPI exibido na primeira linha do dashboard executivo.
 *
 * Encapsula o componente genérico StatsCard com a tipagem específica do BI
 * (variant, ícone lucide, descrição) e expõe um helper de configuração que
 * mantém os 5 cards do dashboard declarativos no orquestrador.
 *
 * Dependências: StatsCard (UI) + lucide-react
 */

import { Calendar, DollarSign, CheckCircle2, AlertTriangle, TrendingUp, type LucideIcon } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";

export type KPIVariant = "default" | "primary" | "secondary" | "success" | "warning" | "destructive";

export interface KPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  variant?: KPIVariant;
}

/**
 * Componente direto — qualquer KPI pode ser renderizado.
 */
export function KPICard({ title, value, icon, description, variant = "default" }: KPICardProps) {
  return (
    <StatsCard
      title={title}
      value={value}
      icon={icon}
      description={description}
      variant={variant}
    />
  );
}

/**
 * Configuração declarativa dos 5 KPIs exibidos na primeira linha do
 * dashboard. Permite ao orquestrador gerar os cards em loop sem repetir JSX.
 */
export interface KPIDefinition {
  key: string;
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  variant: KPIVariant;
}

export const KPI_ICONS = {
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
} as const;
