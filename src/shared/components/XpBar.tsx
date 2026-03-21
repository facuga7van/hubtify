import { xpThreshold } from '../../../shared/rpg-engine';

interface XpBarProps { xp: number; xpToNextLevel: number; level: number; }

export default function XpBar({ xp, level }: XpBarProps) {
  const xpForCurrentLevel = xpThreshold(level);
  const xpForNextLevel = xpThreshold(level + 1);
  const progress = xpForNextLevel > xpForCurrentLevel
    ? ((xp - xpForCurrentLevel) / (xpForNextLevel - xpForCurrentLevel)) * 100
    : 100;

  return (
    <div className="rpg-bar">
      <div className="rpg-bar-fill rpg-bar-fill--xp" style={{ width: `${Math.round(progress)}%` }} />
      <span className="rpg-bar-label">XP {xp}/{xpForNextLevel}</span>
    </div>
  );
}
