import type {
  Trip,
  Transaction,
  OptimizationMode,
  OptimizationResult,
  TripCalculation,
} from "@/lib/models";
import { calculateTrip, matchesCoupon } from "./calculations";
import { money } from "@/lib/money";

export function candidateBlocks(trip: Trip): Transaction[] {
  const parent = new Map(trip.products.map((p) => [p.id, p.id]));
  const root = (id: string): string => {
    const p = parent.get(id)!;
    return p === id ? id : root(p);
  };
  const union = (ids: string[]) => {
    const valid = ids.filter((id) => parent.has(id));
    for (const id of valid.slice(1)) parent.set(root(id), root(valid[0]));
  };
  // Preserve complete deal groups, including optional groups, to retain their rewards.
  // Threshold/quantity coupons are also atomic. Overlapping groups merge transitively.
  for (const g of trip.groups) union(g.productIds);
  for (const c of trip.coupons)
    if (
      c.minimumSpend ||
      c.minimumQuantity > 1 ||
      c.type === "bogo" ||
      c.type === "bogo-percentage"
    )
      union(trip.products.filter((p) => matchesCoupon(p, c)).map((p) => p.id));
  const grouped = new Map<string, string[]>();
  for (const p of trip.products) {
    const r = root(p.id);
    grouped.set(r, [...(grouped.get(r) ?? []), p.id]);
  }
  return [...grouped.values()].map((ids, index) => ({
    id: `optimized-${index}`,
    name:
      trip.groups
        .filter((g) => g.productIds.every((id) => ids.includes(id)))
        .map((g) => g.name)
        .join(" + ") || trip.products.find((p) => p.id === ids[0])!.name,
    productIds: ids,
    extraBucksLimit: null,
  }));
}
function score(c: TripCalculation, mode: OptimizationMode): number[] {
  const peak = Math.max(0, ...c.transactions.map((t) => t.oop));
  switch (mode) {
    case "lowest-individual":
      return [peak, c.oop, c.endingExtraBucks];
    case "max-rewards":
      return [-c.extraBucksEarned, c.oop, c.endingExtraBucks];
    case "min-leftover":
      return [c.endingExtraBucks, c.oop, peak];
    case "balanced":
      return [c.oop + Math.round(peak / 4), c.endingExtraBucks, peak];
    default:
      return [c.oop, c.endingExtraBucks, peak];
  }
}
function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
function optimizeBlocks(
  trip: Trip,
  mode: OptimizationMode = "lowest-total",
): OptimizationResult {
  const blocks = candidateBlocks(trip);
  let best: Transaction[] = [],
    bestCalculation: TripCalculation | undefined,
    searched = 0;
  const consider = (order: Transaction[]) => {
    const c = calculateTrip(trip, order);
    searched++;
    if (
      !c.errors.length &&
      (!bestCalculation || better(score(c, mode), score(bestCalculation, mode)))
    ) {
      best = order;
      bestCalculation = c;
    }
  };
  const exact = blocks.length <= 7;
  if (exact) {
    const visit = (prefix: Transaction[], rest: Transaction[]) => {
      if (!rest.length) {
        consider(prefix);
        return;
      }
      rest.forEach((item, i) =>
        visit(
          [...prefix, item],
          rest.filter((_, j) => i !== j),
        ),
      );
    };
    visit([], blocks);
  } else {
    // Bounded deterministic beam: useful for larger trips without factorial growth.
    let beam: { order: Transaction[]; remaining: Transaction[] }[] = [
      { order: [], remaining: blocks },
    ];
    for (let depth = 0; depth < blocks.length; depth++) {
      const options = beam.flatMap((state) =>
        state.remaining.map((b, i) => ({
          order: [...state.order, b],
          remaining: state.remaining.filter((_, j) => i !== j),
        })),
      );
      const ranked = options.map((option) => {
        const ids = new Set(option.order.flatMap((t) => t.productIds));
        const partial = {
          ...trip,
          products: trip.products.filter((p) => ids.has(p.id)),
          groups: trip.groups.filter((g) =>
            g.productIds.every((id) => ids.has(id)),
          ),
        };
        return {
          ...option,
          score: score(calculateTrip(partial, option.order), mode),
        };
      });
      ranked.sort((a, b) =>
        better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : 0,
      );
      beam = ranked.slice(0, 80);
    }
    beam.forEach((s) => consider(s.order));
  }
  // Explore combining neighboring blocks. This can share otherwise wasted discounts,
  // but rewards from the combined transaction cannot fund its own purchase.
  const initial = best;
  for (let i = 0; i < initial.length - 1; i++) {
    const merged = {
      ...initial[i],
      name: `${initial[i].name} + ${initial[i + 1].name}`,
      productIds: [...initial[i].productIds, ...initial[i + 1].productIds],
    };
    consider([...initial.slice(0, i), merged, ...initial.slice(i + 2)]);
  }
  if (blocks.length)
    consider([
      {
        id: "combined",
        name: "All items",
        productIds: trip.products.map((p) => p.id),
        extraBucksLimit: null,
      },
    ]);
  const c = bestCalculation ?? calculateTrip(trip, []);
  const explanations = [
    exact
      ? "Every ordering of the protected deal blocks was checked. Merges were sampled; the result is not a global optimum over every possible product split."
      : "A bounded beam search was used for this larger trip. This is a recommendation, not a proven global optimum.",
  ];
  if (c.transactions[0]) {
    const first = c.transactions[0];
    explanations.push(
      `${first.name} starts the sequence: ${money(first.afterCoupons)} after coupons, ${money(first.extraBucksUsed)} in rewards used, and ${money(first.extraBucksEarned)} earned for later purchases.`,
    );
  }
  explanations.push(
    `This plan pays ${money(c.oop)} in cash and ends with ${money(c.endingExtraBucks)} in rewards. Newly earned rewards are only available for later transactions.`,
  );
  if (trip.transactions.length !== best.length)
    explanations.push(
      `The planner suggests ${best.length} transactions instead of ${trip.transactions.length}; deal and threshold coupon groups remain intact.`,
    );
  return {
    products: trip.products,
    transactions: best,
    calculation: c,
    explanations,
    exact,
    searched,
    mode,
  };
}

