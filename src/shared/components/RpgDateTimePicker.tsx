import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string; // ISO datetime-local format: "2026-03-22T14:30"
  onChange: (value: string) => void;
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

function parseDT(v: string) {
  if (!v) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: 0,
    };
  }
  const [date, time] = v.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = (time || '00:00').split(':').map(Number);
  return { year: y, month: m, day: d, hour: h, minute: min };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export default function RpgDateTimePicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const MONTHS = Array.from({ length: 12 }, (_, i) => t('datePicker.months.' + i));
  const parsed = parseDT(value);
  const [year, setYear] = useState(parsed.year);
  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const maxDay = daysInMonth(year, month);

  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [month, year, day, maxDay]);

  useEffect(() => {
    const p = parseDT(value);
    setYear(p.year); setMonth(p.month); setDay(p.day); setHour(p.hour); setMinute(p.minute);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function emit(y: number, m: number, d: number, h: number, min: number) {
    const clamped = Math.min(d, daysInMonth(y, m));
    onChange(`${y}-${pad(m)}-${pad(clamped)}T${pad(h)}:${pad(min)}`);
  }

  function set(field: string, val: number) {
    const next = { year, month, day, hour, minute, [field]: val };
    if (field === 'year') setYear(val);
    if (field === 'month') setMonth(val);
    if (field === 'day') setDay(val);
    if (field === 'hour') setHour(val);
    if (field === 'minute') setMinute(val);
    emit(next.year, next.month, next.day, next.hour, next.minute);
  }

  const display = value
    ? `${pad(day)} ${MONTHS[month - 1]} ${year} — ${pad(hour)}:${pad(minute)}`
    : t('datePicker.selectDateTime');

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

  const currentYear = new Date().getFullYear();

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="rpg-input"
        onClick={() => setOpen(!open)}
        style={{
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: '0.85rem', whiteSpace: 'nowrap',
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
          {/* Date row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
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
                {Array.from({ length: 5 }, (_, i) => currentYear + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Time row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <div style={labelStyle}>{t('datePicker.hour')}</div>
              <select style={{ ...sel, width: 52 }} value={hour} onChange={e => set('hour', +e.target.value)}>
                {Array.from({ length: 24 }, (_, i) => i).map(h => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 'bold', paddingBottom: 4 }}>:</div>
            <div>
              <div style={labelStyle}>{t('datePicker.min')}</div>
              <select style={{ ...sel, width: 52 }} value={minute} onChange={e => set('minute', +e.target.value)}>
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
