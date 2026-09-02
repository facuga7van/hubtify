/**
 * Login already resolved a username to its email through `usernames/{name}`;
 * "forgot password" passed the raw text to Firebase and died with
 * `auth/invalid-email` whenever the user typed their username. Both paths now
 * share `resolveIdentifierToEmail`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fb = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...path: string[]) => path.join('/')),
  auth: { name: 'auth' },
  db: { name: 'db' },
}));

vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: fb.sendPasswordResetEmail }));
vi.mock('firebase/firestore', () => ({ doc: fb.doc, getDoc: fb.getDoc }));
vi.mock('../../src/shared/firebase', () => ({
  getActiveAuth: () => fb.auth,
  getActiveFirestore: () => fb.db,
}));

const { resolveIdentifierToEmail, requestPasswordReset } = await import('../../src/shared/auth-identifier');

function usernameDoc(email: string | null) {
  return email === null
    ? { exists: () => false, data: () => undefined }
    : { exists: () => true, data: () => ({ email }) };
}

beforeEach(() => {
  fb.sendPasswordResetEmail.mockReset();
  fb.getDoc.mockReset();
  fb.doc.mockClear();
});

describe('resolveIdentifierToEmail', () => {
  it('returns an email untouched without hitting Firestore', async () => {
    await expect(resolveIdentifierToEmail('pepe@x.com')).resolves.toBe('pepe@x.com');
    expect(fb.getDoc).not.toHaveBeenCalled();
  });

  it('looks up a username (lowercased) in usernames/{name}', async () => {
    fb.getDoc.mockResolvedValue(usernameDoc('pepe@x.com'));
    await expect(resolveIdentifierToEmail('Pepe')).resolves.toBe('pepe@x.com');
    expect(fb.doc).toHaveBeenCalledWith(fb.db, 'usernames', 'pepe');
  });

  it('throws usernameNotFound when the username does not exist', async () => {
    fb.getDoc.mockResolvedValue(usernameDoc(null));
    await expect(resolveIdentifierToEmail('nadie')).rejects.toThrow('usernameNotFound');
  });
});

describe('requestPasswordReset', () => {
  it('sends the reset to the email resolved from a username', async () => {
    fb.getDoc.mockResolvedValue(usernameDoc('pepe@x.com'));
    await requestPasswordReset('pepe');
    expect(fb.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(fb.sendPasswordResetEmail).toHaveBeenCalledWith(fb.auth, 'pepe@x.com');
  });

  it('sends the reset straight to an email identifier', async () => {
    await requestPasswordReset('pepe@x.com');
    expect(fb.getDoc).not.toHaveBeenCalled();
    expect(fb.sendPasswordResetEmail).toHaveBeenCalledWith(fb.auth, 'pepe@x.com');
  });

  it('does not send anything when the username is unknown', async () => {
    fb.getDoc.mockResolvedValue(usernameDoc(null));
    await expect(requestPasswordReset('nadie')).rejects.toThrow('usernameNotFound');
    expect(fb.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