export function optimizeTrip(
  trip: Trip,
  mode: OptimizationMode = "lowest-total",
): OptimizationResult {
  const original = optimizeBlocks(trip, mode);
  // Split only independent quantities with no matching coupon or deal dependency.
  // Compare with the unsplit plan so additional transactions never worsen the selected score.
  const candidates = trip.products.filter(
    (p) =>
      p.quantity > 1 &&
      p.quantity <= 6 &&
      !trip.groups.some((g) => g.productIds.includes(p.id)) &&
      !trip.coupons.some((c) => matchesCoupon(p, c)),
  );
  if (
    !candidates.length ||
    trip.products.length + candidates.reduce((s, p) => s + p.quantity - 1, 0) >
      14
  )
    return original;
  const ids = new Set(candidates.map((p) => p.id));
  const products = trip.products.flatMap((p) =>
    ids.has(p.id)
      ? Array.from({ length: p.quantity }, (_, i) => ({
          ...p,
          id: `${p.id}-split-${i}`,
          quantity: 1,
        }))
      : p,
  );
  const alternative = optimizeBlocks({ ...trip, products }, mode);
  if (
    !better(
      score(alternative.calculation, mode),
      score(original.calculation, mode),
    )
  )
    return original;
  alternative.searched += original.searched;
  alternative.explanations.push(
    `Independent quantities were split into individual lines for ${candidates.map((p) => p.name).join(", ")}. No coupon or deal group depends on those items. Review and apply to save these splits.`,
  );
  return alternative;
}
