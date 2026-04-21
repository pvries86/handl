import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserProfile } from './types';
import { clearStoredUserId, getCurrentUser, getStoredUserId, LocalUser, login } from './lib/api';

interface AuthContextType {
  user: LocalUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getStoredUserId()) {
      setLoading(false);
      return;
    }

    getCurrentUser()
      .then((profile) => {
        setProfile(profile);
        setUser(profile);
      })
      .catch(() => {
        clearStoredUserId();
        setProfile(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email: string, displayName: string) => {
    const profile = await login(email, displayName);
    setProfile(profile);
    setUser(profile);
  };

  const logout = async () => {
    clearStoredUserId();
    setProfile(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
