import { ipcMain } from 'electron';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAXs0DtXOmjf2bdWce43vKY2fAeNi3hID8",
  authDomain: "hubtify-ab4ab.firebaseapp.com",
  projectId: "hubtify-ab4ab",
  storageBucket: "hubtify-ab4ab.firebasestorage.app",
  messagingSenderId: "792579152721",
  appId: "1:792579152721:web:e7cfe94e831605e3561170"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let currentUser: User | null = null;
let mainWindow: Electron.BrowserWindow | null = null;

export function setMainWindow(win: Electron.BrowserWindow): void {
  mainWindow = win;
}

export function registerAuthIpcHandlers(): void {
  // Listen for auth state changes and notify renderer
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:stateChanged', user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      } : null);
    }
  });

  ipcMain.handle('auth:login', async (_e, email: string, password: string) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: { uid: cred.user.uid, email: cred.user.email, displayName: cred.user.displayName } };
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      return { success: false, error: error.message ?? 'Login failed' };
    }
  });

  ipcMain.handle('auth:register', async (_e, email: string, password: string) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return { success: true, user: { uid: cred.user.uid, email: cred.user.email, displayName: cred.user.displayName } };
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      return { success: false, error: error.message ?? 'Registration failed' };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    await signOut(auth);
    return { success: true };
  });

  ipcMain.handle('auth:getUser', () => {
    return currentUser ? {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName,
    } : null;
  });
}
