/** Returns today's date as YYYY-MM-DD string */
export function todayDateString(): string {
  return new Date().toLocaleDateString('en-CA');
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
