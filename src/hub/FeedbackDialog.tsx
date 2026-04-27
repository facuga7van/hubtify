import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}

export default function FeedbackDialog({ open, onClose, onSent }: FeedbackDialogProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<'bug' | 'feature' | 'other'>('bug');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => descRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSubmit = async () => {
    if (description.trim().length < 10 || sending) return;
    setSending(true);
    try {
      await window.api.feedbackSend({ type, description: description.trim(), email: email.trim() || undefined });
      setDescription('');
      setEmail('');
      setType('bug');
      onSent();
    } catch {
      onClose();
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(42, 29, 14, 0.7)', zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.feedback', 'Feedback')}
        style={{
          background: 'linear-gradient(135deg, var(--parch-0) 0%, var(--parch-1) 60%, var(--parch-2) 100%)',
          borderRadius: 6, padding: '24px 28px',
          boxShadow: '0 12px 40px rgba(42, 29, 14, 0.6), inset 0 0 40px rgba(90, 60, 30, 0.12)',
          border: '2px solid var(--gold-dark)',
          maxWidth: 440, width: '90%',
          position: 'relative',
        }} onClick={(e) => e.stopPropagation()}>
        {/* Top gold edge */}
        <div style={{
          position: 'absolute', top: -2, left: 20, right: 20, height: 2,
          background: 'linear-gradient(90deg, transparent, var(--gold) 30%, var(--gold) 70%, transparent)',
        }} />
        {/* Inner border */}
        <div style={{
          position: 'absolute', top: 5, left: 5, right: 5, bottom: 5,
          border: '1px solid rgba(168, 138, 60, 0.15)',
          borderRadius: 3, pointerEvents: 'none',
        }} />

        <h3 style={{
          fontFamily: "'UnifrakturCook', cursive", fontSize: 'var(--fs-heading)',
          color: 'var(--ink)', textAlign: 'center', marginBottom: 16,
        }}>
          {t('settings.feedbackTitle', 'Enviar Feedback')}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Type select */}
          <div>
            <label style={{
              fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-label)',
              color: 'var(--ink-soft)', display: 'block', marginBottom: 4,
            }}>
              {t('settings.feedbackType', 'Tipo')}
            </label>
            <select
              className="rpg-select"
              value={type}
              onChange={(e) => setType(e.target.value as 'bug' | 'feature' | 'other')}
              style={{ width: '100%' }}
            >
              <option value="bug">{t('settings.feedbackBug', 'Bug / Error')}</option>
              <option value="feature">{t('settings.feedbackFeature', 'Sugerencia / Feature')}</option>
              <option value="other">{t('settings.feedbackOther', 'Otro')}</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label style={{
              fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-label)',
              color: 'var(--ink-soft)', display: 'block', marginBottom: 4,
            }}>
              {t('settings.feedbackDesc', 'Descripcion')}
            </label>
            <textarea
              ref={descRef}
              className="rpg-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.feedbackDescPlaceholder', 'Contanos que paso o que te gustaria...')}
              rows={4}
              style={{ width: '100%', resize: 'vertical', minHeight: 80 }}
            />
          </div>

          {/* Email */}
          <div>
            <label style={{
              fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-label)',
              color: 'var(--ink-soft)', display: 'block', marginBottom: 4,
            }}>
              {t('settings.feedbackEmail', 'Email (opcional)')}
            </label>
            <input
              className="rpg-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('settings.feedbackEmailPlaceholder', 'Para que podamos responderte')}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <button
            className="rpg-button"
            onClick={handleSubmit}
            disabled={description.trim().length < 10 || sending}
            style={{
              padding: '6px 20px', fontSize: 'var(--fs-quote)', fontWeight: 'bold',
              opacity: description.trim().length < 10 || sending ? 0.5 : 1,
            }}
          >
            {sending ? t('settings.feedbackSending', 'Enviando...') : t('settings.feedbackSubmit', 'Enviar')}
          </button>
          <button onClick={onClose}
            style={{
              padding: '6px 20px', fontSize: 'var(--fs-quote)',
              background: 'transparent', border: '1px solid var(--gold-dark)',
              borderRadius: '6px', cursor: 'pointer',
              fontFamily: "'IM Fell English SC', serif", fontWeight: 700,
              color: 'var(--ink-soft)', letterSpacing: '0.04em',
              transition: 'all 0.2s ease',
            }}>
            {t('common.cancel', 'Cancelar')}
          </button>
        </div>
      </div>
    </div>
  );
}
