import { useState, useEffect } from 'react';

export default function NutritionDashboardWidget() {
  const [calories, setCalories] = useState(0);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      window.api.nutritionGetTodayCalories(),
      window.api.nutritionGetTodayTarget(),
    ]).then(([c, t]) => {
      setCalories(c);
      setTarget(t);
    });
  }, []);

  const pct = target && target > 0 ? Math.round((calories / target) * 100) : 0;

  return (
    <div>
      <p style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
        {calories} <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>kcal</span>
      </p>
      {target ? (
        <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: 4 }}>
          {pct}% of {target} kcal target
        </p>
      ) : (
        <p style={{ fontSize: '0.85rem', opacity: 0.5, fontStyle: 'italic' }}>Setup required</p>
      )}
    </div>
  );
}
