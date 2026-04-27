import { initializeApp, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, type Auth } from 'firebase/auth';
import { getFunctions, type Functions } from 'firebase/functions';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAXs0DtXOmjf2bdWce43vKY2fAeNi3hID8",
  authDomain: "hubtify-ab4ab.firebaseapp.com",
  projectId: "hubtify-ab4ab",
  storageBucket: "hubtify-ab4ab.firebasestorage.app",
  messagingSenderId: "792579152721",
  appId: "1:792579152721:web:e7cfe94e831605e3561170"
};

const ACTIVE_APP_KEY = 'hubtify_active_app';
let activeAppName = localStorage.getItem(ACTIVE_APP_KEY) ?? '[DEFAULT]';

// Track which auth instances already have persistence set
const persistenceReady = new Set<string>();

export function getOrCreateApp(name?: string): FirebaseApp {
  const appName = name ?? '[DEFAULT]';
  try {
    return getApp(appName);
  } catch {
    return initializeApp(firebaseConfig, appName === '[DEFAULT]' ? undefined : appName);
  }
}

/**
 * Get auth for a Firebase app and ensure persistence is set.
 * Uses indexedDB with localStorage fallback — keeps tokens across sessions.
 */
export function getAuthWithPersistence(app: FirebaseApp): Auth {
  const auth = getAuth(app);
  const appName = app.name;
  if (!persistenceReady.has(appName)) {
    persistenceReady.add(appName);
    setPersistence(auth, indexedDBLocalPersistence).catch(() => {
      // Fallback to localStorage if indexedDB not available
      setPersistence(auth, browserLocalPersistence).catch(() => {});
    });
  }
  return auth;
}

export function getActiveApp(): FirebaseApp {
  return getOrCreateApp(activeAppName);
}

export function setActiveAppName(name: string): void {
  activeAppName = name;
  localStorage.setItem(ACTIVE_APP_KEY, name);
}

export function getActiveAppName(): string {
  return activeAppName;
}

export async function waitForAuthReady(appName: string): Promise<Auth> {
  const app = getOrCreateApp(appName);
  const auth = getAuthWithPersistence(app);
  await auth.authStateReady();
  return auth;
}

export function getActiveAuth(): Auth {
  return getAuthWithPersistence(getActiveApp());
}

export function getActiveFirestore(): Firestore {
  return getFirestore(getActiveApp());
}

export function getActiveFunctions(): Functions {
  return getFunctions(getActiveApp());
}

// Initialize default app eagerly
getOrCreateApp();
