"use client";

import SummariesPage from "../../summaries/page";

/** Distinct route module so Next never remaps to /summaries. */
export default function EmployeeSummariesPage() {
  return <SummariesPage />;
}
