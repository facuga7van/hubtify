import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
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

export default function RpgDatePicker({ value, onChange, min, max }: Props) {
  const { t } = useTranslation();
  const MONTHS = Array.from({ length: 12 }, (_, i) => t('datePicker.months.' + i));
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
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ top?: string; bottom?: string; left?: string; right?: string }>({ top: '100%', left: '0' });

  const repositionPopup = useCallback(() => {
    const trigger = ref.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const pos: { top?: string; bottom?: string; left?: string; right?: string } = {};
    if (triggerRect.bottom + popupRect.height + 8 > window.innerHeight) {
      pos.bottom = '100%';
    } else {
      pos.top = '100%';
    }
    if (triggerRect.left + popupRect.width > window.innerWidth) {
      pos.right = '0';
    } else {
      pos.left = '0';
    }
    setPopupPos(pos);
  }, []);

  useLayoutEffect(() => {
    if (open) repositionPopup();
  }, [open, repositionPopup]);

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
    padding: '4px 6px', border: '1px solid var(--gold-dark)',
    borderRadius: '6px', background: 'var(--parch-0)',
    fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-label)', color: 'var(--ink)',
    cursor: 'pointer', textAlign: 'center',
    boxShadow: 'inset 0 1px 2px rgba(42, 29, 14, 0.1)',
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "'IM Fell English SC', serif",
    fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', textTransform: 'uppercase',
    letterSpacing: '0.1em', marginBottom: 2,
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
          fontSize: 'var(--fs-label)', whiteSpace: 'nowrap', width: '100%',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <rect x="1" y="2.5" width="12" height="10" rx="1.5"/>
          <path d="M1 5.5h12M4 1v2.5M10 1v2.5"/>
        </svg>
        {display}
      </button>

      {open && (
        <div ref={popupRef} style={{
          position: 'absolute', ...popupPos, margin: popupPos.bottom ? '0 0 4px' : '4px 0 0', zIndex: 100,
          background: 'linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 60%, var(--parch-2) 100%)',
          border: '2px solid var(--gold-dark)', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(42, 29, 14, 0.4), inset 0 0 20px rgba(90, 60, 30, 0.1)',
          padding: 12, minWidth: 240,
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
          <button type="button" className="rpg-button" onClick={() => setOpen(false)}
            style={{ marginTop: 10, width: '100%', padding: '4px 0', fontSize: 'var(--fs-label)' }}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}
