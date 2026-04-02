import { useRef, useEffect } from 'react';
import { xpThreshold } from '../../../shared/rpg-engine';
import { barGleam } from '../animations/feedback';

interface XpBarProps { xp: number; xpToNextLevel: number; level: number; }

export default function XpBar({ xp, level }: XpBarProps) {
  const xpForCurrentLevel = xpThreshold(level);
  const xpForNextLevel = xpThreshold(level + 1);
  const progress = xpForNextLevel > xpForCurrentLevel
    ? ((xp - xpForCurrentLevel) / (xpForNextLevel - xpForCurrentLevel)) * 100
    : 100;

  const fillRef = useRef<HTMLDivElement>(null);
  const prevXpRef = useRef(xp);

  useEffect(() => {
    if (xp > prevXpRef.current && fillRef.current) {
      barGleam(fillRef.current, 0.4);
    }
    prevXpRef.current = xp;
  }, [xp]);

  return (
    <div className="rpg-bar">
      <div ref={fillRef} className="rpg-bar-fill rpg-bar-fill--xp" style={{ width: `${Math.round(progress)}%` }} />
      <span className="rpg-bar-label">XP {xp}/{xpForNextLevel}</span>
    </div>
  );
}
