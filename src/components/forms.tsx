"use client";
import { useForm } from "react-hook-form";
import { X } from "lucide-react";
import type { Product, Coupon, DealGroup, ExtraBuck, Trip } from "@/lib/models";
import {
  productSchema,
  couponSchema,
  dealGroupSchema,
  extraBuckSchema,
  tripSchema,
  couponTypes,
} from "@/lib/models";
import { inputMoney, toCents, uid, today } from "@/lib/money";
import { useState } from "react";

interface Field {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
  step?: string;
}
type Values = Record<string, string | string[]>;
const categories = [
  "Hair",
  "Oral care",
  "Laundry",
  "Personal care",
  "Household",
  "Other",
];
const opts = (items: readonly string[]) =>
  items.map((value) => ({ value, label: value.replaceAll("-", " ") }));
const moneyField = (key: string, label: string): Field => ({
  key,
  label,
  type: "number",
  min: 0,
  step: "0.01",
});
const numberField = (key: string, label: string, min = 0): Field => ({
  key,
  label,
  type: "number",
  min,
  step: "1",
});
const flag = (key: string, label: string): Field => ({
  key,
  label,
  options: opts(["yes", "no"]),
});
const str = (v: Values, k: string) => String(v[k] ?? "");
const number = (v: Values, k: string) => Number(str(v, k) || 0);
const cash = (v: Values, k: string) => toCents(str(v, k) || "0");
const array = (v: Values, k: string): string[] =>
  Array.isArray(v[k]) ? (v[k] as string[]) : v[k] ? [String(v[k])] : [];
const bool = (v: Values, k: string) => str(v, k) === "yes";
const dollars = (n: number | null | undefined) =>
  n == null ? "" : inputMoney(n);

