import { redirect } from "next/navigation";

/** Leave Summary menu removed — Summary lives inside Leaves tabs. */
export default function AdminMonthlyLeaveSummaryRedirect() {
  redirect("/admin/manage-leaves?tab=requests");
}
