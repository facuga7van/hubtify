import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import HelpBubble from '../shared/components/HelpBubble';
import { useToast } from '../shared/components/useToast';
import CharacterPortraitFallback from './CharacterPortraitFallback';
import { DEFAULT_CHAR, FIELD_MAX, type CharacterData } from './character-types';

export type { CharacterData };

/** pixi.js (~400 kB of the renderer bundle) plus the 8.2 MB of hair
 *  spritesheets live behind this boundary. The sidebar avatar mounts on every
 *  screen, so a static import put all of it on the startup critical path. */
const CharacterCanvas = lazy(() => import('./CharacterCanvas'));

// Simple cross-component sync channel
const charChannel = new BroadcastChannel('hubtify-character');

interface Props {
  size?: number;
  canCustomize?: boolean;
}

export default function Character({ size = 100, canCustomize = false }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const charDataRef = useRef<CharacterData>(DEFAULT_CHAR);

  const [charData, setCharData] = useState<CharacterData>(DEFAULT_CHAR);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [customizerBaseline, setCustomizerBaseline] = useState<CharacterData | null>(null);
  /** One-way latch. An account switch re-reads the look but must NOT unmount the
   *  canvas — that would tear down and rebuild the WebGL context every time. */
  const [dbLoaded, setDbLoaded] = useState(false);

  // Keep ref in sync with state
  useEffect(() => { charDataRef.current = charData; }, [charData]);

  // Load from SQLite on mount + account switch
  const loadCharacter = useCallback(() => {
    window.api.characterLoad().then((data) => {
      if (data && typeof data === 'object' &&
          'backHairIndex' in data && 'frontHairIndex' in data) {
        const d = data as CharacterData;
        const loaded = {
          backHairIndex: d.backHairIndex ?? 1,
          frontColorIndex: d.frontColorIndex ?? 1,
          backColorIndex: d.backColorIndex ?? 1,
          frontHairIndex: d.frontHairIndex ?? 1,
        };
        setCharData(loaded);
        charDataRef.current = loaded;
      }
    }).catch(() => {
      toast({ message: t('common.somethingWentWrong', 'Algo salió mal'), type: 'warning' });
    }).finally(() => setDbLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadCharacter(); }, [loadCharacter]);

  useEffect(() => {
    const handler = () => loadCharacter();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadCharacter]);

  // Listen for changes from other Character instances (same window + other windows)
  useEffect(() => {
    // Same-window sync via CustomEvent
    const localHandler = (e: Event) => {
      const d = (e as CustomEvent<CharacterData>).detail;
      setCharData(d);
      charDataRef.current = d;
    };
    // Cross-window sync via BroadcastChannel
    const bcHandler = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && e.data.type === 'char-updated') {
        const d = e.data.charData as CharacterData;
        setCharData(d);
        charDataRef.current = d;
      }
    };
    window.addEventListener('character:updated', localHandler);
    charChannel.addEventListener('message', bcHandler);
    return () => {
      window.removeEventListener('character:updated', localHandler);
      charChannel.removeEventListener('message', bcHandler);
    };
  }, []);

  const applyCharData = useCallback((next: CharacterData) => {
    setCharData(next);
    charDataRef.current = next;
    window.api.characterSave({ ...next } as unknown as Record<string, unknown>).catch(() => {
      toast({ message: t('character.saveFailed', 'No se pudo guardar el personaje'), type: 'warning' });
    });
    window.dispatchEvent(new CustomEvent('character:updated', { detail: next }));
    charChannel.postMessage({ type: 'char-updated', charData: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateField = (field: keyof CharacterData, delta: number) => {
    const prev = charDataRef.current;
    const max = FIELD_MAX[field];
    const raw = prev[field] + delta;
    const wrapped = raw < 1 ? max : raw > max ? 1 : raw;
    applyCharData({ ...prev, [field]: wrapped });
  };

  /** Every arrow click writes straight to the DB, so entering the customizer
   *  snapshots the look you arrived with and "discard" puts it back. */
  const openCustomizer = () => {
    setCustomizerBaseline(charDataRef.current);
    setShowCustomizer(true);
  };

  const discardCustomizations = () => {
    if (customizerBaseline) applyCharData(customizerBaseline);
    setShowCustomizer(false);
  };

  const hasCustomizerChanges = !!customizerBaseline && (
    customizerBaseline.frontHairIndex !== charData.frontHairIndex ||
    customizerBaseline.frontColorIndex !== charData.frontColorIndex ||
    customizerBaseline.backHairIndex !== charData.backHairIndex ||
    customizerBaseline.backColorIndex !== charData.backColorIndex
  );

  const loadingLabel = t('common.loading', 'Loading...');

  return (
    <div>
      {/* Character canvas */}
      <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
        {/* Pixi only boots once the saved look is in hand, exactly as before —
            otherwise the portrait renders the default hair and then swaps. */}
        {dbLoaded ? (
          <Suspense fallback={<CharacterPortraitFallback label={loadingLabel} />}>
            <CharacterCanvas size={size} charData={charData} />
          </Suspense>
        ) : (
          <CharacterPortraitFallback label={loadingLabel} />
        )}
      </div>

      {/* Customize button */}
      {canCustomize && (
        <div className="hero-customize-actions" style={{ textAlign: 'center', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <button className="rpg-button" onClick={() => (showCustomizer ? setShowCustomizer(false) : openCustomizer())}
            style={{ fontSize: 'var(--fs-label)', padding: '6px 16px' }}>
            {showCustomizer ? t('character.done') : t('character.customize')}
          </button>
          {showCustomizer && (
            <button className="rpg-button" onClick={discardCustomizations} disabled={!hasCustomizerChanges}
              style={{ fontSize: 'var(--fs-label)', padding: '6px 16px', opacity: hasCustomizerChanges ? 1 : 0.45 }}>
              {t('character.discardChanges', 'Descartar cambios')}
            </button>
          )}
          <HelpBubble variant="inline" text={t('character.customizerHelp', 'Personalizá tu avatar. Los cambios se guardan y sincronizan automáticamente.')} />
        </div>
      )}

      {/* Customization panel */}
      {canCustomize && showCustomizer && (
        <div className="rpg-card" style={{ marginTop: 12 }}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--gold-dark)" strokeWidth="1.3" strokeLinecap="round">
              <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
            </svg>
            {t('character.customizeTitle')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ControlRow label={t('character.hairStyle')} value={charData.frontHairIndex}
              onPrev={() => updateField('frontHairIndex', -1)}
              onNext={() => updateField('frontHairIndex', 1)} />
            <ControlRow label={t('character.hairColor')} value={charData.frontColorIndex}
              onPrev={() => updateField('frontColorIndex', -1)}
              onNext={() => updateField('frontColorIndex', 1)} />
            <ControlRow label={t('character.backStyle')} value={charData.backHairIndex}
              onPrev={() => updateField('backHairIndex', -1)}
              onNext={() => updateField('backHairIndex', 1)} />
            <ControlRow label={t('character.backColor')} value={charData.backColorIndex}
              onPrev={() => updateField('backColorIndex', -1)}
              onNext={() => updateField('backColorIndex', 1)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ControlRow({ label, value, onPrev, onNext }: {
  label: string; value: number; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="rpg-button" onClick={onPrev} style={{ padding: '2px 8px', fontSize: 'var(--fs-label)' }}
          aria-label={`Previous ${label}`}>
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 1L2 5l4 4"/></svg>
        </button>
        <span style={{ fontFamily: 'Fira Code, monospace', fontSize: 'var(--fs-label)', minWidth: 24, textAlign: 'center' }}>{value}</span>
        <button className="rpg-button" onClick={onNext} style={{ padding: '2px 8px', fontSize: 'var(--fs-label)' }}
          aria-label={`Next ${label}`}>
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 1l4 4-4 4"/></svg>
        </button>
      </div>
    </div>
  );
}
