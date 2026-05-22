# HRM Team Lead Feature Workflow

This document describes the workflow for the Team Lead feature in your HRM system, including all features decided so far.

---

## Features for Team Lead (Decided)
- Team Lead will have a dashboard similar to Employee Dashboard.
- Team Lead dashboard will have a dedicated tab: **Team Summary** or **My Team**.
- In this tab, Team Lead can view:
  - Team Attendance Summary
  - Team Break Summary
  - Team Prayer Break Summary
- Team Lead will only see data for their own team (not other teams or company-wide data).
- Team Lead and team assignment will be managed by Admin from the Admin Dashboard (Team Lead Management tab).
- In Department Employees list, Team Lead will be marked as `(Team Lead)` next to their name.
- All summary APIs will be reused, but filtered by the Team Lead’s team members’ IDs.

---

## Workflow Diagram

```mermaid
flowchart TD
    A[Admin Dashboard] --> B[Team Lead Management Tab]
    B --> C[Assign Team Lead to Team]
    C --> D[Assign Team Members]
    D --> E[Department Employees List]
    E --> F[Show (Team Lead) next to name]
    D --> G[Team Lead Login]
    G --> H[Team Lead Dashboard]
    H --> I[Team Summary Tab]
    I --> J[Attendance/Break/Prayer Summaries]
```

---

## Summary
- Admin manages Team Leads and teams from a dedicated dashboard tab.
- Team Leads are clearly marked in department lists.
- Team Leads get a focused dashboard to monitor their team’s attendance and breaks.
- All features are dynamic and permission-based for scalability.

---

You can use this markdown file to generate a PDF using any markdown-to-PDF tool or VS Code extension.
