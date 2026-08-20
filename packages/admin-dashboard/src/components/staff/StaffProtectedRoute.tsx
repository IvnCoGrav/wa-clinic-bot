import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStaffAuth } from '../../contexts/StaffAuthContext';
import { useAuth } from '../../contexts/AuthContext';
import { hasAccess } from '../../config/rolePermissions';

interface StaffProtectedRouteProps {
  children: React.ReactNode;
}

export const StaffProtectedRoute: React.FC<StaffProtectedRouteProps> = ({ children }) => {
  const { staff, loading: staffLoading } = useStaffAuth();
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();

  // Jika user login via admin session dan memiliki akses ke rute ini
  if (user && hasAccess(user.role, location.pathname)) {
    return <>{children}</>;
  }

  // Jika staff login via staff session
  if (staff) {
    return <>{children}</>;
  }

  // Tampilkan loading hanya saat kedua context masih dalam proses verifikasi
  if (staffLoading && authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f0f2f5]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#008069] border-t-transparent"></div>
      </div>
    );
  }

  if (user && !hasAccess(user.role, location.pathname)) {
    return <Navigate to="/admin/unauthorized" replace />;
  }

  if (!staff && !user && !staffLoading && !authLoading) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#f0f2f5]">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#008069] border-t-transparent"></div>
    </div>
  );
};
