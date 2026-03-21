import { useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser: User | null) => {
      setUser(firebaseUser ? {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
      } : null);
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: { uid: cred.user.uid, email: cred.user.email, displayName: cred.user.displayName } };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Login failed' };
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return { success: true, user: { uid: cred.user.uid, email: cred.user.email, displayName: cred.user.displayName } };
    } catch (err: unknown) {
      const error = err as { message?: string };
      return { success: false, error: error.message ?? 'Registration failed' };
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  return { user, loading, login, register, logout };
}
