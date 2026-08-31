import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Application, Assets, Sprite, type Renderer } from 'pixi.js';
import CharacterPortraitFallback from './CharacterPortraitFallback';
import { charKey, type CharacterData } from './character-types';

// Base face — a handful of KB, always needed.
import faceImg from '../assets/pixi/face.png';
import neckImg from '../assets/pixi/neck.png';
import eyesImg from '../assets/pixi/eyes.png';
import eyeBrImg from '../assets/pixi/eyebr.png';
import mouthImg from '../assets/pixi/mouth.png';
import noseImg from '../assets/pixi/nose.png';

// ~8.2 MB of spritesheets. These are plain URL strings after the Vite asset
// pipeline (the PNGs are emitted as separate files, never inlined into JS), so
// what actually costs is the runtime fetch+decode in loadHairSprites below.
// This whole module is behind a React.lazy boundary, so none of it — pixi.js
// included — is evaluated until the avatar is on screen.
import frontHairsPng from '../assets/pixi/frontHairs.png';
import rearHairsBackPng from '../assets/pixi/rearHairsBack.png';
import rearHairsFrontPng from '../assets/pixi/rearHairsFront.png';

interface HairRefs {
  back: MutableRefObject<Sprite | null>;
  rearFront: MutableRefObject<Sprite | null>;
  front: MutableRefObject<Sprite | null>;
}

/** Swap the three hair sprites on the stage for the ones `d` asks for.
 *  `isAlive` bails out if the component unmounted across one of the awaits. */
async function loadHairSprites(
  app: Application<Renderer>,
  d: CharacterData,
  refs: HairRefs,
  isAlive: () => boolean,
): Promise<void> {
  const cx = app.screen.width / 2;
  const cy = app.screen.height / 2;

  for (const ref of [refs.back, refs.rearFront, refs.front]) {
    if (ref.current) { app.stage.removeChild(ref.current); ref.current.destroy(); ref.current = null; }
  }

  // Rear hair
  if (!Assets.cache.has('rearHairBack')) {
    const tex = await Assets.load(rearHairsBackPng);
    if (!isAlive()) return;
    Assets.add({ alias: 'rearHairBack', src: new URL('../assets/pixi/rearHairBack.json', import.meta.url).href, data: { texture: tex } });
  }
  const rearBackSheet = await Assets.load('rearHairBack');
  if (!isAlive()) return;

  if (!Assets.cache.has('rearHairFront')) {
    const tex = await Assets.load(rearHairsFrontPng);
    if (!isAlive()) return;
    Assets.add({ alias: 'rearHairFront', src: new URL('../assets/pixi/rearHairFront.json', import.meta.url).href, data: { texture: tex } });
  }
  const rearFrontSheet = await Assets.load('rearHairFront');
  if (!isAlive()) return;

  const backName = `rearHairBack${d.backHairIndex}-${d.backColorIndex}`;
  if (backName in rearBackSheet.textures) {
    const sp = new Sprite(rearBackSheet.textures[backName]);
    sp.anchor.set(0.5, 0.5); sp.x = cx; sp.y = cy;
    app.stage.addChildAt(sp, 0);
    refs.back.current = sp;
  }

  const rearFName = `rearHairFront${d.backHairIndex}-${d.backColorIndex}`;
  if (rearFName in rearFrontSheet.textures) {
    const sp = new Sprite(rearFrontSheet.textures[rearFName]);
    sp.anchor.set(0.5, 0.5); sp.x = cx; sp.y = cy;
    app.stage.addChildAt(sp, 0);
    refs.rearFront.current = sp;
  }

  // Front hair
  if (!Assets.cache.has('frontHair')) {
    const tex = await Assets.load(frontHairsPng);
    if (!isAlive()) return;
    Assets.add({ alias: 'frontHair', src: new URL('../assets/pixi/frontHair.json', import.meta.url).href, data: { texture: tex } });
  }
  const frontSheet = await Assets.load('frontHair');
  if (!isAlive()) return;

  const fName = `fronthair${d.frontHairIndex}-${d.frontColorIndex}`;
  if (fName in frontSheet.textures) {
    const sp = new Sprite(frontSheet.textures[fName]);
    sp.anchor.set(0.5, 0.5); sp.x = cx; sp.y = cy;
    app.stage.addChild(sp);
    refs.front.current = sp;
  }

  // Z-order
  if (refs.back.current) app.stage.setChildIndex(refs.back.current, 0);
  if (refs.rearFront.current) app.stage.setChildIndex(refs.rearFront.current, app.stage.children.length - 2);
  if (refs.front.current) app.stage.setChildIndex(refs.front.current, app.stage.children.length - 1);
}

interface Props {
  size: number;
  charData: CharacterData;
}

/**
 * The avatar is a still portrait: nothing on the stage ever moves. It used to
 * run with Pixi's default `autoStart: true`, which drives a requestAnimationFrame
 * ticker calling `app.render()` 60 times a second for the whole life of the app
 * (two of them at once on /character). Now the app is created with
 * `autoStart: false` and `app.render()` is called by hand at the three moments
 * the picture actually changes: base face ready, hair ready, look changed.
 */
