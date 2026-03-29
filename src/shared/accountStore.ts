export interface CachedAccount {
  uid: string;
  email: string;
  firebaseAppName: string;
  lastUsed: string;
}

const STORAGE_KEY = 'hubtify_accounts';
const MAX_ACCOUNTS = 5;

function readAccounts(): CachedAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: CachedAccount[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

export function getCachedAccounts(): CachedAccount[] {
  return readAccounts();
}

export function addCachedAccount(account: Omit<CachedAccount, 'lastUsed'>): void {
  const accounts = readAccounts().filter(a => a.uid !== account.uid);
  accounts.unshift({ ...account, lastUsed: new Date().toISOString() });
  writeAccounts(accounts.slice(0, MAX_ACCOUNTS));
}

export function removeCachedAccount(uid: string): void {
  writeAccounts(readAccounts().filter(a => a.uid !== uid));
}

export function touchAccount(uid: string): void {
  const accounts = readAccounts();
  const idx = accounts.findIndex(a => a.uid === uid);
  if (idx >= 0) {
    accounts[idx].lastUsed = new Date().toISOString();
    writeAccounts(accounts);
  }
}

export function getActiveAccountUid(): string | null {
  const accounts = readAccounts();
  return accounts.length > 0 ? accounts[0].uid : null;
}
