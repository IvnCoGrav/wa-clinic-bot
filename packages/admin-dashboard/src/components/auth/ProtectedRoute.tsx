import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Array<'tenant_admin' | 'super_admin'>;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const params = useParams<{ tenantId?: string }>();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  // Role authorization guard
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/admin/unauthorized" replace />;
  }

  // Tenant-scoping isolation guard:
  // If route contains :tenantId param, verify user belongs to this tenant or is super_admin.
  if (params.tenantId && user.role !== 'super_admin' && user.tenantId !== params.tenantId) {
    console.warn(`[Tenant Guard] Blocked access to tenant ${params.tenantId} for user of tenant ${user.tenantId}`);
    return <Navigate to="/admin/unauthorized" replace />;
  }

  return <>{children}</>;
};
