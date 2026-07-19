import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePermissionGate } from "@/hooks/usePermissionGate";
import { useAuth } from "@/hooks/useAuth";
import AccessDeniedPage from "@/pages/AccessDeniedPage";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  path: string;
  children: ReactNode;
}

export function ProtectedRoute({ path, children }: ProtectedRouteProps) {
  const { allowed, isLoading } = usePermissionGate(path);
  const { requiresPasswordChange } = useAuth();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return <AccessDeniedPage />;
  }

  if (requiresPasswordChange) {
    return <Navigate to="/reset-password?first_access=1" replace />;
  }

  return <>{children}</>;
}