export default function CharacterCanvas({ size, charData }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application<Renderer> | null>(null);
  const rearHairBackRef = useRef<Sprite | null>(null);
  const rearHairFrontRef = useRef<Sprite | null>(null);
  const frontHairRef = useRef<Sprite | null>(null);
  const isLoadingRef = useRef(false);
  /** Latest look requested while a load was already in flight. */
  const pendingRef = useRef<CharacterData | null>(null);
  const charDataRef = useRef<CharacterData>(charData);

  const [loadingHair, setLoadingHair] = useState(true);
  const [pixiError, setPixiError] = useState(false);

  useEffect(() => { charDataRef.current = charData; }, [charData]);

  const loadAllHair = useCallback(async (initial: CharacterData) => {
    const app = appRef.current;
    if (!app) return;
    // Coalesce instead of dropping: holding down the customizer arrow used to
    // throw away every change that landed mid-load, leaving the portrait on a
    // look the controls no longer showed.
    if (isLoadingRef.current) { pendingRef.current = initial; return; }

    isLoadingRef.current = true;
    setLoadingHair(true);
    const isAlive = () => appRef.current === app;

    try {
      let next: CharacterData | null = initial;
      while (next) {
        pendingRef.current = null;
        await loadHairSprites(app, next, {
          back: rearHairBackRef, rearFront: rearHairFrontRef, front: frontHairRef,
        }, isAlive);
        if (!isAlive()) return;
        next = pendingRef.current;
      }
      app.render();
    } catch {
      // Hair loading is non-critical — the portrait still renders without it.
      if (isAlive()) app.render();
    } finally {
      isLoadingRef.current = false;
      pendingRef.current = null;
      setLoadingHair(false);
    }
  }, []);

  // Init Pixi
  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    const app = new Application();

    (async () => {
      try {
        const canvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        const res = (size / 100) * dpr;

        await app.init({
          canvas, background: '#c0a080', width: 100, height: 100, resolution: res,
          // No ticker: see the component doc comment.
          autoStart: false,
        });
        initialized = true;
        // Unmounted while init was in flight — otherwise the WebGL context and
        // its canvas leaked, one per navigation to /character.
        if (cancelled) { app.destroy(true, { children: true, texture: false }); return; }

        // Set CSS size after init — canvas has 100*res physical pixels, displayed at size CSS px
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        canvas.style.borderRadius = '50%';

        appRef.current = app;
        containerRef.current?.appendChild(canvas);

        const cx = app.screen.width / 2;
        const cy = app.screen.height / 2;

        const textures = await Promise.all([
          Assets.load(neckImg), Assets.load(faceImg), Assets.load(eyesImg),
          Assets.load(eyeBrImg), Assets.load(mouthImg), Assets.load(noseImg),
        ]);
        if (cancelled || appRef.current !== app) return;

        textures.forEach((tex) => {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5, 0.5);
          sp.x = cx; sp.y = cy;
          app.stage.addChild(sp);
        });
        app.render();

        await loadAllHair(charDataRef.current);
      } catch {
        if (cancelled) return;
        setPixiError(true);
        setLoadingHair(false);
      }
    })();

    return () => {
      cancelled = true;
      if (appRef.current === app) appRef.current = null;
      rearHairBackRef.current = null;
      rearHairFrontRef.current = null;
      frontHairRef.current = null;
      // `texture: false` keeps the decoded spritesheets in the Assets cache, so
      // remounting the portrait costs no re-decode of the 8.2 MB of PNG.
      if (initialized) {
        try { app.destroy(true, { children: true, texture: false }); } catch { /* already gone */ }
      }
    };
  }, [size, loadAllHair]);

  /* Safety net for on-demand rendering: without a ticker nothing repaints the
   * canvas by itself, so the two cases where the browser can drop the drawing
   * buffer — the window being occluded/restored, and a GPU context loss — get an
   * explicit render instead of leaving a blank disc behind. */
  useEffect(() => {
    const repaint = () => {
      const app = appRef.current;
      if (!app) return;
      try { app.render(); } catch { /* renderer gone */ }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') repaint(); };
    document.addEventListener('visibilitychange', onVisibility);
    const canvas = containerRef.current;
    canvas?.addEventListener('webglcontextrestored', repaint, true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      canvas?.removeEventListener('webglcontextrestored', repaint, true);
    };
  }, []);

  // Reload hair when the look changes (customizer, sync, account switch)
  const prevKeyRef = useRef<string>('');
  useEffect(() => {
    const key = charKey(charData);
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    if (appRef.current) loadAllHair(charData);
  }, [charData, loadAllHair]);

  if (pixiError) {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--parch-1), var(--parch-2))',
        border: '2px solid var(--gold-dark)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L3 7v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V7l-9-5z"/>
        </svg>
      </div>
    );
  }

  return (
    <>
      {loadingHair && <CharacterPortraitFallback label={t('common.loading', 'Loading...')} />}
      <div ref={containerRef} style={{ visibility: loadingHair ? 'hidden' : 'visible' }} />
    </>
  );
}