function DialogForm({
  title,
  fields,
  defaults,
  products,
  onSubmit,
  onClose,
  help,
}: {
  title: string;
  fields: Field[];
  defaults: Values;
  products?: Product[];
  onSubmit: (v: Values) => void;
  onClose: () => void;
  help?: string;
}) {
  const { register, handleSubmit } = useForm<Values>({
    defaultValues: defaults,
  });
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">YOUR PLANNER</p>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {help && <p className="muted text-sm mb-5">{help}</p>}
        <form
          onSubmit={handleSubmit((values) => {
            try {
              onSubmit(values);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Check your entries.");
            }
          })}
        >
          <div className="form-grid">
            {fields.map((f) => (
              <label
                className={f.key === "notes" ? "span-two" : ""}
                key={f.key}
              >
                <span>{f.label}</span>
                {f.options ? (
                  <select {...register(f.key)}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea {...register(f.key)} rows={3} />
                ) : (
                  <input
                    {...register(f.key)}
                    type={f.type ?? "text"}
                    required={f.required}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                  />
                )}{" "}
                {f.help && <small>{f.help}</small>}
              </label>
            ))}
          </div>
          {products && (
            <fieldset className="product-picker">
              <legend>Applicable products</legend>
              <p className="muted text-xs">
                For coupons: select products or leave empty to use the
                brand/category filters.
              </p>
              {products.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    value={p.id}
                    {...register("productIds")}
                  />
                  <span>
                    {p.name} <small>×{p.quantity}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button primary" type="submit">
              Save changes
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
export function ProductForm({
  product,
  onSave,
  onClose,
}: {
  product?: Product;
  onSave: (p: Product) => void;
  onClose: () => void;
}) {
  return (
    <DialogForm
      title={product ? "Edit product" : "Add a product"}
      onClose={onClose}
      defaults={{
        name: product?.name ?? "",
        brand: product?.brand ?? "",
        size: product?.size ?? "",
        quantity: String(product?.quantity ?? 1),
        unitPrice: dollars(product?.unitPrice ?? 0),
        salePrice: dollars(product?.salePrice),
        category: product?.category ?? "Personal care",
        imageUrl: product?.imageUrl ?? "",
        notes: product?.notes ?? "",
        rewardEligible: product?.rewardEligible === false ? "no" : "yes",
      }}
      fields={[
        { key: "name", label: "Product name", required: true },
        { key: "brand", label: "Brand" },
        { key: "size", label: "Size" },
        numberField("quantity", "Quantity", 1),
        moneyField("unitPrice", "Retail price per item ($)"),
        {
          ...moneyField("salePrice", "Sale price per item ($)"),
          help: "Leave blank for retail price.",
        },
        { key: "category", label: "Category", options: opts(categories) },
        { key: "imageUrl", label: "Image URL (optional)", type: "url" },
        flag("rewardEligible", "Can ExtraBucks pay for this item?"),
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      onSubmit={(v) =>
        onSave(
          productSchema.parse({
            id: product?.id ?? uid(),
            name: str(v, "name"),
            brand: str(v, "brand"),
            size: str(v, "size"),
            quantity: number(v, "quantity"),
            unitPrice: cash(v, "unitPrice"),
            salePrice: str(v, "salePrice") === "" ? null : cash(v, "salePrice"),
            category: str(v, "category"),
            imageUrl: str(v, "imageUrl"),
            notes: str(v, "notes"),
            rewardEligible: bool(v, "rewardEligible"),
          }),
        )
      }
    />
  );
}
export function CouponForm({
  coupon,
  products,
  onSave,
  onClose,
}: {
  coupon?: Coupon;
  products?: Product[];
  onSave: (c: Coupon) => void;
  onClose: () => void;
}) {
  return (
    <DialogForm
      title={coupon ? "Edit coupon" : "Add a coupon"}
      onClose={onClose}
      products={products}
      help="Each coupon is applied once per transaction, up to its available quantity. Add duplicate coupons as separate records if needed. Coupon terms and stacking eligibility should be verified before shopping."
      defaults={{
        name: coupon?.name ?? "",
        type: coupon?.type ?? "manufacturer",
        value: dollars(coupon?.value ?? 0),
        percent: String(coupon?.percent ?? 0),
        minimumQuantity: String(coupon?.minimumQuantity ?? 0),
        minimumSpend: dollars(coupon?.minimumSpend ?? 0),
        maximumDiscount: dollars(coupon?.maximumDiscount),
        expirationDate: coupon?.expirationDate ?? "",
        productIds: coupon?.productIds ?? [],
        brand: coupon?.brand ?? "",
        category: coupon?.category ?? "",
        source: coupon?.source ?? "CVS app",
        notes: coupon?.notes ?? "",
        quantity: String(coupon?.quantity ?? 1),
        used: coupon?.used ? "yes" : "no",
        stackingClass: coupon?.stackingClass ?? "manufacturer",
        excludeSale: coupon?.excludeSale ? "yes" : "no",
      }}
      fields={[
        { key: "name", label: "Coupon name", required: true },
        { key: "type", label: "Coupon type", options: opts(couponTypes) },
        moneyField("value", "Dollar discount / reward ($)"),
        {
          key: "percent",
          label: "Percentage (for % / BOGO %)",
          type: "number",
          min: 0,
          max: 100,
          step: "0.01",
        },
        numberField("minimumQuantity", "Minimum qualifying quantity"),
        moneyField("minimumSpend", "Minimum qualifying spend ($)"),
        {
          ...moneyField("maximumDiscount", "Maximum discount ($)"),
          help: "Blank means no additional cap.",
        },
        { key: "expirationDate", label: "Expiration date", type: "date" },
        numberField("quantity", "Available uses", 1),
        { key: "brand", label: "Applicable brand (optional)" },
        {
          key: "category",
          label: "Category filter",
          options: [
            { value: "", label: "All categories" },
            ...opts(categories),
          ],
        },
        {
          key: "stackingClass",
          label: "Stacking class",
          options: opts(["manufacturer", "store", "promotion"]),
        },
        { key: "source", label: "Source" },
        flag("excludeSale", "Exclude sale items?"),
        flag("used", "Already used?"),
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      onSubmit={(v) =>
        onSave(
          couponSchema.parse({
            id: coupon?.id ?? uid(),
            name: str(v, "name"),
            type: str(v, "type"),
            value: cash(v, "value"),
            percent: number(v, "percent"),
            minimumQuantity: number(v, "minimumQuantity"),
            minimumSpend: cash(v, "minimumSpend"),
            maximumDiscount:
              str(v, "maximumDiscount") === ""
                ? null
                : cash(v, "maximumDiscount"),
            expirationDate: str(v, "expirationDate"),
            productIds: products
              ? array(v, "productIds")
              : (coupon?.productIds ?? []),
            brand: str(v, "brand"),
            category: str(v, "category"),
            source: str(v, "source"),
            notes: str(v, "notes"),
            quantity: number(v, "quantity"),
            used: bool(v, "used"),
            stackingClass: str(v, "stackingClass"),
            excludeSale: bool(v, "excludeSale"),
          }),
        )
      }
    />
  );
}
export function DealGroupForm({
  group,
  trip,
  onSave,
  onClose,
}: {
  group?: DealGroup;
  trip: Trip;
  onSave: (g: DealGroup) => void;
  onClose: () => void;
}) {
  return (
    <DialogForm
      title={group ? "Edit deal group" : "Create a deal group"}
      products={trip.products}
      onClose={onClose}
      help="Use a group to protect a shared threshold. Group discounts and rewards are additional to attached coupons; enter each benefit only once. Complete group qualification is checked per transaction."
      defaults={{
        name: group?.name ?? "",
        productIds: group?.productIds ?? [],
        minimumSpend: dollars(group?.minimumSpend ?? 0),
        minimumQuantity: String(group?.minimumQuantity ?? 0),
        discount: dollars(group?.discount ?? 0),
        extraBucksReward: dollars(group?.extraBucksReward ?? 0),
        requiredCouponId: group?.requiredCouponId ?? "",
        mustStayTogether: group?.mustStayTogether === false ? "no" : "yes",
        onceOnly: group?.onceOnly === false ? "no" : "yes",
        thresholdBasis: group?.thresholdBasis ?? "before-coupons",
        notes: group?.notes ?? "",
      }}
      fields={[
        { key: "name", label: "Deal group name", required: true },
        moneyField("minimumSpend", "Minimum qualifying spend ($)"),
        numberField("minimumQuantity", "Minimum quantity"),
        moneyField("discount", "Additional group discount ($)"),
        moneyField("extraBucksReward", "ExtraBucks earned ($)"),
        {
          key: "requiredCouponId",
          label: "Required coupon",
          options: [
            { value: "", label: "None" },
            ...trip.coupons.map((c) => ({ value: c.id, label: c.name })),
          ],
        },
        flag("mustStayTogether", "Must stay together?"),
        flag("onceOnly", "Reward earned only once?"),
        {
          key: "thresholdBasis",
          label: "Spend threshold basis",
          options: opts(["before-coupons", "after-coupons"]),
        },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      onSubmit={(v) =>
        onSave(
          dealGroupSchema.parse({
            id: group?.id ?? uid(),
            name: str(v, "name"),
            productIds: array(v, "productIds"),
            minimumSpend: cash(v, "minimumSpend"),
            minimumQuantity: number(v, "minimumQuantity"),
            discount: cash(v, "discount"),
            extraBucksReward: cash(v, "extraBucksReward"),
            requiredCouponId: str(v, "requiredCouponId"),
            mustStayTogether: bool(v, "mustStayTogether"),
            onceOnly: bool(v, "onceOnly"),
            thresholdBasis: str(v, "thresholdBasis"),
            notes: str(v, "notes"),
          }),
        )
      }
    />
  );
}
export function WalletForm({
  reward,
  onSave,
  onClose,
}: {
  reward?: ExtraBuck;
  onSave: (r: ExtraBuck) => void;
  onClose: () => void;
}) {
  return (
    <DialogForm
      title={reward ? "Edit ExtraBucks" : "Add ExtraBucks"}
      onClose={onClose}
      defaults={{
        amount: dollars(reward?.amount ?? 0),
        usedAmount: dollars(reward?.usedAmount ?? 0),
        sourceTransaction: reward?.sourceTransaction ?? "Manual entry",
        earnedDate: reward?.earnedDate ?? today(),
        expirationDate: reward?.expirationDate ?? "",
        status: reward?.status ?? "available",
      }}
      fields={[
        moneyField("amount", "Amount ($)"),
        moneyField("usedAmount", "Already used ($)"),
        { key: "sourceTransaction", label: "Source transaction" },
        { key: "earnedDate", label: "Earned date", type: "date" },
        { key: "expirationDate", label: "Expiration date", type: "date" },
        {
          key: "status",
          label: "Status",
          options: opts([
            "available",
            "partially-used",
            "used",
            "expired",
            "planned",
          ]),
        },
      ]}
      onSubmit={(v) =>
        onSave(
          extraBuckSchema.parse({
            id: reward?.id ?? uid(),
            amount: cash(v, "amount"),
            usedAmount: cash(v, "usedAmount"),
            sourceTransaction: str(v, "sourceTransaction"),
            earnedDate: str(v, "earnedDate"),
            expirationDate: str(v, "expirationDate"),
            status: str(v, "status"),
          }),
        )
      }
    />
  );
}
export function TripForm({
  trip,
  onSave,
  onClose,
}: {
  trip: Trip;
  onSave: (t: Trip) => void;
  onClose: () => void;
}) {
  return (
    <DialogForm
      title="Trip settings"
      onClose={onClose}
      defaults={{
        name: trip.name,
        store: trip.store,
        location: trip.location,
        date: trip.date,
        startingExtraBucks: dollars(trip.startingExtraBucks),
        taxRate: String(trip.taxRate),
        taxBasis: trip.taxBasis,
        notes: trip.notes,
      }}
      fields={[
        { key: "name", label: "Trip name", required: true },
        { key: "store", label: "Store" },
        { key: "location", label: "Location (optional)" },
        { key: "date", label: "Shopping date", type: "date" },
        moneyField("startingExtraBucks", "Starting ExtraBucks ($)"),
        {
          key: "taxRate",
          label: "Estimated tax rate (%)",
          type: "number",
          min: 0,
          max: 25,
          step: "0.001",
        },
        {
          key: "taxBasis",
          label: "Estimated tax basis",
          options: opts(["before-coupons", "after-coupons", "after-eb"]),
        },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      onSubmit={(v) =>
        onSave(
          tripSchema.parse({
            ...trip,
            name: str(v, "name"),
            store: str(v, "store"),
            location: str(v, "location"),
            date: str(v, "date"),
            startingExtraBucks: cash(v, "startingExtraBucks"),
            taxRate: number(v, "taxRate"),
            taxBasis: str(v, "taxBasis"),
            notes: str(v, "notes"),
          }),
        )
      }
    />
  );
}
