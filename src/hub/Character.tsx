import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Application, Assets, Sprite, type Renderer } from 'pixi.js';

import faceImg from '../assets/pixi/face.png';
import neckImg from '../assets/pixi/neck.png';
import eyesImg from '../assets/pixi/eyes.png';
import eyeBrImg from '../assets/pixi/eyebr.png';
import mouthImg from '../assets/pixi/mouth.png';
import noseImg from '../assets/pixi/nose.png';
import frontHairsPng from '../assets/pixi/frontHairs.png';
import rearHairsBackPng from '../assets/pixi/rearHairsBack.png';
import rearHairsFrontPng from '../assets/pixi/rearHairsFront.png';

export interface CharacterData {
  backHairIndex: number;
  frontColorIndex: number;
  backColorIndex: number;
  frontHairIndex: number;
}

const FIELD_MAX: Record<keyof CharacterData, number> = {
  frontHairIndex: 18, frontColorIndex: 25,
  backHairIndex: 22, backColorIndex: 24,
};

const DEFAULT_CHAR: CharacterData = {
  backHairIndex: 1,
  frontColorIndex: 1,
  backColorIndex: 1,
  frontHairIndex: 1,
};

// Simple cross-component sync channel
const charChannel = new BroadcastChannel('hubtify-character');

interface Props {
  size?: number;
  canCustomize?: boolean;
}

