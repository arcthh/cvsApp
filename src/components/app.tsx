"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  History,
  LayoutDashboard,
  MapPin,
  Plus,
  Settings2,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  Wallet,
  GitCompareArrows,
  LoaderCircle,
  Info,
} from "lucide-react";
import {
  type AppState,
  type Trip,
  type Product,
  type Coupon,
  type DealGroup,
  type ExtraBuck,
  type OptimizationMode,
  type OptimizationResult,
  stateSchema,
} from "@/lib/models";
import { blankTrip, initialState } from "@/lib/seed";
import { localRepository, STORAGE_KEY } from "@/services/storage";
import {
  calculateTrip,
  calculateProductSubtotal,
  validateAssignments,
} from "@/services/calculations";
import {
  money,
  uid,
  today,
  inputMoney,
  toCents,
  dateAfterDays,
} from "@/lib/money";
import {
  ProductForm,
  CouponForm,
  DealGroupForm,
  WalletForm,
  TripForm,
} from "./forms";
import {
  Metric,
  Empty,
  DealGroupCard,
  TripSummary,
  TransactionCard,
  CouponBadge,
} from "./ui";

const sections = [
  { path: "/", name: "Overview", icon: LayoutDashboard },
  { path: "/planner", name: "Trip planner", icon: ShoppingBag },
  { path: "/coupons", name: "My coupons", icon: Ticket },
  { path: "/wallet", name: "ExtraBucks wallet", icon: Wallet },
  { path: "/compare", name: "Compare scenarios", icon: GitCompareArrows },
  { path: "/history", name: "Trip history", icon: History },
];
const modes: { value: OptimizationMode; label: string }[] = [
  { value: "lowest-total", label: "Lowest total cash" },
  { value: "lowest-individual", label: "Lowest single payment" },
  { value: "max-rewards", label: "Most rewards earned" },
  { value: "min-leftover", label: "Fewest leftover rewards" },
  { value: "balanced", label: "Balanced" },
];
type Editor =
  | { kind: "product"; value?: Product }
  | { kind: "coupon"; value?: Coupon; inventory?: boolean }
  | { kind: "group"; value?: DealGroup }
  | { kind: "wallet"; value?: ExtraBuck }
  | { kind: "trip" };
const available = (r: ExtraBuck, date = today()) =>
  r.status !== "expired" &&
  r.status !== "planned" &&
  r.status !== "used" &&
  (!r.expirationDate || r.expirationDate >= date)
    ? Math.max(0, r.amount - r.usedAmount)
    : 0;
const couponAvailable = (c: Coupon, date = today()) =>
  !c.used && (!c.expirationDate || c.expirationDate >= date);

