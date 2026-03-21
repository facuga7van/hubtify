import { useState } from 'react';

interface Props { onComplete: () => void; }

export default function NutritionOnboarding({ onComplete }: Props) {
  const [age, setAge] = useState(25);
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [activity, setActivity] = useState('moderate');

  const handleSubmit = async () => {
    await window.api.nutritionSaveProfile({
      age, sex, heightCm: height, initialWeightKg: weight,
      activityLevel: activity, deficitTargetKcal: 500, gymCalories: 300, stepCaloriesFactor: 0.04,
    });
    onComplete();
  };

  return (
    <div className="rpg-card" style={{ maxWidth: 420, margin: '40px auto', padding: 24 }}>
      <h3 style={{ marginBottom: 16, textAlign: 'center' }}>Nutrition Setup</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>Age<input type="number" value={age} onChange={(e) => setAge(+e.target.value)} className="rpg-input" style={{ width: '100%' }} /></label>
        <label>Sex
          <select value={sex} onChange={(e) => setSex(e.target.value as 'M' | 'F')} className="rpg-select" style={{ width: '100%' }}>
            <option value="M">Male</option><option value="F">Female</option>
          </select>
        </label>
        <label>Height (cm)<input type="number" value={height} onChange={(e) => setHeight(+e.target.value)} className="rpg-input" style={{ width: '100%' }} /></label>
        <label>Weight (kg)<input type="number" value={weight} onChange={(e) => setWeight(+e.target.value)} className="rpg-input" style={{ width: '100%' }} /></label>
        <label>Activity Level
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className="rpg-select" style={{ width: '100%' }}>
            <option value="sedentary">Sedentary</option><option value="light">Light</option>
            <option value="moderate">Moderate</option><option value="active">Active</option>
          </select>
        </label>
        <button className="rpg-button" onClick={handleSubmit} style={{ marginTop: 8 }}>Start Tracking</button>
      </div>
    </div>
  );
}