export default function Character({ size = 100, canCustomize = false }: Props) {
  const { t } = useTranslation();
  const pixiContainerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application<Renderer> | null>(null);
  const rearHairBackRef = useRef<Sprite | null>(null);
  const rearHairFrontRef = useRef<Sprite | null>(null);
  const frontHairRef = useRef<Sprite | null>(null);
  const isLoadingRef = useRef(false);
  const charDataRef = useRef<CharacterData>(DEFAULT_CHAR);

  const [charData, setCharData] = useState<CharacterData>(DEFAULT_CHAR);
  const [loadingHair, setLoadingHair] = useState(true);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);

  // Keep ref in sync with state
  useEffect(() => { charDataRef.current = charData; }, [charData]);

  // Load from SQLite on mount
  useEffect(() => {
    window.api.characterLoad().then((data) => {
      if (data && typeof data === 'object') {
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
    }).catch(console.error).finally(() => setDbLoaded(true));
  }, []);

  // Listen for changes from other Character instances
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && e.data.type === 'char-updated') {
        const d = e.data.charData as CharacterData;
        setCharData(d);
        charDataRef.current = d;
      }
    };
    charChannel.addEventListener('message', handler);
    return () => charChannel.removeEventListener('message', handler);
  }, []);

  const loadAllHair = useCallback(async (bIdx: number, bClr: number, fIdx: number, fClr: number) => {
    if (!appRef.current || isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoadingHair(true);

    try {
      const app = appRef.current;
      const cx = app.screen.width / 2;
      const cy = app.screen.height / 2;

      // Cleanup
      [rearHairBackRef, rearHairFrontRef, frontHairRef].forEach((ref) => {
        if (ref.current) { app.stage.removeChild(ref.current); ref.current.destroy(); ref.current = null; }
      });

      // Rear hair
      if (!Assets.cache.has('rearHairBack')) {
        const tex = await Assets.load(rearHairsBackPng);
        Assets.add({ alias: 'rearHairBack', src: new URL('../assets/pixi/rearHairBack.json', import.meta.url).href, data: { texture: tex } });
      }
      const rearBackSheet = await Assets.load('rearHairBack');

      if (!Assets.cache.has('rearHairFront')) {
        const tex = await Assets.load(rearHairsFrontPng);
        Assets.add({ alias: 'rearHairFront', src: new URL('../assets/pixi/rearHairFront.json', import.meta.url).href, data: { texture: tex } });
      }
      const rearFrontSheet = await Assets.load('rearHairFront');

      const backName = `rearHairBack${bIdx}-${bClr}`;
      if (backName in rearBackSheet.textures) {
        const sp = new Sprite(rearBackSheet.textures[backName]);
        sp.anchor.set(0.5, 0.5); sp.x = cx; sp.y = cy;
        app.stage.addChildAt(sp, 0);
        rearHairBackRef.current = sp;
      }

      const rearFName = `rearHairFront${bIdx}-${bClr}`;
      if (rearFName in rearFrontSheet.textures) {
        const sp = new Sprite(rearFrontSheet.textures[rearFName]);
        sp.anchor.set(0.5, 0.5); sp.x = cx; sp.y = cy;
        app.stage.addChildAt(sp, 0);
        rearHairFrontRef.current = sp;
      }

      // Front hair
      if (!Assets.cache.has('frontHair')) {
        const tex = await Assets.load(frontHairsPng);
        Assets.add({ alias: 'frontHair', src: new URL('../assets/pixi/frontHair.json', import.meta.url).href, data: { texture: tex } });
      }
      const frontSheet = await Assets.load('frontHair');

      const fName = `fronthair${fIdx}-${fClr}`;
      if (fName in frontSheet.textures) {
        const sp = new Sprite(frontSheet.textures[fName]);
        sp.anchor.set(0.5, 0.5); sp.x = cx; sp.y = cy;
        app.stage.addChild(sp);
        frontHairRef.current = sp;
      }

      // Z-order
      if (rearHairBackRef.current) app.stage.setChildIndex(rearHairBackRef.current, 0);
      if (rearHairFrontRef.current) app.stage.setChildIndex(rearHairFrontRef.current, app.stage.children.length - 2);
      if (frontHairRef.current) app.stage.setChildIndex(frontHairRef.current, app.stage.children.length - 1);

    } catch (e) {
      console.error('[Character]', e);
    } finally {
      isLoadingRef.current = false;
      setLoadingHair(false);
    }
  }, []);

  // Init Pixi AFTER db data is loaded
  useEffect(() => {
    if (!dbLoaded || appRef.current) return;

    const app = new Application();
    appRef.current = app;

    (async () => {
      const canvas = document.createElement('canvas');
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.style.borderRadius = '50%';

      await app.init({ canvas, background: '#c0a080', width: 100, height: 100 });
      pixiContainerRef.current?.appendChild(canvas);

      const cx = app.screen.width / 2;
      const cy = app.screen.height / 2;

      const textures = await Promise.all([
        Assets.load(neckImg), Assets.load(faceImg), Assets.load(eyesImg),
        Assets.load(eyeBrImg), Assets.load(mouthImg), Assets.load(noseImg),
      ]);

      textures.forEach((tex) => {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5, 0.5);
        sp.x = cx; sp.y = cy;
        app.stage.addChild(sp);
      });

      // Use ref to get the latest data (not stale closure)
      const d = charDataRef.current;
      loadAllHair(d.backHairIndex, d.backColorIndex, d.frontHairIndex, d.frontColorIndex);
    })();

    return () => { app.destroy(true); appRef.current = null; };
  }, [dbLoaded, loadAllHair, size]);

  // Reload hair when charData changes (after initial load)
  const prevDataRef = useRef<string>('');
  useEffect(() => {
    const key = JSON.stringify(charData);
    if (key === prevDataRef.current) return;
    prevDataRef.current = key;
    if (appRef.current) {
      loadAllHair(charData.backHairIndex, charData.backColorIndex, charData.frontHairIndex, charData.frontColorIndex);
    }
  }, [charData, loadAllHair]);

  const updateField = (field: keyof CharacterData, delta: number) => {
    setCharData((prev) => {
      const max = FIELD_MAX[field];
      const raw = prev[field] + delta;
      const wrapped = raw < 1 ? max : raw > max ? 1 : raw;
      const next = { ...prev, [field]: wrapped };
      window.api.characterSave(next).catch(console.error);
      charChannel.postMessage({ type: 'char-updated', charData: next });
      return next;
    });
  };

  return (
    <div>
      {/* Character canvas */}
      <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
        {loadingHair && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#c0a080', borderRadius: '50%', zIndex: 10,
          }}>
            <div style={{
              width: 20, height: 20, border: '2px solid var(--rpg-gold-dark)',
              borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        )}
        <div ref={pixiContainerRef} style={{ visibility: loadingHair ? 'hidden' : 'visible' }} />
      </div>

      {/* Customize button */}
      {canCustomize && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="rpg-button" onClick={() => setShowCustomizer(!showCustomizer)}
            style={{ fontSize: '0.8rem', padding: '6px 16px' }}>
            {showCustomizer ? t('character.done') : t('character.customize')}
          </button>
        </div>
      )}

      {/* Customization panel */}
      {canCustomize && showCustomizer && (
        <div className="rpg-card" style={{ marginTop: 12, animation: 'contentFadeIn 0.2s ease' }}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
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
      <span style={{ fontSize: '0.85rem', color: 'var(--rpg-ink-light)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="rpg-button" onClick={onPrev} style={{ padding: '2px 8px', fontSize: '0.75rem' }}
          aria-label={`Previous ${label}`}>
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 1L2 5l4 4"/></svg>
        </button>
        <span style={{ fontFamily: 'Fira Code, monospace', fontSize: '0.85rem', minWidth: 24, textAlign: 'center' }}>{value}</span>
        <button className="rpg-button" onClick={onNext} style={{ padding: '2px 8px', fontSize: '0.75rem' }}
          aria-label={`Next ${label}`}>
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 1l4 4-4 4"/></svg>
        </button>
      </div>
    </div>
  );
}
