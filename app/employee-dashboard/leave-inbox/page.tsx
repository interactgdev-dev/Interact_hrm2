import { redirect } from "next/navigation";

/** Legacy Leaves inbox → unified 3-tab Leaves (Requests first). */
export default function EmployeeLeaveInboxPage() {
  redirect("/employee-dashboard/manage-leaves?tab=requests");
}
