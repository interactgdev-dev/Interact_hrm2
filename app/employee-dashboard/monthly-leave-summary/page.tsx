import { redirect } from "next/navigation";

/** Leave Summary menu removed — Summary lives inside Leaves tabs. */
export default function MonthlyLeaveSummaryRedirect() {
  redirect("/employee-dashboard/manage-leaves?tab=requests");
}
