import { describe, it, expect } from 'vitest';
import { purseHint, type PurseReward } from '../../src/hub/codex/purse';

const REWARDS: PurseReward[] = [
  { id: 'a', name: 'Un capítulo más', cost: 20 },
  { id: 'b', name: 'Dos horas de jueguito', cost: 60 },
  { id: 'c', name: 'Una salida a comer', cost: 150 },
];

describe('purseHint', () => {
  it('sin recompensas no promete nada', () => {
    expect(purseHint(500, [])).toEqual({ kind: 'no-rewards' });
  });

  it('con saldo de sobra nombra lo más caro que ya cubre', () => {
    expect(purseHint(132, REWARDS)).toEqual({
      kind: 'affordable',
      reward: { id: 'b', name: 'Dos horas de jueguito', cost: 60 },
    });
  });

  it('sin saldo nombra lo más cercano y cuánto falta', () => {
    expect(purseHint(5, REWARDS)).toEqual({
      kind: 'closest',
      reward: { id: 'a', name: 'Un capítulo más', cost: 20 },
      missing: 15,
    });
  });

  it('el costo exacto ya cuenta como alcanzable', () => {
    const hint = purseHint(20, REWARDS);
    expect(hint).toEqual({ kind: 'affordable', reward: REWARDS[0] });
  });

  it('con saldo cero y una sola recompensa, falta su costo entero', () => {
    expect(purseHint(0, [REWARDS[2]])).toEqual({
      kind: 'closest', reward: REWARDS[2], missing: 150,
    });
  });

  it('desempata por nombre, para que el texto no baile entre renders', () => {
    const tie: PurseReward[] = [
      { id: 'z', name: 'Zapatillas', cost: 30 },
      { id: 'a', name: 'Alfajor', cost: 30 },
    ];
    expect(purseHint(10, tie)).toMatchObject({ kind: 'closest', reward: { id: 'a' } });
  });
});
