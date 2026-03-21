import { useState, useEffect } from 'react';
import type { XpToastData } from '../types';

export type { XpToastData };

const BONUS_LABELS: Record<string, string> = {
  normal: '',
  good: 'Buen golpe!',
  critical: 'Golpe critico!',
  legendary: 'LEGENDARIO!',
};

interface Props {
  data: XpToastData | null;
}

export default function XpToast({ data }: Props) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<XpToastData | null>(null);

  useEffect(() => {
    if (!data) return;
    setCurrent(data);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [data]);

  if (!current || !visible) return null;

  const label = BONUS_LABELS[current.bonusTier];

  return (
    <div className={`xp-toast xp-toast--${current.bonusTier} ${visible ? 'xp-toast--visible' : ''}`}>
      <span className="xp-toast__xp">+{current.xp} XP</span>
      {current.comboMultiplier > 1 && (
        <span className="xp-toast__combo">x{current.comboMultiplier} Combo</span>
      )}
      {label && <span className="xp-toast__bonus">{label}</span>}
      {current.streakMilestone && (
        <span className="xp-toast__streak">Racha bonus +{current.streakMilestone} XP!</span>
      )}
    </div>
  );
}
