import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../modules/quests/types';
import { TierBadge, TIER_LABEL } from '../../modules/quests/utils';
import type { TaskTier } from '../../modules/quests/types';

interface Props {
  onClose: () => void;
}

export default function QuickAdd({ onClose }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [tier, setTier] = useState<TaskTier>(2);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    window.api.questsGetProjects().then((p) => setProjects(p as Project[]));
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    await window.api.questsUpsertTask({
      name: name.trim(),
      tier,
      projectId,
      category: '',
      description: '',
      dueDate: null,
    });

    await window.api.processRpgEvent({
      type: 'TASK_CREATED', moduleId: 'quests',
      payload: { xp: 0, hp: 0 },
      timestamp: Date.now(),
    });

    window.dispatchEvent(new Event('rpg:statsChanged'));
    onClose();
  };

  const bgUrl = new URL('../../assets/bg.jpg', import.meta.url).href;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.6)', zIndex: 99998,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '20vh',
      animation: 'contentFadeIn 0.1s ease',
    }} onClick={onClose}>
      <div style={{
        backgroundImage: `url(${bgUrl})`,
        backgroundSize: '400px', backgroundRepeat: 'repeat',
        borderRadius: 8, padding: '16px 20px',
        boxShadow: '0 12px 40px rgba(44,24,16,0.6)',
        border: '3px solid var(--rpg-gold-dark)',
        width: 440,
      }} onClick={(e) => e.stopPropagation()}>

        <div style={{
          fontSize: '0.8rem', opacity: 0.5, marginBottom: 8,
          fontFamily: 'Crimson Text, serif', textAlign: 'center',
        }}>
          {t('questify.quickAdd')} — Ctrl+Q
        </div>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('questify.questName')}
            className="rpg-input"
            style={{ width: '100%', fontSize: '1rem', padding: '8px 12px', marginBottom: 10 }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Tier */}
            <div style={{ display: 'flex', gap: 3 }}>
              {([1, 2, 3] as TaskTier[]).map((tierVal) => (
                <button key={tierVal} type="button" onClick={() => setTier(tierVal)}
                  style={{
                    padding: '3px 8px', border: '1px solid var(--rpg-wood)',
                    borderRadius: 'var(--rpg-radius)', cursor: 'pointer',
                    background: tier === tierVal ? 'var(--rpg-gold)' : 'var(--rpg-parchment)',
                    color: tier === tierVal ? 'var(--rpg-ink)' : 'var(--rpg-ink-light)',
                    fontWeight: tier === tierVal ? 'bold' : 'normal',
                    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem',
                  }}>
                  <TierBadge tier={tierVal} size={12} active={tier === tierVal} /> {TIER_LABEL[tierVal]}
                </button>
              ))}
            </div>

            {/* Project */}
            {projects.length > 0 && (
              <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}
                className="rpg-select" style={{ fontSize: '0.85rem' }}>
                <option value="">{t('questify.noProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <div style={{ flex: 1 }} />

            <button type="submit" className="rpg-button" disabled={!name.trim()}
              style={{ padding: '5px 16px', fontWeight: 'bold' }}>
              {t('questify.addQuest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
