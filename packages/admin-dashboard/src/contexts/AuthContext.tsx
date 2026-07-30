import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { apiRequest } from '../services/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check auth session on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const data = await apiRequest('/api/admin/auth/me');
        if (data.authenticated && data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            role: data.user.role,
            tenantId: data.user.tenantId || 'default-tenant',
          });
        }
      } catch (err) {
        console.warn('Session check failed or unauthenticated:', err);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const data = await apiRequest('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.success && data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          role: data.user.role,
          tenantId: data.user.tenantId || 'default-tenant',
        });
      }
    } catch (err) {
      setUser(null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await apiRequest('/api/admin/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
