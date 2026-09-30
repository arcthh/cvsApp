import type {
  Product,
  Coupon,
  DealGroup,
  Transaction,
  Trip,
  TripCalculation,
  TransactionCalculation,
  AppliedDiscount,
} from "@/lib/models";

export const calculateProductSubtotal = (p: Product) =>
  (p.salePrice ?? p.unitPrice) * p.quantity;
export function calculateBOGODiscount(
  products: Product[],
  percent = 100,
): number {
  // Pair highest with next-highest, discount the cheaper item, with cent rounding per item.
  const units = products
    .flatMap((p) => Array<number>(p.quantity).fill(p.salePrice ?? p.unitPrice))
    .sort((a, b) => b - a);
  return units.reduce(
    (sum, price, i) =>
      sum + (i % 2 === 1 ? Math.round((price * percent) / 100) : 0),
    0,
  );
}
export function matchesCoupon(p: Product, c: Coupon): boolean {
  return (
    (!c.productIds.length || c.productIds.includes(p.id)) &&
    (!c.brand || p.brand.toLowerCase() === c.brand.toLowerCase()) &&
    (!c.category || p.category === c.category) &&
    (!c.excludeSale || p.salePrice === null)
  );
}
export function calculateCouponDiscount(
  c: Coupon,
  products: Product[],
  remaining?: Map<string, number>,
): number {
  const eligible = products.filter((p) => matchesCoupon(p, c));
  const gross = eligible.reduce((s, p) => s + calculateProductSubtotal(p), 0);
  const available = eligible.reduce(
    (s, p) => s + (remaining?.get(p.id) ?? calculateProductSubtotal(p)),
    0,
  );
  if (
    gross < c.minimumSpend ||
    eligible.reduce((s, p) => s + p.quantity, 0) < c.minimumQuantity
  )
    return 0;
  let value = 0;
  if (c.type === "bogo" || c.type === "bogo-percentage")
    value = calculateBOGODiscount(
      eligible,
      c.type === "bogo" ? 100 : c.percent,
    );
  else if (c.type === "percentage")
    value = Math.round((available * c.percent) / 100);
  else if (c.type !== "spend-get" && c.type !== "buy-get") value = c.value;
  return Math.min(available, c.maximumDiscount ?? Infinity, value);
}
export const calculateThresholdCoupon = calculateCouponDiscount;
export const calculateTransactionSubtotal = (products: Product[]) =>
  products.reduce((s, p) => s + calculateProductSubtotal(p), 0);
export const calculateExtraBucksUsed = (
  subtotal: number,
  balance: number,
  limit: number | null = null,
) => Math.max(0, Math.min(subtotal, balance, limit ?? Infinity));
export const calculateTransactionOOP = (
  subtotal: number,
  eb: number,
  tax = 0,
) => Math.max(0, subtotal - eb) + tax;
export const calculateEndingEB = (
  starting: number,
  used: number,
  earned: number,
) => Math.max(0, starting - used) + earned;
export const calculateNetCostAfterRewards = (
  cash: number,
  used: number,
  earned: number,
) => cash + used - earned;
export const calculateTripOOP = (transactions: TransactionCalculation[]) =>
  transactions.reduce((s, t) => s + t.oop, 0);
export function groupQualification(g: DealGroup, products: Product[]) {
  const eligible = products.filter((p) => g.productIds.includes(p.id));
  const subtotal = calculateTransactionSubtotal(eligible),
    quantity = eligible.reduce((s, p) => s + p.quantity, 0);
  return {
    subtotal,
    quantity,
    qualified:
      subtotal >= g.minimumSpend &&
      quantity >= g.minimumQuantity &&
      g.productIds.every((id) => eligible.some((p) => p.id === id)),
  };
}
export const calculateExtraBucksEarned = (
  groups: DealGroup[],
  products: Product[],
) =>
  groups.reduce(
    (s, g) =>
      s + (groupQualification(g, products).qualified ? g.extraBucksReward : 0),
    0,
  );

