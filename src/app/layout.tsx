import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Pennyplan — CVS Coupon & Trip Planner",
  description:
    "Track coupons, protect spend deals, and roll ExtraBucks with a transparent CVS trip optimizer.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
