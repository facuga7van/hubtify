import { useState, useEffect } from 'react';

interface Rate {
  nombre: string;
  compra: number;
  venta: number;
}

export function DollarChip() {
  const [blueRate, setBlueRate] = useState<Rate | null>(null);

  useEffect(() => {
    window.api.dollarGetRates().then((res: { success: boolean; rates: Rate[] }) => {
      if (res.success) {
        const blue = res.rates.find((r) => r.nombre === 'Blue');
        if (blue) setBlueRate(blue);
      }
    });
  }, []);

  if (!blueRate) return null;

  return (
    <div className="rpg-card-sm inline-flex items-center gap-2 px-3 py-1 text-xs opacity-75">
      <span>USD Blue</span>
      <span className="font-mono">${blueRate.venta.toLocaleString('es-AR')}</span>
    </div>
  );
}
