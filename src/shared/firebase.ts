import { initializeApp, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
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

let activeAppName = '[DEFAULT]';

export function getOrCreateApp(name?: string): FirebaseApp {
  const appName = name ?? '[DEFAULT]';
  try {
    return getApp(appName);
  } catch {
    return initializeApp(firebaseConfig, appName === '[DEFAULT]' ? undefined : appName);
  }
}

export function getActiveApp(): FirebaseApp {
  return getOrCreateApp(activeAppName);
}

export function setActiveAppName(name: string): void {
  activeAppName = name;
}

export function getActiveAppName(): string {
  return activeAppName;
}

export function getActiveAuth(): Auth {
  return getAuth(getActiveApp());
}

export function getActiveFirestore(): Firestore {
  return getFirestore(getActiveApp());
}

export function getActiveFunctions(): Functions {
  return getFunctions(getActiveApp());
}

// Initialize default app eagerly
getOrCreateApp();
