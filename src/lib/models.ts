import { z } from "zod";

// All persisted financial values are integer cents. Dollars exist only in form inputs.
const cents = z.number().int().min(0).max(100_000_000);
const optionalDate = z.union([z.literal(""), z.iso.date()]);
const quantity = z.number().int().min(1).max(100);
export const couponTypes = [
  "manufacturer",
  "cvs-digital",
  "crt",
  "percentage",
  "dollar",
  "bogo",
  "bogo-percentage",
  "spend-get",
  "spend-save",
  "buy-get",
  "custom",
] as const;
export const productSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  brand: z.string().default(""),
  size: z.string().default(""),
  quantity,
  unitPrice: cents,
  salePrice: cents.nullable().default(null),
  category: z.string().default("Personal care"),
  imageUrl: z.union([z.literal(""), z.url()]).default(""),
  notes: z.string().default(""),
  rewardEligible: z.boolean().default(true),
});
export const couponSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  type: z.enum(couponTypes),
  value: cents,
  percent: z.number().min(0).max(100).default(0),
  minimumQuantity: z.number().int().min(0).max(100).default(0),
  minimumSpend: cents.default(0),
  maximumDiscount: cents.nullable().default(null),
  expirationDate: optionalDate.default(""),
  productIds: z.array(z.string()).default([]),
  brand: z.string().default(""),
  category: z.string().default(""),
  source: z.string().default("CVS app"),
  notes: z.string().default(""),
  quantity,
  used: z.boolean().default(false),
  // Digital is a source, not a stacking class. A digital manufacturer coupon still occupies the manufacturer slot.
  stackingClass: z
    .enum(["manufacturer", "store", "promotion"])
    .default("store"),
  excludeSale: z.boolean().default(false),
});
export const dealGroupSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  productIds: z.array(z.string()).min(1),
  minimumSpend: cents.default(0),
  minimumQuantity: z.number().int().min(0).default(0),
  discount: cents.default(0),
  extraBucksReward: cents.default(0),
  requiredCouponId: z.string().default(""),
  mustStayTogether: z.boolean().default(true),
  onceOnly: z.boolean().default(true),
  thresholdBasis: z
    .enum(["before-coupons", "after-coupons"])
    .default("before-coupons"),
  notes: z.string().default(""),
});
export const extraBuckSchema = z
  .object({
    id: z.string(),
    amount: cents,
    usedAmount: cents.default(0),
    sourceTransaction: z.string().default("Manual entry"),
    earnedDate: optionalDate.default(""),
    expirationDate: optionalDate.default(""),
    status: z
      .enum(["available", "partially-used", "used", "expired", "planned"])
      .default("available"),
  })
  .refine((v) => v.usedAmount <= v.amount, {
    message: "Used amount cannot exceed the reward amount.",
  });
export const transactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  productIds: z.array(z.string()),
  extraBucksLimit: cents.nullable().default(null),
});
export const tripSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  store: z.string().default("CVS"),
  location: z.string().default(""),
  date: z.iso.date(),
  startingExtraBucks: cents,
  walletIds: z.array(z.string()).default([]),
  notes: z.string().default(""),
  products: z.array(productSchema),
  coupons: z.array(couponSchema),
  groups: z.array(dealGroupSchema),
  transactions: z.array(transactionSchema),
  taxRate: z.number().min(0).max(25).default(0),
  taxBasis: z
    .enum(["before-coupons", "after-coupons", "after-eb"])
    .default("after-coupons"),
  status: z.enum(["planned", "completed"]).default("planned"),
  completedSummary: z
    .object({
      retail: cents,
      discounts: cents,
      used: cents,
      cash: cents,
      earned: cents,
      ending: cents,
    })
    .optional(),
  scenarioOf: z.string().optional(),
  createdAt: z.string(),
});
export const stateSchema = z.object({
  version: z.literal(1),
  trips: z.array(tripSchema),
  coupons: z.array(couponSchema),
  wallet: z.array(extraBuckSchema),
  beginner: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;
export type Coupon = z.infer<typeof couponSchema>;
export type DealGroup = z.infer<typeof dealGroupSchema>;
export type ExtraBuck = z.infer<typeof extraBuckSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type Scenario = Trip & { scenarioOf: string };
export type AppState = z.infer<typeof stateSchema>;
export type OptimizationMode =
  | "lowest-total"
  | "lowest-individual"
  | "max-rewards"
  | "min-leftover"
  | "balanced";
export interface AppliedDiscount {
  id: string;
  name: string;
  amount: number;
  productIds: string[];
}
export interface TransactionCalculation {
  id: string;
  name: string;
  productIds: string[];
  retail: number;
  saleSavings: number;
  subtotal: number;
  discounts: AppliedDiscount[];
  productCosts: {
    id: string;
    afterCoupons: number;
    extraBucksUsed: number;
    afterExtraBucks: number;
    effectiveUnitCost: number;
  }[];
  appliedCouponIds: string[];
  afterCoupons: number;
  extraBucksUsed: number;
  tax: number;
  oop: number;
  extraBucksEarned: number;
  endingExtraBucks: number;
  warnings: string[];
}
export interface TripCalculation {
  transactions: TransactionCalculation[];
  retail: number;
  saleSavings: number;
  discounts: number;
  oop: number;
  extraBucksUsed: number;
  extraBucksEarned: number;
  endingExtraBucks: number;
  netCost: number;
  warnings: string[];
  errors: string[];
}
export interface OptimizationResult {
  products: Product[];
  transactions: Transaction[];
  calculation: TripCalculation;
  explanations: string[];
  exact: boolean;
  searched: number;
  mode: OptimizationMode;
}
