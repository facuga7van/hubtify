/** Returns today's date as YYYY-MM-DD string */
export function todayDateString(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Returns a local ISO-like timestamp string (YYYY-MM-DD HH:MM:SS) for storing in SQLite */
export function localTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** Returns a YYYY-MM-DD string for N days ago in local time */
export function daysAgoDateString(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

/** Returns a Date object formatted as YYYY-MM-DD string */
export function formatDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

/** Returns the Monday of the week for a given date string (YYYY-MM-DD) */
export function getMondayOfWeek(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return formatDateString(monday);
}

/** Calculates age in years from a YYYY-MM-DD date of birth string */
export function getAgeFromDob(dob: string): number {
  const birth = new Date(dob + 'T00:00:00');
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
