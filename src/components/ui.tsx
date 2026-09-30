import type { ReactNode } from "react";
import type {
  TransactionCalculation,
  Trip,
  DealGroup,
  Product,
  TripCalculation,
} from "@/lib/models";
import { money } from "@/lib/money";
import { groupQualification } from "@/services/calculations";
import { ArrowRight, Check, LockKeyhole, TriangleAlert } from "lucide-react";
export function Metric({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">+</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function CouponBadge({ children }: { children: ReactNode }) {
  return <span className="badge yellow">{children}</span>;
}
export function ExtraBucksBadge({ amount }: { amount: number }) {
  return <span className="badge green">+{money(amount)} rewards</span>;
}
export function ThresholdProgress({
  current,
  target,
}: {
  current: number;
  target: number;
}) {
  return (
    <div className="threshold">
      <div className="flex justify-between text-xs">
        <span>Qualifying subtotal {money(current)}</span>
        <strong>{target ? `Goal ${money(target)}` : "No spend minimum"}</strong>
      </div>
      <div className="progress">
        <span
          style={{
            width: `${target ? Math.min(100, (current / target) * 100) : 100}%`,
          }}
        />
      </div>
    </div>
  );
}
export function DealGroupCard({
  group,
  products,
  onEdit,
  onDelete,
}: {
  group: DealGroup;
  products: Product[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const q = groupQualification(group, products);
  return (
    <article className="deal-card">
      <div className="flex justify-between gap-2">
        <h3>{group.name}</h3>
        <span className={`badge ${q.qualified ? "green" : "yellow"}`}>
          {q.qualified ? <Check size={12} /> : <TriangleAlert size={12} />}{" "}
          {q.qualified ? "Qualifying subtotal met" : "Check threshold"}
        </span>
      </div>
      <p className="muted text-xs mt-2">
        {group.productIds
          .map(
            (id) => products.find((p) => p.id === id)?.name ?? "Missing item",
          )
          .join(" · ")}
      </p>
      <ThresholdProgress current={q.subtotal} target={group.minimumSpend} />
      <div className="flex flex-wrap gap-2 mt-3">
        {group.extraBucksReward > 0 && (
          <ExtraBucksBadge amount={group.extraBucksReward} />
        )}{" "}
        {group.minimumQuantity > 0 && (
          <span className="badge">
            {q.quantity} / {group.minimumQuantity} items
          </span>
        )}{" "}
        {group.mustStayTogether && (
          <span className="badge">
            <LockKeyhole size={11} /> Keep together
          </span>
        )}
      </div>
      <p className="muted text-xs mt-2">
        {group.thresholdBasis.replaceAll("-", " ")} ·{" "}
        {group.onceOnly ? "one reward per trip" : "per qualifying transaction"}
      </p>
      <div className="flex gap-3 mt-3">
        <button className="text-button" onClick={onEdit}>
          Edit group
        </button>
        <button className="text-button muted" onClick={onDelete}>
          Remove
        </button>
      </div>
    </article>
  );
}
export function TripSummary({
  calculation,
  starting,
}: {
  calculation: TripCalculation;
  starting: number;
}) {
  return (
    <div className="summary-panel">
      <div className="flex items-center justify-between">
        <h3>Your trip, at a glance</h3>
        <span className="badge">ESTIMATE</span>
      </div>
      <div className="summary-row">
        <span>Retail value</span>
        <span>{money(calculation.retail)}</span>
      </div>
      <div className="summary-row">
        <span>Sale savings</span>
        <span>−{money(calculation.saleSavings)}</span>
      </div>
      <div className="summary-row">
        <span>Coupon & deal savings</span>
        <span>−{money(calculation.discounts)}</span>
      </div>
      <div className="summary-row">
        <span>ExtraBucks used</span>
        <span>−{money(calculation.extraBucksUsed)}</span>
      </div>
      <div className="summary-row">
        <span>Estimated tax</span>
        <span>
          {money(calculation.transactions.reduce((s, t) => s + t.tax, 0))}
        </span>
      </div>
      <div className="summary-total">
        <span>Cash / card total</span>
        <strong>{money(calculation.oop)}</strong>
      </div>
      <div className="rewards-flow">
        <span>
          Start
          <br />
          <strong>{money(starting)}</strong>
        </span>
        <ArrowRight size={14} />
        <span>
          Earn
          <br />
          <strong>+{money(calculation.extraBucksEarned)}</strong>
        </span>
        <ArrowRight size={14} />
        <span>
          Finish
          <br />
          <strong>{money(calculation.endingExtraBucks)}</strong>
        </span>
      </div>
      <p className="text-xs muted mt-4">
        Effective net cost: <strong>{money(calculation.netCost)}</strong>
        <br />
        Cash + rewards used − rewards earned. This accounts for the value of
        rewards you already owned.
      </p>
    </div>
  );
}
export function TransactionCard({
  transaction,
  trip,
  beginner,
  index,
}: {
  transaction: TransactionCalculation;
  trip: Trip;
  beginner: boolean;
  index: number;
}) {
  const t = transaction;
  return (
    <article className="transaction-card">
      <div className="transaction-heading">
        <span className="step-number">{index + 1}</span>
        <div>
          <p className="eyebrow">TRANSACTION {index + 1}</p>
          <h3>{t.name}</h3>
        </div>
        <div className="pay-total">
          <small>Pay approximately</small>
          <strong>{money(t.oop)}</strong>
        </div>
      </div>
      <div className="transaction-content">
        <div>
          <p className="section-label">
            {beginner ? "STEP 1 · BUY THESE ITEMS" : "PRODUCTS"}
          </p>
          {t.productIds.map((id) => {
            const p = trip.products.find((p) => p.id === id)!;
            return (
              <div className="item-line" key={id}>
                <span>
                  {p.name} <small>×{p.quantity}</small>
                </span>
                <span>{money((p.salePrice ?? p.unitPrice) * p.quantity)}</span>
              </div>
            );
          })}
          <p className="section-label mt-5">
            {beginner ? "STEP 2 · USE THESE COUPONS" : "APPLIED DISCOUNTS"}
          </p>
          {t.discounts.length ? (
            t.discounts.map((d) => (
              <div className="item-line" key={d.id}>
                <span>{d.name}</span>
                <span className="green-text">−{money(d.amount)}</span>
              </div>
            ))
          ) : (
            <p className="muted text-xs">No discounts applied</p>
          )}
        </div>
        <div className="transaction-math">
          <div className="summary-row">
            <span>Retail subtotal</span>
            <span>{money(t.retail)}</span>
          </div>
          <div className="summary-row">
            <span>Sale savings</span>
            <span>−{money(t.saleSavings)}</span>
          </div>
          <div className="summary-row">
            <span>Coupon savings</span>
            <span>−{money(t.discounts.reduce((s, d) => s + d.amount, 0))}</span>
          </div>
          <div className="summary-row">
            <span>After coupons</span>
            <strong>{money(t.afterCoupons)}</strong>
          </div>
          <div className="summary-row">
            <span>
              {beginner ? "STEP 3 · Use ExtraBucks" : "ExtraBucks used"}
            </span>
            <span>−{money(t.extraBucksUsed)}</span>
          </div>
          <div className="summary-row">
            <span>Estimated tax</span>
            <span>{money(t.tax)}</span>
          </div>
          <div className="summary-total">
            <span>{beginner ? "STEP 4 · Cash / card" : "Estimated OOP"}</span>
            <strong>{money(t.oop)}</strong>
          </div>
          <div className="reward-strip">
            <span>{beginner ? "STEP 5 · Receive" : "ExtraBucks earned"}</span>
            <strong>{money(t.extraBucksEarned)}</strong>
          </div>
          <p className="text-xs muted mt-2">
            Reward balance afterward:{" "}
            <strong>{money(t.endingExtraBucks)}</strong>
          </p>
        </div>
      </div>
      {t.warnings.length > 0 && (
        <div className="transaction-warnings">
          {t.warnings.map((w) => (
            <p key={w}>
              <TriangleAlert size={13} />
              {w}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
