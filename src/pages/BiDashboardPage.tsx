/**
 * BiDashboardPage.tsx
 *
 * Página wrapper do dashboard executivo de BI.
 * Renderiza AppLayout + BiDashboard.
 */

import { AppLayout } from "@/components/AppLayout";
import { BiDashboard } from "@/components/bi/BiDashboard";

export default function BiDashboardPage() {
  return (
    <AppLayout>
      <BiDashboard />
    </AppLayout>
  );
}
