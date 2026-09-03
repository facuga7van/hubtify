/**
 * What the purse can say to someone standing where the óbolos are EARNED.
 *
 * Measured in the owner's real database: 132 óbolos earned, 0 spent, with an
 * empty rewards counter. The coin was minted in the seal modal and never
 * mentioned again, so it read as a decoration. Naming the closest reward turns
 * the balance into a reason.
 */

export interface PurseReward {
  id: string;
  name: string;
  cost: number;
}

export type PurseHint =
  /** Nothing on the counter — there is nothing honest to promise. */
  | { kind: 'no-rewards' }
  /** The best thing the balance already covers. */
  | { kind: 'affordable'; reward: PurseReward }
  /** The nearest thing, and how much is missing. */
  | { kind: 'closest'; reward: PurseReward; missing: number };

/**
 * Picks what to show next to the balance.
 *
 * "Affordable" deliberately means the MOST expensive thing already covered —
 * the balance's real reach — while "closest" is the cheapest thing out of
 * reach, which is the shortest promise we can make without lying.
 */
export function purseHint(balance: number, rewards: PurseReward[]): PurseHint {
  if (rewards.length === 0) return { kind: 'no-rewards' };

  const byCost = [...rewards].sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  const covered = byCost.filter((r) => r.cost <= balance);
  if (covered.length > 0) {
    return { kind: 'affordable', reward: covered[covered.length - 1] };
  }
  const next = byCost[0];
  return { kind: 'closest', reward: next, missing: next.cost - balance };
}
