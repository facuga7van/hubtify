/**
 * The auth forms accept "email or username". Firebase only knows emails, so
 * every flow that takes an identifier (login, password reset) has to resolve
 * it first through the `usernames/{name}` lookup collection.
 *
 * Kept out of `useAuth` so it can be unit-tested in Node with the Firebase SDK
 * mocked away.
 */
import { sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getActiveAuth, getActiveFirestore } from './firebase';

/** Thrown (as `Error.message`) when a username has no `usernames/{name}` doc. */
export const USERNAME_NOT_FOUND = 'usernameNotFound';

/**
 * Resolve what the user typed to an email. Anything with an `@` is taken as an
 * email as-is; otherwise it is a username, looked up case-insensitively.
 */
export async function resolveIdentifierToEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) return trimmed;

  const db = getActiveFirestore();
  const usernameDoc = await getDoc(doc(db, 'usernames', trimmed.toLowerCase()));
  if (!usernameDoc.exists()) {
    throw new Error(USERNAME_NOT_FOUND);
  }
  return usernameDoc.data()!.email as string;
}

/** Send the password-reset email for an email OR a username. */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const email = await resolveIdentifierToEmail(identifier);
  await sendPasswordResetEmail(getActiveAuth(), email);
}