export default function CouponApp() {
  const router = useRouter(),
    pathname = usePathname();
  const [state, setState] = useState<AppState | null>(null),
    [selected, setSelected] = useState(""),
    [notice, setNotice] = useState(""),
    [editor, setEditor] = useState<Editor | null>(null);
  const [plannerTab, setPlannerTab] = useState("transactions"),
    [mode, setMode] = useState<OptimizationMode>("lowest-total"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<OptimizationResult | null>(null);
  const [filter, setFilter] = useState("All"),
    [query, setQuery] = useState(""),
    [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [nameEditor, setNameEditor] = useState<{
    tripId: string;
    draft: string;
  } | null>(null);
  const worker = useRef<Worker | null>(null),
    importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const loaded = localRepository.load();
        setState(loaded);
        const renameId = sessionStorage.getItem("cvsapp:rename");
        if (renameId && loaded.trips.some((t) => t.id === renameId)) {
          setNameEditor({ tripId: renameId, draft: "" });
          sessionStorage.removeItem("cvsapp:rename");
        }
        setSelected(
          localStorage.getItem("cvsapp:active") || loaded.trips[0]?.id || "",
        );
      } catch {
        setState(initialState());
        setNotice(
          "Saved data could not be read. An empty workspace is displayed; the original data is untouched until you save. Export the original backup before making changes.",
        );
      }
    });
    return () => worker.current?.terminate();
  }, []);
  const trip = state?.trips.find((t) => t.id === selected) ?? state?.trips[0];
  const calculation = useMemo(
    () => (trip ? calculateTrip(trip) : null),
    [trip],
  );
  function commit(next: AppState) {
    try {
      localRepository.save(next);
      worker.current?.terminate();
      setBusy(false);
      setState(next);
      setResult(null);
    } catch (e) {
      setNotice(
        `Could not save: ${e instanceof Error ? e.message : "storage unavailable"}. Export a backup to keep your work.`,
      );
    }
  }
  function selectTrip(id: string) {
    worker.current?.terminate();
    setBusy(false);
    setSelected(id);
    try {
      localStorage.setItem("cvsapp:active", id);
    } catch {}
    setResult(null);
  }
  function updateTrip(next: Trip) {
    if (!state) return;
    commit({
      ...state,
      trips: state.trips.map((t) => (t.id === next.id ? next : t)),
    });
  }
  function addTrip() {
    if (!state) return;
    const next = blankTrip();
    commit({ ...state, trips: [next, ...state.trips] });
    selectTrip(next.id);
    router.push("/planner");
    setPlannerTab("products");
    setEditor({ kind: "trip" });
  }
  function duplicateTrip() {
    if (!state || !trip) return;
    const next = {
      ...structuredClone(trip),
      id: uid(),
      name: "Untitled scenario",
      status: "planned" as const,
      completedSummary: undefined,
      scenarioOf: trip.scenarioOf ?? trip.id,
      createdAt: new Date().toISOString(),
    };
    commit({ ...state, trips: [next, ...state.trips] });
    selectTrip(next.id);
    setNameEditor({ tripId: next.id, draft: "" });
    try {
      sessionStorage.setItem("cvsapp:rename", next.id);
    } catch {}
    router.push("/planner");
    setNotice(
      "Scenario created. Change products or coupons, optimize it, then compare the results.",
    );
  }
  function optimize() {
    if (!trip || busy) return;
    setBusy(true);
    worker.current?.terminate();
    const snapshot = trip.id;
    const w = new Worker(
      new URL("../services/optimizer.worker.ts", import.meta.url),
    );
    worker.current = w;
    w.onmessage = (event) => {
      setBusy(false);
      if (event.data.error) setNotice(event.data.error);
      else if (snapshot === trip.id) setResult(event.data.result);
      w.terminate();
    };
    w.onerror = () => {
      setBusy(false);
      setNotice(
        "The optimizer could not run. Your manual plan is still saved.",
      );
      w.terminate();
    };
    w.postMessage({ trip, mode });
  }
  function moveTransaction(index: number, delta: number) {
    if (!trip) return;
    const txs = [...trip.transactions];
    [txs[index], txs[index + delta]] = [txs[index + delta], txs[index]];
    updateTrip({ ...trip, transactions: txs });
  }
  function assignProduct(id: string, target: string) {
    if (!trip) return;
    let txs = trip.transactions.map((t) => ({
      ...t,
      productIds: t.productIds.filter((p) => p !== id),
    }));
    if (target === "new") {
      txs.push({
        id: uid(),
        name: trip.products.find((p) => p.id === id)!.name,
        productIds: [id],
        extraBucksLimit: null,
      });
    } else
      txs = txs.map((t) =>
        t.id === target ? { ...t, productIds: [...t.productIds, id] } : t,
      );
    txs = txs.filter((t) => t.productIds.length);
    const next = { ...trip, transactions: txs };
    const errors = validateAssignments(next, txs);
    if (errors.length) {
      setNotice(errors.join(" "));
      return;
    }
    updateTrip(next);
  }
  function saveProduct(p: Product) {
    if (!trip) return;
    const exists = trip.products.some((item) => item.id === p.id);
    updateTrip({
      ...trip,
      products: exists
        ? trip.products.map((item) => (item.id === p.id ? p : item))
        : [...trip.products, p],
      transactions: exists
        ? trip.transactions
        : [
            ...trip.transactions,
            {
              id: uid(),
              name: p.name,
              productIds: [p.id],
              extraBucksLimit: null,
            },
          ],
    });
    setEditor(null);
  }
  function removeProduct(id: string) {
    if (!trip) return;
    if (trip.groups.some((g) => g.productIds.includes(id))) {
      setNotice("Remove this product from its deal groups before deleting it.");
      return;
    }
    updateTrip({
      ...trip,
      products: trip.products.filter((p) => p.id !== id),
      coupons: trip.coupons
        .filter((c) => !(c.productIds.length === 1 && c.productIds[0] === id))
        .map((c) => ({
          ...c,
          productIds: c.productIds.filter((p) => p !== id),
        })),
      transactions: trip.transactions
        .map((t) => ({
          ...t,
          productIds: t.productIds.filter((p) => p !== id),
        }))
        .filter((t) => t.productIds.length),
    });
  }
  function saveCoupon(c: Coupon, inventory = false) {
    if (!state) return;
    if (inventory) {
      const exists = state.coupons.some((x) => x.id === c.id);
      commit({
        ...state,
        coupons: exists
          ? state.coupons.map((x) => (x.id === c.id ? c : x))
          : [...state.coupons, c],
      });
    } else if (trip) {
      updateTrip({
        ...trip,
        coupons: trip.coupons.some((x) => x.id === c.id)
          ? trip.coupons.map((x) => (x.id === c.id ? c : x))
          : [...trip.coupons, c],
      });
    }
    setEditor(null);
  }
  function saveGroup(g: DealGroup) {
    if (!trip) return;
    let txs = trip.transactions;
    const mergedIds = new Set(g.productIds);
    if (g.mustStayTogether) {
      // Include whole overlapping transactions to avoid splitting another locked group.
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of txs)
          if (t.productIds.some((id) => mergedIds.has(id)))
            for (const id of t.productIds)
              if (!mergedIds.has(id)) {
                mergedIds.add(id);
                changed = true;
              }
      }
      txs = [
        ...txs.filter((t) => !t.productIds.some((id) => mergedIds.has(id))),
        {
          id: uid(),
          name: g.name,
          productIds: [...mergedIds],
          extraBucksLimit: null,
        },
      ];
    }
    updateTrip({
      ...trip,
      groups: trip.groups.some((x) => x.id === g.id)
        ? trip.groups.map((x) => (x.id === g.id ? g : x))
        : [...trip.groups, g],
      transactions: txs,
    });
    setEditor(null);
  }
  function saveReward(r: ExtraBuck) {
    if (!state) return;
    commit({
      ...state,
      wallet: state.wallet.some((x) => x.id === r.id)
        ? state.wallet.map((x) => (x.id === r.id ? r : x))
        : [...state.wallet, r],
    });
    setEditor(null);
  }
  function attachWallet() {
    if (!trip || !state) return;
    const rewards = state.wallet.filter((r) => available(r, trip.date) > 0);
    updateTrip({
      ...trip,
      walletIds: rewards.map((r) => r.id),
      startingExtraBucks: rewards.reduce(
        (s, r) => s + available(r, trip.date),
        0,
      ),
    });
    setNotice(
      "Starting rewards updated from the wallet for this shopping date. Refresh this before shopping if another trip uses rewards.",
    );
  }
  function completeTrip() {
    if (!state || !trip || !calculation) return;
    if (calculation.errors.length || calculation.warnings.length) {
      setNotice("Resolve calculation warnings before recording this trip.");
      return;
    }
    const original = trip.walletIds.length
      ? state.wallet.filter(
          (r) => trip.walletIds.includes(r.id) && available(r, trip.date) > 0,
        )
      : [
          {
            id: uid(),
            amount: trip.startingExtraBucks,
            usedAmount: 0,
            sourceTransaction: `Starting rewards · ${trip.name}`,
            earnedDate: trip.date,
            expirationDate: "",
            status: "available" as const,
          },
        ];
    if (
      original.reduce((s, r) => s + available(r, trip.date), 0) !==
      trip.startingExtraBucks
    ) {
      setNotice(
        "Wallet balance changed. Refresh the starting wallet balance and recalculate before recording.",
      );
      return;
    }
    const ledger = structuredClone(original).sort((a, b) =>
      (a.expirationDate || "9999").localeCompare(b.expirationDate || "9999"),
    );
    for (const t of calculation.transactions) {
      let left = t.extraBucksUsed;
      for (const r of ledger) {
        const use = Math.min(left, r.amount - r.usedAmount);
        r.usedAmount += use;
        left -= use;
        r.status =
          r.usedAmount === r.amount
            ? "used"
            : r.usedAmount
              ? "partially-used"
              : "available";
      }
      if (t.extraBucksEarned)
        ledger.push({
          id: uid(),
          amount: t.extraBucksEarned,
          usedAmount: 0,
          sourceTransaction: `${trip.name} · ${t.name}`,
          earnedDate: trip.date,
          expirationDate: "",
          status: "available",
        });
    }
    const usage = new Map<string, number>();
    for (const tx of calculation.transactions)
      for (const id of tx.appliedCouponIds)
        usage.set(id, (usage.get(id) ?? 0) + 1);
    const coupons = state.coupons.map((c) => {
      const used = usage.get(c.id) ?? 0;
      return used
        ? {
            ...c,
            quantity: Math.max(1, c.quantity - used),
            used: used >= c.quantity,
          }
        : c;
    });
    const summary = {
      retail: calculation.retail,
      discounts: calculation.discounts + calculation.saleSavings,
      used: calculation.extraBucksUsed,
      cash: calculation.oop,
      earned: calculation.extraBucksEarned,
      ending: calculation.endingExtraBucks,
    };
    commit({
      ...state,
      coupons,
      wallet: [
        ...state.wallet.filter((r) => !trip.walletIds.includes(r.id)),
        ...ledger.filter((r) => r.amount > 0),
      ],
      trips: state.trips.map((t) =>
        t.id === trip.id
          ? { ...t, status: "completed", completedSummary: summary }
          : t,
      ),
    });
    setNotice(
      "Trip recorded from the displayed estimates. Wallet usage is saved. Add expiration dates to newly earned rewards using your receipt.",
    );
    router.push("/history");
  }
  function exportData(raw = false) {
    const data = raw
      ? localStorage.getItem(STORAGE_KEY)
      : JSON.stringify(state, null, 2);
    const url = URL.createObjectURL(
      new Blob([data ?? "{}"], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `cvsapp-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importData(file?: File) {
    if (!file) return;
    try {
      const parsed = stateSchema.parse(JSON.parse(await file.text()));
      commit(parsed);
      selectTrip(parsed.trips[0]?.id ?? "");
      setNotice("Backup imported successfully.");
    } catch {
      setNotice(
        "This backup is invalid or from an unsupported version. Your current data was kept.",
      );
    }
    if (importRef.current) importRef.current.value = "";
  }
  if (!state)
    return (
      <main className="loading">
        <LoaderCircle className="animate-spin" />
        <p>Opening your planner…</p>
      </main>
    );
  const walletBalance = state.wallet.reduce((s, r) => s + available(r), 0);
  const pageTitle =
    sections.find((s) => s.path === pathname)?.name ?? "Overview";
  const editable = trip?.status !== "completed";
  const upcoming = state.trips.filter((t) => t.status === "planned");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <ShoppingBag size={22} />
          </span>
          <span>
            penny<span className="red-text">plan</span>
            <small>YOUR CVS COUPON COMPANION</small>
          </span>
        </Link>
        <p className="sidebar-label">MY WORKSPACE</p>
        <nav aria-label="Main navigation">
          {sections.map((s) => (
            <Link
              key={s.path}
              href={s.path}
              className={pathname === s.path ? "nav-link active" : "nav-link"}
            >
              <s.icon size={19} />
              {s.name}
              {s.path === "/coupons" && state.coupons.length > 0 && (
                <span>{state.coupons.length}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="wallet-mini">
            <div className="flex justify-between">
              <Wallet size={18} />
              <span>AVAILABLE REWARDS</span>
            </div>
            <strong>{money(walletBalance)}</strong>
            <Link href="/wallet">
              Open your wallet <ArrowRight size={14} />
            </Link>
          </div>
          <p>
            Plan a little.
            <br />
            Save a lot.
          </p>
          <div className="backup-actions">
            <button onClick={() => exportData()}>Export data</button>
            <button onClick={() => importRef.current?.click()}>
              Import backup
            </button>
          </div>
          <p className="privacy">Saved on this device. No account needed.</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            My workspace <span>/</span> <strong>{pageTitle}</strong>
          </span>
          <button
            className={`beginner-toggle ${state.beginner ? "enabled" : ""}`}
            onClick={() => commit({ ...state, beginner: !state.beginner })}
          >
            <span className="toggle-track">
              <i />
            </span>
            Beginner mode
          </button>
          <span className="avatar">AD</span>
        </header>
        <main className="main-content">
          {notice && (
            <div className="notice" role="status">
              <Info size={17} />
              <span>{notice}</span>
              {notice.includes("original") && (
                <button
                  onClick={() => exportData(true)}
                  className="text-button"
                >
                  Export original
                </button>
              )}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}
          {pathname === "/" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">SMALL PLANS. BIG SAVINGS.</p>
                  <h1>A smarter CVS run.</h1>
                  <p>
                    Your coupons, rewards, and next shopping trip. All in one
                    place.
                  </p>
                </div>
                <button className="button primary" onClick={() => addTrip()}>
                  <Plus size={17} />
                  Create new trip
                </button>
              </div>
              <div className="dashboard-banner">
                <div>
                  <span className="badge">MAKE EVERY REWARD COUNT</span>
                  <h2>
                    Turn your ExtraBucks
                    <br />
                    into your next great deal.
                  </h2>
                  <p>
                    Build your shopping list. Keep deal groups together.
                    <br />
                    Find a transaction order that stretches your rewards.
                  </p>
                  <button
                    onClick={() => {
                      if (trip) router.push("/planner");
                      else addTrip();
                    }}
                  >
                    Plan my next trip <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="floating-ticket">
                    <span>YOUR REWARDS</span>
                    <strong>{money(trip?.startingExtraBucks ?? 0)}</strong>
                    <p>Ready for your next trip</p>
                    <div className="ticket-dots" />
                  </div>
                  <div className="floating-savings">
                    <CheckCircle2 size={19} />
                    <span>
                      One step closer
                      <br />
                      <strong>to spending less.</strong>
                    </span>
                  </div>
                  <Sparkles className="sparkle" size={40} />
                </div>
              </div>
              <div className="section-heading">
                <h2>Your savings snapshot</h2>
                <span className="muted text-xs">
                  {trip?.name ?? "No trip selected"} · estimates
                </span>
              </div>
              <div className="metrics-grid">
                <Metric
                  label="Estimated cash / card"
                  value={money(calculation?.oop ?? 0)}
                  detail={`${calculation?.transactions.length ?? 0} planned transactions`}
                  tone="featured"
                />
                <Metric
                  label="Rewards to earn"
                  value={money(calculation?.extraBucksEarned ?? 0)}
                  detail="Use on a later transaction"
                  tone="green"
                />
                <Metric
                  label="Coupon & sale savings"
                  value={money(
                    (calculation?.discounts ?? 0) +
                      (calculation?.saleSavings ?? 0),
                  )}
                  detail={`${trip?.coupons.filter((c) => couponAvailable(c, trip.date)).length ?? 0} available trip coupons`}
                />
                <Metric
                  label="Retail value"
                  value={money(calculation?.retail ?? 0)}
                  detail={`${trip?.groups.length ?? 0} protected deal groups`}
                />
              </div>
              <div className="dashboard-columns">
                <section>
                  <div className="section-heading">
                    <h2>Your shopping trips</h2>
                    <button className="text-button" onClick={() => addTrip()}>
                      Create a trip
                    </button>
                  </div>
                  {state.trips.length ? (
                    state.trips.map((t) => {
                      const c = calculateTrip(t);
                      return (
                        <button
                          className="trip-list-card"
                          key={t.id}
                          onClick={() => {
                            selectTrip(t.id);
                            router.push("/planner");
                          }}
                        >
                          <span className="trip-icon">
                            <ShoppingBag size={20} />
                          </span>
                          <span className="trip-list-info">
                            <strong>{t.name}</strong>
                            <small>
                              {t.store} · {t.date} · {t.products.length} product
                              lines
                            </small>
                          </span>
                          <span className="trip-list-cost">
                            <strong>
                              {money(t.completedSummary?.cash ?? c.oop)}
                            </strong>
                            <small>
                              {t.status === "completed"
                                ? "Recorded"
                                : "Estimated cash"}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      );
                    })
                  ) : (
                    <Empty
                      title="Your next trip starts here"
                      description="Add products and coupons to see your savings."
                    />
                  )}
                </section>
                <section className="tips-card">
                  <div className="tip-icon">
                    <Sparkles size={21} />
                  </div>
                  <h3>New to rolling rewards?</h3>
                  <p>
                    ExtraBucks are CVS rewards you earn after a qualifying
                    purchase. Use them in the <strong>next transaction</strong>{" "}
                    to lower what you pay.
                  </p>
                  <div className="tip-row">
                    <span>01</span>
                    <p>Keep spend-deal items together.</p>
                  </div>
                  <div className="tip-row">
                    <span>02</span>
                    <p>Check coupon dates and terms.</p>
                  </div>
                  <div className="tip-row">
                    <span>03</span>
                    <p>Optimize, then shop in order.</p>
                  </div>
                  <p className="text-xs muted">
                    Verify prices, coupons, rewards, and estimated taxes before
                    shopping.
                  </p>
                </section>
              </div>
            </>
          )}
          {pathname === "/planner" && (
            <>
              {!trip ? (
                <Empty
                  title="Create your first trip"
                  description="Add a list, coupons, and deal groups."
                >
                  <button className="button primary" onClick={() => addTrip()}>
                    Create trip
                  </button>
                </Empty>
              ) : (
                <>
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">YOUR NEXT SMART SHOPPING RUN</p>
                      <h1 className="editable-heading">
                        {nameEditor?.tripId === trip.id ? (
                          <input
                            className="inline-name-input"
                            aria-label="Trip or scenario name"
                            placeholder="Name this scenario"
                            value={nameEditor.draft}
                            autoFocus
                            onChange={(e) =>
                              setNameEditor({
                                tripId: trip.id,
                                draft: e.target.value,
                              })
                            }
                            onBlur={() => {
                              const name = nameEditor.draft.trim();
                              if (name) updateTrip({ ...trip, name });
                              setNameEditor(null);
                              try {
                                sessionStorage.removeItem("cvsapp:rename");
                              } catch {}
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                              if (e.key === "Escape") {
                                setNameEditor(null);
                                try {
                                  sessionStorage.removeItem("cvsapp:rename");
                                } catch {}
                              }
                            }}
                          />
                        ) : (
                          <button
                            className="inline-name-button"
                            aria-label={`Rename ${trip.name}`}
                            title="Click to rename"
                            onClick={() =>
                              setNameEditor({
                                tripId: trip.id,
                                draft: trip.name,
                              })
                            }
                          >
                            {trip.name}
                          </button>
                        )}
                      </h1>
                      <p className="flex items-center gap-2">
                        <MapPin size={14} />
                        {trip.store}
                        {trip.location ? ` · ${trip.location}` : ""} ·{" "}
                        {trip.date}{" "}
                        {trip.status === "completed" && (
                          <span className="badge green">Recorded</span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="button secondary"
                        onClick={duplicateTrip}
                      >
                        <Copy size={15} />
                        Create scenario
                      </button>
                      {editable && (
                        <button
                          className="button secondary"
                          onClick={() => setEditor({ kind: "trip" })}
                        >
                          <Settings2 size={15} />
                          Settings
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="planner-toolbar">
                    <label className="trip-select">
                      <span>ACTIVE TRIP</span>
                      <select
                        value={trip.id}
                        onChange={(e) => selectTrip(e.target.value)}
                      >
                        {state.trips.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex gap-2 items-center flex-wrap">
                      <select
                        aria-label="Optimization preference"
                        value={mode}
                        onChange={(e) => {
                          setMode(e.target.value as OptimizationMode);
                          setResult(null);
                        }}
                      >
                        {modes.map((m) => (
                          <option value={m.value} key={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {editable && (
                        <button
                          className="button primary"
                          onClick={optimize}
                          disabled={busy || !trip.products.length}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <Sparkles size={16} />
                          )}{" "}
                          {busy ? "Finding your plan…" : "Optimize trip"}
                        </button>
                      )}
                    </div>
                  </div>
                  {state.beginner && (
                    <div className="beginner-note">
                      <Info size={18} />
                      <p>
                        <strong>A quick guide:</strong> OOP means the cash/card
                        you pay. A threshold is the minimum qualifying spend for
                        a coupon or deal. Rewards earned in one transaction can
                        be used in the next.
                      </p>
                    </div>
                  )}
                  {result && (
                    <section className="optimization-result">
                      <div className="flex justify-between flex-wrap gap-3">
                        <div>
                          <p className="eyebrow">YOUR RECOMMENDED PLAN</p>
                          <h3>
                            {money(result.calculation.oop)} cash ·{" "}
                            {result.transactions.length} transactions
                          </h3>
                        </div>
                        <button
                          className="button primary"
                          onClick={() => {
                            updateTrip({
                              ...trip,
                              products: result.products,
                              transactions: result.transactions,
                            });
                            setNotice("Recommended order applied and saved.");
                          }}
                        >
                          Apply this plan <ArrowRight size={15} />
                        </button>
                      </div>
                      <div className="metrics-grid compact">
                        <Metric
                          label="Current plan cash"
                          value={money(calculation!.oop)}
                        />
                        <Metric
                          label="Recommended cash"
                          value={money(result.calculation.oop)}
                          tone="green"
                        />
                        <Metric
                          label="Final rewards"
                          value={money(result.calculation.endingExtraBucks)}
                        />
                      </div>
                      <ol className="recommended-order">
                        {result.calculation.transactions.map((t, i) => (
                          <li key={t.id}>
                            <span>
                              {i + 1}. {t.name}
                            </span>
                            <strong>
                              {money(t.oop)} cash · +{money(t.extraBucksEarned)}{" "}
                              EB · {money(t.endingExtraBucks)} left
                            </strong>
                          </li>
                        ))}
                      </ol>
                      {result.explanations.map((e) => (
                        <p key={e} className="text-xs muted mt-2">
                          {e}
                        </p>
                      ))}
                      <p className="text-xs muted mt-2">
                        {result.searched.toLocaleString()} candidate plans
                        scored. No products were substituted.
                      </p>
                    </section>
                  )}
                  <div className="planner-layout">
                    <div>
                      <div className="tabbar">
                        {[
                          ["transactions", "Transactions"],
                          ["products", "Products"],
                          ["coupons", "Coupons"],
                          ["deals", "Deal groups"],
                        ].map(([key, label]) => (
                          <button
                            className={plannerTab === key ? "selected" : ""}
                            key={key}
                            onClick={() => setPlannerTab(key)}
                          >
                            {label}
                            <span>
                              {key === "deals"
                                ? trip.groups.length
                                : key === "products"
                                  ? trip.products.length
                                  : key === "coupons"
                                    ? trip.coupons.length
                                    : trip.transactions.length}
                            </span>
                          </button>
                        ))}
                      </div>
                      {calculation!.errors.length > 0 && (
                        <div className="notice error">
                          {calculation!.errors.join(" ")}
                        </div>
                      )}
                      {plannerTab === "transactions" && (
                        <>
                          <div className="section-heading">
                            <h2>One transaction at a time.</h2>
                            <span className="muted text-xs">
                              Rewards roll from top to bottom
                            </span>
                          </div>
                          {calculation!.transactions.map((t, i) => (
                            <div key={t.id}>
                              {editable && (
                                <div className="transaction-controls">
                                  <label>
                                    Name{" "}
                                    <input
                                      aria-label={`Name for transaction ${i + 1}`}
                                      defaultValue={t.name}
                                      key={`${t.id}-${t.name}`}
                                      onBlur={(e) =>
                                        updateTrip({
                                          ...trip,
                                          transactions: trip.transactions.map(
                                            (tx) =>
                                              tx.id === t.id
                                                ? {
                                                    ...tx,
                                                    name:
                                                      e.target.value.trim() ||
                                                      `Transaction ${i + 1}`,
                                                  }
                                                : tx,
                                          ),
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    EB cap ($)
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      aria-label={`Reward use cap for transaction ${i + 1}`}
                                      placeholder="Auto"
                                      defaultValue={
                                        trip.transactions.find(
                                          (tx) => tx.id === t.id,
                                        )?.extraBucksLimit == null
                                          ? ""
                                          : inputMoney(
                                              trip.transactions.find(
                                                (tx) => tx.id === t.id,
                                              )!.extraBucksLimit!,
                                            )
                                      }
                                      onBlur={(e) => {
                                        try {
                                          const limit =
                                            e.target.value === ""
                                              ? null
                                              : toCents(e.target.value);
                                          updateTrip({
                                            ...trip,
                                            transactions: trip.transactions.map(
                                              (tx) =>
                                                tx.id === t.id
                                                  ? {
                                                      ...tx,
                                                      extraBucksLimit: limit,
                                                    }
                                                  : tx,
                                            ),
                                          });
                                        } catch {
                                          setNotice(
                                            "Use a nonnegative amount with at most two decimals.",
                                          );
                                        }
                                      }}
                                    />
                                  </label>
                                  <button
                                    className="icon-button"
                                    aria-label="Move up"
                                    disabled={i === 0}
                                    onClick={() => moveTransaction(i, -1)}
                                  >
                                    <ArrowUp size={15} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label="Move down"
                                    disabled={
                                      i === trip.transactions.length - 1
                                    }
                                    onClick={() => moveTransaction(i, 1)}
                                  >
                                    <ArrowDown size={15} />
                                  </button>
                                </div>
                              )}
                              <TransactionCard
                                transaction={t}
                                trip={trip}
                                beginner={state.beginner}
                                index={i}
                              />
                            </div>
                          ))}
                          {!trip.products.length && (
                            <Empty
                              title="Let’s build your shopping list"
                              description="Add your products first, then attach coupons and deal groups."
                            >
                              <button
                                className="button primary"
                                onClick={() => setEditor({ kind: "product" })}
                              >
                                <Plus size={16} />
                                Add product
                              </button>
                            </Empty>
                          )}
                          {editable && trip.products.length > 0 && (
                            <div className="finish-bar">
                              <p>
                                Ready to record this shopping run?
                                <small>
                                  This records the displayed estimates and
                                  updates your wallet.
                                </small>
                              </p>
                              <button
                                className="button secondary"
                                onClick={completeTrip}
                              >
                                <CheckCircle2 size={16} />
                                Record as completed
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      {plannerTab === "products" && (
                        <>
                          <div className="section-heading">
                            <h2>Your shopping list</h2>
                            {editable && (
                              <button
                                className="button secondary"
                                onClick={() => setEditor({ kind: "product" })}
                              >
                                <Plus size={16} />
                                Add product
                              </button>
                            )}
                          </div>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Qty</th>
                                  <th>Each</th>
                                  <th>Line total</th>
                                  <th>Transaction</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {trip.products.map((p) => {
                                  const tx = trip.transactions.find((t) =>
                                    t.productIds.includes(p.id),
                                  );
                                  const line = calculation!.transactions.find(
                                    (t) => t.productIds.includes(p.id),
                                  );
                                  const productCost = line?.productCosts.find(
                                    (item) => item.id === p.id,
                                  );
                                  return (
                                    <tr key={p.id}>
                                      <td>
                                        <strong>{p.name}</strong>
                                        <small>
                                          {p.brand} {p.size} · {p.category}
                                        </small>
                                        {p.notes && <small>{p.notes}</small>}
                                        <small>
                                          Gross:{" "}
                                          {money(p.unitPrice * p.quantity)}
                                          {productCost
                                            ? ` · Net after coupons: ${money(productCost.afterCoupons)} · Effective/unit: ${money(productCost.effectiveUnitCost)} · After EB: ${money(productCost.afterExtraBucks)}`
                                            : ""}
                                        </small>
                                      </td>
                                      <td>{p.quantity}</td>
                                      <td>
                                        {money(p.salePrice ?? p.unitPrice)}
                                        {p.salePrice !== null && (
                                          <small className="line-through">
                                            {money(p.unitPrice)}
                                          </small>
                                        )}
                                      </td>
                                      <td>
                                        {money(calculateProductSubtotal(p))}
                                      </td>
                                      <td>
                                        {editable ? (
                                          <select
                                            aria-label={`Transaction for ${p.name}`}
                                            value={tx?.id ?? ""}
                                            onChange={(e) =>
                                              assignProduct(
                                                p.id,
                                                e.target.value,
                                              )
                                            }
                                          >
                                            {trip.transactions.map((t) => (
                                              <option value={t.id} key={t.id}>
                                                {t.name}
                                              </option>
                                            ))}
                                            <option value="new">
                                              New transaction
                                            </option>
                                          </select>
                                        ) : (
                                          tx?.name
                                        )}
                                      </td>
                                      <td>
                                        {editable && (
                                          <div className="flex gap-2">
                                            <button
                                              className="text-button"
                                              onClick={() =>
                                                setEditor({
                                                  kind: "product",
                                                  value: p,
                                                })
                                              }
                                            >
                                              Edit
                                            </button>
                                            <button
                                              aria-label={`Delete ${p.name}`}
                                              className="icon-button"
                                              onClick={() =>
                                                removeProduct(p.id)
                                              }
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="muted text-xs mt-3">
                            Changing transaction assignment is blocked if it
                            splits a protected group. To safely split an
                            independent quantity, edit its quantity and add the
                            remainder as another product line; then recheck
                            coupons.
                          </p>
                        </>
                      )}
                      {plannerTab === "coupons" && (
                        <>
                          <div className="section-heading">
                            <h2>Trip coupons</h2>
                            {editable && (
                              <button
                                className="button secondary"
                                onClick={() => setEditor({ kind: "coupon" })}
                              >
                                <Plus size={16} />
                                Add coupon
                              </button>
                            )}
                          </div>
                          {editable && state.coupons.length > 0 && (
                            <label className="inventory-select">
                              Add from inventory{" "}
                              <select
                                value=""
                                onChange={(e) => {
                                  const c = state.coupons.find(
                                    (c) => c.id === e.target.value,
                                  );
                                  if (
                                    c &&
                                    !trip.coupons.some((x) => x.id === c.id)
                                  )
                                    updateTrip({
                                      ...trip,
                                      coupons: [...trip.coupons, c],
                                    });
                                }}
                              >
                                <option value="">Choose a saved coupon…</option>
                                {state.coupons
                                  .filter(
                                    (c) =>
                                      couponAvailable(c, trip.date) &&
                                      !trip.coupons.some((x) => x.id === c.id),
                                  )
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          )}
                          {trip.coupons.map((c) => (
                            <div className="coupon-card" key={c.id}>
                              <span className="coupon-icon">
                                <Ticket size={21} />
                              </span>
                              <div className="grow">
                                <h3>{c.name}</h3>
                                <p>
                                  {c.type.replaceAll("-", " ")} · {c.source} ·{" "}
                                  {c.expirationDate
                                    ? `Expires ${c.expirationDate}`
                                    : "No expiration entered"}
                                </p>
                                <div className="flex gap-2 flex-wrap mt-2">
                                  <CouponBadge>
                                    {c.minimumSpend
                                      ? `${money(c.minimumSpend)} minimum`
                                      : c.minimumQuantity
                                        ? `Buy ${c.minimumQuantity}`
                                        : "No minimum"}
                                  </CouponBadge>
                                  <span
                                    className={`badge ${couponAvailable(c, trip.date) ? "green" : "yellow"}`}
                                  >
                                    {couponAvailable(c, trip.date)
                                      ? `${c.quantity} available use(s)`
                                      : "Unavailable"}
                                  </span>
                                </div>
                              </div>
                              {editable && (
                                <div className="flex gap-2">
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setEditor({ kind: "coupon", value: c })
                                    }
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`Remove ${c.name}`}
                                    onClick={() => {
                                      if (
                                        trip.groups.some(
                                          (g) => g.requiredCouponId === c.id,
                                        )
                                      ) {
                                        setNotice(
                                          "Remove this required coupon from the deal group first.",
                                        );
                                        return;
                                      }
                                      updateTrip({
                                        ...trip,
                                        coupons: trip.coupons.filter(
                                          (x) => x.id !== c.id,
                                        ),
                                      });
                                    }}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          {!trip.coupons.length && (
                            <Empty
                              title="Put your coupons to work"
                              description="Add a coupon or select one from your inventory."
                            />
                          )}
                        </>
                      )}
                      {plannerTab === "deals" && (
                        <>
                          <div className="section-heading">
                            <h2>Keep the good deals together.</h2>
                            {editable && (
                              <button
                                className="button secondary"
                                disabled={!trip.products.length}
                                onClick={() => setEditor({ kind: "group" })}
                              >
                                <Plus size={16} />
                                Create group
                              </button>
                            )}
                          </div>
                          <p className="muted text-sm mb-4">
                            A green subtotal confirms the spend/quantity only.
                            Final coupon availability and after-coupon
                            thresholds are checked in each transaction.
                          </p>
                          <div className="deal-grid">
                            {trip.groups.map((g) => (
                              <DealGroupCard
                                key={g.id}
                                group={g}
                                products={trip.products}
                                onEdit={() =>
                                  editable &&
                                  setEditor({ kind: "group", value: g })
                                }
                                onDelete={() =>
                                  editable &&
                                  updateTrip({
                                    ...trip,
                                    groups: trip.groups.filter(
                                      (x) => x.id !== g.id,
                                    ),
                                  })
                                }
                              />
                            ))}
                          </div>
                          {!trip.groups.length && (
                            <Empty
                              title="Protect your spend deals"
                              description="Group the products that must qualify for a threshold together."
                            />
                          )}
                        </>
                      )}
                    </div>
                    <aside className="planner-summary">
                      <TripSummary
                        calculation={calculation!}
                        starting={trip.startingExtraBucks}
                      />
                      {editable && (
                        <button
                          className="button secondary full mt-3"
                          onClick={attachWallet}
                        >
                          <Wallet size={15} />
                          Use current wallet balance
                        </button>
                      )}
                      <div className="receipt-note">
                        <Info size={16} />
                        <p>
                          Totals are estimates. Tax basis, coupon stacking, sale
                          exclusions, and reward eligibility depend on your
                          offer terms. The model uses exact thresholds. Reward
                          balances allow partial use; adjust for any certificate
                          value forfeited at checkout.
                        </p>
                      </div>
                      {trip.notes && (
                        <div className="notes-card">
                          <h3>Trip notes</h3>
                          <p>{trip.notes}</p>
                        </div>
                      )}
                    </aside>
                  </div>
                </>
              )}
            </>
          )}
          {pathname === "/coupons" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">A GOOD DEAL STARTS HERE</p>
                  <h1>Your coupon collection.</h1>
                  <p>Keep the offers you want to use within easy reach.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setEditor({ kind: "coupon", inventory: true })}
                >
                  <Plus size={17} />
                  Add coupon
                </button>
              </div>
              <div className="filterbar">
                <input
                  aria-label="Search coupons"
                  placeholder="Search coupons or brands…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter coupons"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {[
                    "All",
                    "Expiring soon",
                    "Available",
                    "Used",
                    "Hair",
                    "Oral care",
                    "Laundry",
                    "Personal care",
                    "crt",
                    "manufacturer",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </div>
              {state.coupons
                .filter((c) => {
                  const soon = new Date(`${today()}T12:00:00`);
                  soon.setDate(soon.getDate() + 7);
                  const end = soon.toISOString().slice(0, 10);
                  return (
                    `${c.name} ${c.brand}`
                      .toLowerCase()
                      .includes(query.toLowerCase()) &&
                    (filter === "All" ||
                      (filter === "Available" && couponAvailable(c)) ||
                      (filter === "Used" && c.used) ||
                      (filter === "Expiring soon" &&
                        couponAvailable(c) &&
                        !!c.expirationDate &&
                        c.expirationDate <= end) ||
                      c.category === filter ||
                      c.type === filter)
                  );
                })
                .map((c) => (
                  <article className="coupon-card" key={c.id}>
                    <span className="coupon-icon">
                      <Ticket size={23} />
                    </span>
                    <div className="grow">
                      <h3>{c.name}</h3>
                      <p>
                        {c.brand || "Any brand"} ·{" "}
                        {c.category || "All categories"} ·{" "}
                        {c.expirationDate
                          ? `Expires ${c.expirationDate}`
                          : "No expiration entered"}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <CouponBadge>{c.type.replaceAll("-", " ")}</CouponBadge>
                        <span className="badge">
                          {c.quantity} use(s) ·{" "}
                          {c.used
                            ? "used"
                            : couponAvailable(c)
                              ? "available"
                              : "expired"}
                        </span>
                      </div>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        setEditor({ kind: "coupon", value: c, inventory: true })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Delete coupon"
                      onClick={() =>
                        commit({
                          ...state,
                          coupons: state.coupons.filter((x) => x.id !== c.id),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))}
              {!state.coupons.length && (
                <Empty
                  title="A little organization, a lot of savings"
                  description="Store your manufacturer coupons, CVS offers, and CRTs here. Add them to a trip when you’re ready."
                />
              )}
            </>
          )}
          {pathname === "/wallet" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">READY FOR YOUR NEXT RUN</p>
                  <h1>Rewards worth keeping.</h1>
                  <p>
                    Track what you have, what you used, and what’s expiring.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setEditor({ kind: "wallet" })}
                >
                  <Plus size={17} />
                  Add ExtraBucks
                </button>
              </div>
              <div className="metrics-grid">
                <Metric
                  label="Available ExtraBucks"
                  value={money(walletBalance)}
                  tone="green"
                />
                <Metric
                  label="Expiring within 7 days"
                  value={money(
                    state.wallet
                      .filter(
                        (r) =>
                          r.expirationDate &&
                          r.expirationDate <= dateAfterDays(7),
                      )
                      .reduce((s, r) => s + available(r), 0),
                  )}
                />
                <Metric
                  label="Selected trip planned use"
                  value={money(calculation?.extraBucksUsed ?? 0)}
                  detail={trip?.name}
                />
                <Metric
                  label="Selected trip ending rewards"
                  value={money(calculation?.endingExtraBucks ?? 0)}
                  detail="Includes rewards earned along the way"
                />
              </div>
              <p className="muted text-sm my-6">
                Wallet rewards are separate from manually entered trip starting
                balances. Use “Use current wallet balance” in the planner to
                link them. Planned rewards are unavailable until recorded.
              </p>
              <div className="wallet-grid">
                {state.wallet.map((r) => (
                  <article
                    className={`reward-card ${available(r) ? "" : "inactive"}`}
                    key={r.id}
                  >
                    <div className="flex justify-between">
                      <span className="eyebrow">EXTRABUCKS REWARDS</span>
                      <Wallet size={19} />
                    </div>
                    <strong className="reward-amount">
                      {money(r.amount - r.usedAmount)}
                    </strong>
                    <p>{r.sourceTransaction}</p>
                    <div className="reward-card-bottom">
                      <span>
                        {r.expirationDate
                          ? `Expires ${r.expirationDate}`
                          : "Add receipt expiration date"}
                      </span>
                      <span className="badge">
                        {r.status === "planned"
                          ? "planned"
                          : r.expirationDate && r.expirationDate < today()
                            ? "expired"
                            : r.usedAmount === r.amount
                              ? "used"
                              : r.usedAmount
                                ? "partially used"
                                : r.status}
                      </span>
                    </div>
                    <p className="text-xs mt-3">
                      Original {money(r.amount)} · Used {money(r.usedAmount)} ·
                      Earned {r.earnedDate || "unknown"}
                    </p>
                    <div className="flex gap-3 mt-4">
                      <button
                        className="text-button"
                        onClick={() => setEditor({ kind: "wallet", value: r })}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button muted"
                        onClick={() =>
                          commit({
                            ...state,
                            wallet: state.wallet.filter((x) => x.id !== r.id),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!state.wallet.length && (
                <Empty
                  title="Give your rewards a home"
                  description="Add the ExtraBucks you already have. "
                />
              )}
            </>
          )}
          {pathname === "/compare" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">SIDE BY SIDE. CENT BY CENT.</p>
                  <h1>Which trip works better?</h1>
                  <p>
                    Create a scenario in the planner, substitute products, and
                    compare the results.
                  </p>
                </div>
                {trip && (
                  <button className="button primary" onClick={duplicateTrip}>
                    <Copy size={16} />
                    Create scenario
                  </button>
                )}
              </div>
              <div className="compare-select">
                <label>
                  Scenario A
                  <select
                    value={scenarioIds[0] ?? upcoming[0]?.id ?? ""}
                    onChange={(e) =>
                      setScenarioIds([
                        e.target.value,
                        scenarioIds[1] ?? upcoming[1]?.id ?? "",
                      ])
                    }
                  >
                    <option value="">Select a trip</option>
                    {state.trips.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <GitCompareArrows size={25} />
                <label>
                  Scenario B
                  <select
                    value={scenarioIds[1] ?? upcoming[1]?.id ?? ""}
                    onChange={(e) =>
                      setScenarioIds([
                        scenarioIds[0] ?? upcoming[0]?.id ?? "",
                        e.target.value,
                      ])
                    }
                  >
                    <option value="">Select a trip</option>
                    {state.trips.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(() => {
                const a = state.trips.find(
                    (t) => t.id === (scenarioIds[0] ?? upcoming[0]?.id),
                  ),
                  b = state.trips.find(
                    (t) => t.id === (scenarioIds[1] ?? upcoming[1]?.id),
                  );
                if (!a || !b)
                  return (
                    <Empty
                      title="Two plans, one clear comparison"
                      description="Choose two trips above. Each scenario has its own products, coupons, and transaction order."
                    />
                  );
                const ac = calculateTrip(a),
                  bc = calculateTrip(b);
                const rows: [string, number, number][] = [
                  ["Retail subtotal", ac.retail, bc.retail],
                  [
                    "Coupon & sale savings",
                    ac.discounts + ac.saleSavings,
                    bc.discounts + bc.saleSavings,
                  ],
                  ["Cash / card OOP", ac.oop, bc.oop],
                  [
                    "ExtraBucks earned",
                    ac.extraBucksEarned,
                    bc.extraBucksEarned,
                  ],
                  [
                    "Final ExtraBucks",
                    ac.endingExtraBucks,
                    bc.endingExtraBucks,
                  ],
                  ["Effective net cost", ac.netCost, bc.netCost],
                ];
                return (
                  <>
                    <div className="comparison-callout">
                      <BarChart3 size={24} />
                      <div>
                        <h3>
                          {ac.oop === bc.oop
                            ? "Both scenarios have the same cash cost."
                            : `${ac.oop < bc.oop ? "Scenario A" : "Scenario B"} costs ${money(Math.abs(ac.oop - bc.oop))} less cash overall.`}
                        </h3>
                        <p>
                          Starting rewards: A {money(a.startingExtraBucks)} · B{" "}
                          {money(b.startingExtraBucks)}. Compare net cost too
                          when balances differ.
                        </p>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>What you’re comparing</th>
                            <th>
                              Scenario A<br />
                              {a.name}
                            </th>
                            <th>
                              Scenario B<br />
                              {b.name}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(([label, av, bv]) => (
                            <tr key={label}>
                              <td>{label}</td>
                              <td>{money(av)}</td>
                              <td>{money(bv)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="deal-grid mt-5">
                      {[a, b].map((t) => (
                        <div className="notes-card" key={t.id}>
                          <h3>{t.name}</h3>
                          {t.products.map((p) => (
                            <p key={p.id}>
                              {p.name} ×{p.quantity} —{" "}
                              {money(calculateProductSubtotal(p))}
                            </p>
                          ))}
                          <button
                            className="text-button mt-3"
                            onClick={() => {
                              selectTrip(t.id);
                              router.push("/planner");
                            }}
                          >
                            View calculations <ArrowRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </>
          )}
          {pathname === "/history" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">EVERY SAVING ADDS UP</p>
                  <h1>Your shopping story.</h1>
                  <p>
                    Recorded trips and lifetime totals, based on the plans you
                    completed.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => exportData()}
                >
                  <Download size={16} />
                  Export backup
                </button>
              </div>
              {(() => {
                const trips = state.trips.filter(
                  (t) => t.status === "completed" && t.completedSummary,
                );
                const sum = (
                  key: "retail" | "discounts" | "used" | "cash" | "earned",
                ) => trips.reduce((s, t) => s + t.completedSummary![key], 0);
                const retail = sum("retail"),
                  cash = sum("cash");
                const avg = trips.length
                  ? trips.reduce(
                      (s, t) =>
                        s +
                        (t.completedSummary!.retail
                          ? ((t.completedSummary!.retail -
                              t.completedSummary!.cash) /
                              t.completedSummary!.retail) *
                            100
                          : 0),
                      0,
                    ) / trips.length
                  : 0;
                return (
                  <>
                    <div className="metrics-grid">
                      <Metric
                        label="Lifetime cash / card"
                        value={money(cash)}
                        tone="featured"
                      />
                      <Metric
                        label="Retail value purchased"
                        value={money(retail)}
                      />
                      <Metric
                        label="Coupon & sale savings"
                        value={money(sum("discounts"))}
                      />
                      <Metric
                        label="Rewards earned"
                        value={money(sum("earned"))}
                        tone="green"
                      />
                      <Metric
                        label="Average trip savings"
                        value={`${avg.toFixed(1)}%`}
                        detail="Includes the effect of rewards spent"
                      />
                    </div>
                    {trips.length ? (
                      <div className="table-wrap mt-6">
                        <table>
                          <thead>
                            <tr>
                              <th>Trip</th>
                              <th>Retail</th>
                              <th>Discounts</th>
                              <th>EB used</th>
                              <th>Cash</th>
                              <th>EB earned</th>
                              <th>Net cost</th>
                              <th>Savings</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trips.map((t) => {
                              const s = t.completedSummary!;
                              return (
                                <tr key={t.id}>
                                  <td>
                                    <button
                                      className="text-button"
                                      onClick={() => {
                                        selectTrip(t.id);
                                        router.push("/planner");
                                      }}
                                    >
                                      {t.name}
                                    </button>
                                    <small>{t.date}</small>
                                  </td>
                                  <td>{money(s.retail)}</td>
                                  <td>{money(s.discounts)}</td>
                                  <td>{money(s.used)}</td>
                                  <td>{money(s.cash)}</td>
                                  <td>{money(s.earned)}</td>
                                  <td>{money(s.cash + s.used - s.earned)}</td>
                                  <td>
                                    {s.retail
                                      ? (
                                          ((s.retail - s.cash) / s.retail) *
                                          100
                                        ).toFixed(1)
                                      : "0"}
                                    %
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Your first savings story is waiting"
                        description="Record a trip as completed in the planner to start tracking lifetime totals."
                      />
                    )}
                    <p className="text-xs muted mt-4">
                      Savings % = (retail value − cash paid) / retail value.
                      Recorded amounts are estimates from your plan, not
                      imported receipt data.
                    </p>
                  </>
                );
              })()}
            </>
          )}
          <footer className="page-footer">
            <span>pennyplan · independent CVS shopping planner</span>
            <span>Keep a backup. Your plans live in this browser.</span>
            <button
              onClick={() => importRef.current?.click()}
              aria-label="Import backup"
            >
              <Upload size={14} />
            </button>
          </footer>
        </main>
      </div>
      <input
        className="hidden"
        ref={importRef}
        type="file"
        accept="application/json"
        onChange={(e) => void importData(e.target.files?.[0])}
      />
      {editor?.kind === "product" && (
        <ProductForm
          product={editor.value}
          onSave={saveProduct}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === "coupon" && (
        <CouponForm
          coupon={editor.value}
          products={editor.inventory ? undefined : trip?.products}
          onSave={(c) => saveCoupon(c, editor.inventory)}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === "group" && trip && (
        <DealGroupForm
          group={editor.value}
          trip={trip}
          onSave={saveGroup}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === "wallet" && (
        <WalletForm
          reward={editor.value}
          onSave={saveReward}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === "trip" && trip && (
        <TripForm
          trip={trip}
          onSave={(t) => {
            updateTrip({
              ...t,
              walletIds:
                t.startingExtraBucks !== trip.startingExtraBucks
                  ? []
                  : t.walletIds,
            });
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