export function validateAssignments(
  trip: Trip,
  transactions: Transaction[],
): string[] {
  const errors: string[] = [],
    assigned = new Set<string>(),
    valid = new Set(trip.products.map((p) => p.id));
  for (const t of transactions)
    for (const id of t.productIds) {
      if (!valid.has(id)) errors.push(`${t.name} contains an unknown product.`);
      if (assigned.has(id))
        errors.push("A product appears in more than one transaction.");
      assigned.add(id);
    }
  if (trip.products.some((p) => !assigned.has(p.id)))
    errors.push("Assign every product to a transaction.");
  for (const g of trip.groups) {
    if (g.productIds.some((id) => !valid.has(id)))
      errors.push(`${g.name} references a missing product.`);
    if (
      g.mustStayTogether &&
      !transactions.some((t) =>
        g.productIds.every((id) => t.productIds.includes(id)),
      )
    )
      errors.push(`${g.name} must stay together in one transaction.`);
  }
  return [...new Set(errors)];
}

export function calculateTrip(
  trip: Trip,
  transactions = trip.transactions,
): TripCalculation {
  let balance = trip.startingExtraBucks;
  const usage = new Map<string, number>(),
    groupUsed = new Set<string>();
  const warnings: string[] = [],
    results: TransactionCalculation[] = [];
  const errors = validateAssignments(trip, transactions);
  if (errors.length)
    return {
      transactions: [],
      retail: 0,
      saleSavings: 0,
      discounts: 0,
      oop: 0,
      extraBucksUsed: 0,
      extraBucksEarned: 0,
      endingExtraBucks: balance,
      netCost: 0,
      warnings,
      errors,
    };
  for (const tx of transactions) {
    const products = trip.products.filter((p) => tx.productIds.includes(p.id));
    const subtotal = calculateTransactionSubtotal(products),
      retail = products.reduce((s, p) => s + p.quantity * p.unitPrice, 0);
    const remaining = new Map(
      products.map((p) => [p.id, calculateProductSubtotal(p)]),
    );
    const discounts: AppliedDiscount[] = [],
      txWarnings: string[] = [],
      applied = new Set<string>(),
      manufacturerSlots = new Map<string, number>();
    let reward = 0;
    // Allocate every coupon to its eligible lines to avoid discounting unrelated products or negative lines.
    const apply = (
      id: string,
      name: string,
      value: number,
      eligible: Product[],
    ) => {
      const ids = eligible.map((p) => p.id),
        capacity = ids.reduce((s, id) => s + (remaining.get(id) ?? 0), 0);
      let left = Math.min(value, capacity);
      const amount = left;
      for (const id of ids) {
        const take = Math.min(left, remaining.get(id) ?? 0);
        remaining.set(id, (remaining.get(id) ?? 0) - take);
        left -= take;
      }
      if (amount) discounts.push({ id, name, amount, productIds: ids });
    };
    // Retail promotions first, then manufacturer/store dollar coupons, percentages last.
    const coupons = [...trip.coupons].sort((a, b) => rank(a) - rank(b));
    for (const c of coupons) {
      const eligible = products.filter((p) => matchesCoupon(p, c));
      if (!eligible.length) continue;
      if (c.used) {
        txWarnings.push(`${c.name}: unavailable or already used.`);
        continue;
      }
      if ((usage.get(c.id) ?? 0) >= c.quantity) continue;
      if (c.expirationDate && c.expirationDate < trip.date) {
        txWarnings.push(`${c.name}: expires before this trip.`);
        continue;
      }
      const spend = eligible.reduce(
          (s, p) => s + calculateProductSubtotal(p),
          0,
        ),
        qty = eligible.reduce((s, p) => s + p.quantity, 0);
      if (spend < c.minimumSpend || qty < c.minimumQuantity) {
        txWarnings.push(`${c.name}: threshold not met.`);
        continue;
      }
      if (c.stackingClass === "manufacturer") {
        // A coupon attaches to its listed products. Reserve one unit, or its minimum quantity,
        // conservatively; overlapping manufacturer coupons cannot occupy the same unit.
        const required = Math.max(1, c.minimumQuantity);
        const free = eligible.reduce(
          (s, p) => s + p.quantity - (manufacturerSlots.get(p.id) ?? 0),
          0,
        );
        if (free < required) {
          txWarnings.push(`${c.name}: manufacturer coupon stacking conflict.`);
          continue;
        }
        let needed = required;
        for (const p of eligible) {
          const take = Math.min(
            needed,
            p.quantity - (manufacturerSlots.get(p.id) ?? 0),
          );
          manufacturerSlots.set(
            p.id,
            (manufacturerSlots.get(p.id) ?? 0) + take,
          );
          needed -= take;
        }
      }
      if (c.type === "spend-get" || c.type === "buy-get") reward += c.value;
      else
        apply(
          c.id,
          c.name,
          calculateCouponDiscount(c, products, remaining),
          eligible,
        );
      usage.set(c.id, (usage.get(c.id) ?? 0) + 1);
      applied.add(c.id);
    }
    for (const g of trip.groups) {
      if (!g.productIds.some((id) => tx.productIds.includes(id))) continue;
      if (g.onceOnly && groupUsed.has(g.id)) continue;
      const qualified = groupQualification(g, products);
      const groupProducts = products.filter((p) => g.productIds.includes(p.id));
      const basis =
        g.thresholdBasis === "after-coupons"
          ? groupProducts.reduce((s, p) => s + (remaining.get(p.id) ?? 0), 0)
          : qualified.subtotal;
      if (!qualified.qualified || basis < g.minimumSpend) {
        txWarnings.push(
          `${g.name}: spend/quantity threshold or complete group not met.`,
        );
        continue;
      }
      if (g.requiredCouponId && !applied.has(g.requiredCouponId)) {
        txWarnings.push(`${g.name}: required coupon unavailable.`);
        continue;
      }
      apply(g.id, g.name, g.discount, groupProducts);
      reward += g.extraBucksReward;
      groupUsed.add(g.id);
    }
    const afterCoupons = [...remaining.values()].reduce((a, b) => a + b, 0);
    const ebEligible = products
      .filter((p) => p.rewardEligible)
      .reduce((s, p) => s + (remaining.get(p.id) ?? 0), 0);
    const extraBucksUsed = calculateExtraBucksUsed(
      ebEligible,
      balance,
      tx.extraBucksLimit,
    );
    const taxBase =
      trip.taxBasis === "before-coupons"
        ? subtotal
        : trip.taxBasis === "after-eb"
          ? afterCoupons - extraBucksUsed
          : afterCoupons;
    const tax = Math.round((taxBase * trip.taxRate) / 100),
      oop = calculateTransactionOOP(afterCoupons, extraBucksUsed, tax);
    balance = calculateEndingEB(balance, extraBucksUsed, reward);
    let ebLeft = extraBucksUsed;
    const productCosts = products.map((p) => {
      const afterCoupons = remaining.get(p.id) ?? 0;
      const used = p.rewardEligible ? Math.min(ebLeft, afterCoupons) : 0;
      ebLeft -= used;
      return {
        id: p.id,
        afterCoupons,
        extraBucksUsed: used,
        afterExtraBucks: afterCoupons - used,
        effectiveUnitCost: Math.round(afterCoupons / p.quantity),
      };
    });
    results.push({
      id: tx.id,
      name: tx.name,
      productIds: tx.productIds,
      retail,
      saleSavings: retail - subtotal,
      subtotal,
      discounts,
      productCosts,
      appliedCouponIds: [...applied],
      afterCoupons,
      extraBucksUsed,
      tax,
      oop,
      extraBucksEarned: reward,
      endingExtraBucks: balance,
      warnings: txWarnings,
    });
    warnings.push(...txWarnings);
  }
  const sum = (
    key: "retail" | "saleSavings" | "extraBucksUsed" | "extraBucksEarned",
  ) => results.reduce((s, t) => s + t[key], 0);
  const oop = calculateTripOOP(results),
    used = sum("extraBucksUsed"),
    earned = sum("extraBucksEarned");
  return {
    transactions: results,
    retail: sum("retail"),
    saleSavings: sum("saleSavings"),
    discounts: results.reduce(
      (s, t) => s + t.discounts.reduce((a, d) => a + d.amount, 0),
      0,
    ),
    oop,
    extraBucksUsed: used,
    extraBucksEarned: earned,
    endingExtraBucks: balance,
    netCost: calculateNetCostAfterRewards(oop, used, earned),
    warnings: [...new Set(warnings)],
    errors,
  };
}
function rank(c: Coupon) {
  return c.type === "bogo" || c.type === "bogo-percentage"
    ? 0
    : c.type === "percentage"
      ? 2
      : 1;
}
