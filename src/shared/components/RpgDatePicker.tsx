import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string; // YYYY-MM-DD format
  onChange: (value: string) => void;
  min?: string; // YYYY-MM-DD
  max?: string; // YYYY-MM-DD
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export default function RpgDatePicker({ value, onChange, min, max }: Props) {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const minYear = min ? parseInt(min.split('-')[0]) : 1900;
  const maxYear = max ? parseInt(max.split('-')[0]) : currentYear;

  const parsed = value
    ? { year: +value.split('-')[0], month: +value.split('-')[1], day: +value.split('-')[2] }
    : { year: currentYear - 25, month: 1, day: 1 };

  const [year, setYear] = useState(parsed.year);
  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const maxDay = daysInMonth(year, month);

  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [month, year, day, maxDay]);

  useEffect(() => {
    if (!value) return;
    const [y, m, d] = value.split('-').map(Number);
    setYear(y); setMonth(m); setDay(d);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function emit(y: number, m: number, d: number) {
    const clamped = Math.min(d, daysInMonth(y, m));
    onChange(`${y}-${pad(m)}-${pad(clamped)}`);
  }

  function set(field: string, val: number) {
    const next = { year, month, day, [field]: val };
    if (field === 'year') setYear(val);
    if (field === 'month') setMonth(val);
    if (field === 'day') setDay(val);
    emit(next.year, next.month, next.day);
  }

  const display = value
    ? `${pad(day)} ${MONTHS[month - 1]} ${year}`
    : t('datePicker.selectDate');

  const sel: React.CSSProperties = {
    padding: '4px 6px', border: '1px solid var(--rpg-gold-dark)',
    borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)',
    fontFamily: "'Crimson Text', serif", fontSize: '0.85rem', color: 'var(--rpg-ink)',
    cursor: 'pointer', textAlign: 'center',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.65rem', opacity: 0.5, textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 2,
  };

  const yearCount = maxYear - minYear + 1;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="rpg-input"
        onClick={() => setOpen(!open)}
        style={{
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: '0.85rem', whiteSpace: 'nowrap', width: '100%',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <rect x="1" y="2.5" width="12" height="10" rx="1.5"/>
          <path d="M1 5.5h12M4 1v2.5M10 1v2.5"/>
        </svg>
        {display}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
          background: 'linear-gradient(135deg, var(--rpg-parchment-light) 0%, var(--rpg-parchment) 40%, var(--rpg-parchment-dark) 100%)',
          border: '2px solid var(--rpg-gold-dark)', borderRadius: 'var(--rpg-radius)',
          boxShadow: '0 4px 16px rgba(44, 24, 16, 0.4)', padding: 12, minWidth: 240,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div>
              <div style={labelStyle}>{t('datePicker.day')}</div>
              <select style={{ ...sel, width: 52 }} value={day} onChange={e => set('day', +e.target.value)}>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{pad(d)}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>{t('datePicker.month')}</div>
              <select style={{ ...sel, width: 68 }} value={month} onChange={e => set('month', +e.target.value)}>
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>{t('datePicker.year')}</div>
              <select style={{ ...sel, width: 70 }} value={year} onChange={e => set('year', +e.target.value)}>
                {Array.from({ length: yearCount }, (_, i) => maxYear - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
