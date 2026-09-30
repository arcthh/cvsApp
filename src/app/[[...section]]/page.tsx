import { notFound } from "next/navigation";
import CouponApp from "@/components/app";
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  if (
    section.length > 1 ||
    (section[0] &&
      !["planner", "coupons", "wallet", "compare", "history"].includes(
        section[0],
      ))
  )
    notFound();
  return <CouponApp />;
}
