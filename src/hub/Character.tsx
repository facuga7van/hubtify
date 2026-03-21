import { useEffect, useRef, useState } from 'react';
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

const DEFAULT_CHAR: CharacterData = {
  backHairIndex: 1,
  frontColorIndex: 1,
  backColorIndex: 1,
  frontHairIndex: 1,
};

function getCharData(): CharacterData {
  try {
    const cached = localStorage.getItem('hubtify_charData');
    return cached ? JSON.parse(cached) : { ...DEFAULT_CHAR };
  } catch {
    return { ...DEFAULT_CHAR };
  }
}

function saveCharData(data: CharacterData): void {
  localStorage.setItem('hubtify_charData', JSON.stringify(data));
}

interface Props {
  size?: number;
  showControls?: boolean;
}

export default function Character({ size = 100, showControls = false }: Props) {
  const pixiContainerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application<Renderer> | null>(null);
  const rearHairBackSpriteRef = useRef<Sprite | null>(null);
  const rearHairFrontSpriteRef = useRef<Sprite | null>(null);
  const frontHairSpriteRef = useRef<Sprite | null>(null);
  const isLoadingRef = useRef(false);

  const [charData, setCharData] = useState<CharacterData>(getCharData);
  const [loadingHair, setLoadingHair] = useState(true);

  // Init Pixi app
  useEffect(() => {
    if (appRef.current) return;

    const app = new Application();
    appRef.current = app;

    (async () => {
      const canvas = document.createElement('canvas');
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.style.borderRadius = '50%';

      await app.init({
        canvas,
        background: '#c0a080',
        width: 100,
        height: 100,
      });

      pixiContainerRef.current?.appendChild(canvas);

      const cx = app.screen.width / 2;
      const cy = app.screen.height / 2;

      const sprites = await Promise.all([
        Assets.load(neckImg),
        Assets.load(faceImg),
        Assets.load(eyesImg),
        Assets.load(eyeBrImg),
        Assets.load(mouthImg),
        Assets.load(noseImg),
      ]);

      sprites.forEach((tex) => {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5, 0.5);
        sp.x = cx;
        sp.y = cy;
        app.stage.addChild(sp);
      });

      loadAllHair(charData.backHairIndex, charData.backColorIndex, charData.frontHairIndex, charData.frontColorIndex);
    })();

    return () => {
      app.destroy(true);
      appRef.current = null;
    };
  }, []);

  const loadAllHair = async (bIndex: number, bColor: number, fIndex: number, fColor: number) => {
    if (!appRef.current || isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoadingHair(true);

    try {
      const app = appRef.current;
      const cx = app.screen.width / 2;
      const cy = app.screen.height / 2;

      // Cleanup existing hair
      [rearHairBackSpriteRef, rearHairFrontSpriteRef, frontHairSpriteRef].forEach((ref) => {
        if (ref.current) {
          app.stage.removeChild(ref.current);
          ref.current.destroy();
          ref.current = null;
        }
      });

      // Load rear hair spritesheets
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

      // Create rear hair sprites
      const backFrameName = `rearHairBack${bIndex}-${bColor}`;
      const frontFrameName = `rearHairFront${bIndex}-${bColor}`;

      if (backFrameName in rearBackSheet.textures) {
        const sp = new Sprite(rearBackSheet.textures[backFrameName]);
        sp.anchor.set(0.5, 0.5);
        sp.x = cx; sp.y = cy;
        app.stage.addChildAt(sp, 0);
        rearHairBackSpriteRef.current = sp;
      }

      if (frontFrameName in rearFrontSheet.textures) {
        const sp = new Sprite(rearFrontSheet.textures[frontFrameName]);
        sp.anchor.set(0.5, 0.5);
        sp.x = cx; sp.y = cy;
        app.stage.addChildAt(sp, 0);
        rearHairFrontSpriteRef.current = sp;
      }

      // Load front hair spritesheet
      if (!Assets.cache.has('frontHair')) {
        const tex = await Assets.load(frontHairsPng);
        Assets.add({ alias: 'frontHair', src: new URL('../assets/pixi/frontHair.json', import.meta.url).href, data: { texture: tex } });
      }
      const frontSheet = await Assets.load('frontHair');

      const fFrameName = `fronthair${fIndex}-${fColor}`;
      if (fFrameName in frontSheet.textures) {
        const sp = new Sprite(frontSheet.textures[fFrameName]);
        sp.anchor.set(0.5, 0.5);
        sp.x = cx; sp.y = cy;
        app.stage.addChild(sp);
        frontHairSpriteRef.current = sp;
      }

      // Fix z-order
      if (rearHairBackSpriteRef.current) app.stage.setChildIndex(rearHairBackSpriteRef.current, 0);
      if (rearHairFrontSpriteRef.current) app.stage.setChildIndex(rearHairFrontSpriteRef.current, app.stage.children.length - 2);
      if (frontHairSpriteRef.current) app.stage.setChildIndex(frontHairSpriteRef.current, app.stage.children.length - 1);

    } catch (e) {
      console.error('Error loading character hair:', e);
    } finally {
      isLoadingRef.current = false;
      setLoadingHair(false);
    }
  };

  // Reload hair when charData changes
  useEffect(() => {
    loadAllHair(charData.backHairIndex, charData.backColorIndex, charData.frontHairIndex, charData.frontColorIndex);
  }, [charData]);

  const updateChar = (field: keyof CharacterData, delta: number) => {
    setCharData((prev) => {
      const next = { ...prev, [field]: Math.max(1, prev[field] + delta) };
      saveCharData(next);
      return next;
    });
  };

  return (
    <div>
      <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
        {loadingHair && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#c0a080', borderRadius: '50%', zIndex: 10,
          }}>
            <div style={{
              width: 20, height: 20, border: '2px solid var(--rpg-gold-dark)',
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        )}
        <div ref={pixiContainerRef} style={{ visibility: loadingHair ? 'hidden' : 'visible' }} />
      </div>

      {showControls && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ControlRow label="Hair Style" value={charData.frontHairIndex}
            onPrev={() => updateChar('frontHairIndex', -1)} onNext={() => updateChar('frontHairIndex', 1)} />
          <ControlRow label="Hair Color" value={charData.frontColorIndex}
            onPrev={() => updateChar('frontColorIndex', -1)} onNext={() => updateChar('frontColorIndex', 1)} />
          <ControlRow label="Back Style" value={charData.backHairIndex}
            onPrev={() => updateChar('backHairIndex', -1)} onNext={() => updateChar('backHairIndex', 1)} />
          <ControlRow label="Back Color" value={charData.backColorIndex}
            onPrev={() => updateChar('backColorIndex', -1)} onNext={() => updateChar('backColorIndex', 1)} />
        </div>
      )}
    </div>
  );
}

function ControlRow({ label, value, onPrev, onNext }: {
  label: string; value: number; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: '0.85rem', minWidth: 80 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="rpg-button" onClick={onPrev} style={{ padding: '2px 8px', fontSize: '0.8rem' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
        </button>
        <span style={{ fontFamily: 'Fira Code, monospace', fontSize: '0.85rem', minWidth: 20, textAlign: 'center' }}>{value}</span>
        <button className="rpg-button" onClick={onNext} style={{ padding: '2px 8px', fontSize: '0.8rem' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 1l4 4-4 4"/></svg>
        </button>
      </div>
    </div>
  );
}
