import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

import { AppRole, hasAccess } from '../../config/rolePermissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
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
      <div className="flex h-screen items-center justify-center bg-[#f0f2f5]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#008069] border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  const effectiveRole = user.role as AppRole;

  // Role authorization guard (if specific allowedRoles are passed)
  if (allowedRoles && !allowedRoles.includes(effectiveRole)) {
    return <Navigate to="/admin/unauthorized" replace />;
  }

  // General RBAC Path Access Guard: If accessing an admin path not allowed for this role
  if (!hasAccess(effectiveRole, location.pathname)) {
    return <Navigate to="/admin/unauthorized" replace />;
  }

  // Tenant-scoping isolation guard:
  // If route contains :tenantId param, verify user belongs to this tenant or is super_admin.
  if (params.tenantId && user.role !== 'super_admin' && user.role !== 'tenant_admin' && user.tenantId !== params.tenantId) {
    console.warn(`[Tenant Guard] Blocked access to tenant ${params.tenantId} for user of tenant ${user.tenantId}`);
    return <Navigate to="/admin/unauthorized" replace />;
  }

  return <>{children}</>;
};
