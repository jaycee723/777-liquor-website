import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { AuthUser } from '../types/inventory';
import { apiClient } from '../services/apiClient';
import { auth, googleAuthProvider } from '../lib/firebase';
import { syncFirebaseUserProfile } from '../services/firestoreSync';

interface AuthContextValue {
  user: AuthUser | null;
  authReady: boolean;
  firebaseConnected: boolean;
  login: (email: string, passcode: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_KEY = '777_inventory_session_v1';

function readInitialUser(): AuthUser | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      return {
        email: 'owner@777liquor.com',
        name: 'Store Owner',
        role: 'Owner',
        storeName: '777 Liquor Grocery & Gift Shop',
        storeAddress: '931 University Ave, Honolulu, HI',
        provider: 'local',
      };
    }

    const saved = window.localStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readInitialUser);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseConnected, setFirebaseConnected] = useState(false);

  const clearLocalSession = () => {
    setUser(null);
    setFirebaseConnected(false);
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    apiClient.setUnauthorizedHandler(() => {
      clearLocalSession();
    });
    return () => {
      apiClient.setUnauthorizedHandler(undefined);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        const mapped: AuthUser = {
          uid: fbUser.uid,
          email: fbUser.email || 'staff@777liquor.com',
          name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Store Owner',
          role:
            fbUser.email?.toLowerCase() === '777liquorstorehi@gmail.com' ? 'Owner' : 'Counter Staff',
          storeName: '777 Liquor Grocery & Gift Shop',
          storeAddress: '931 University Ave, Honolulu, HI',
          provider: 'google',
        };
        setUser(mapped);
        setFirebaseConnected(true);
        void syncFirebaseUserProfile(fbUser).catch(() => {});
      } else {
        setFirebaseConnected(false);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const login = async (email: string, passcode: string) => {
    const authenticated = await apiClient.login(email, passcode);
    const localUser: AuthUser = { ...authenticated, provider: 'local' };
    setUser(localUser);
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(localUser));
    } catch {
      // ignore storage errors
    }
  };

  const loginWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleAuthProvider);
    const fbUser = result.user;
    await syncFirebaseUserProfile(fbUser);
    const mapped: AuthUser = {
      uid: fbUser.uid,
      email: fbUser.email || 'staff@777liquor.com',
      name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Store Owner',
      role:
        fbUser.email?.toLowerCase() === '777liquorstorehi@gmail.com' ? 'Owner' : 'Counter Staff',
      storeName: '777 Liquor Grocery & Gift Shop',
      storeAddress: '931 University Ave, Honolulu, HI',
      provider: 'google',
    };
    setUser(mapped);
    setFirebaseConnected(true);
  };

  const logout = () => {
    clearLocalSession();
    void signOut(auth).catch(() => {});
    void apiClient.logout();
  };

  return (
    <AuthContext.Provider
      value={{ user, authReady, firebaseConnected, login, loginWithGoogle, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
