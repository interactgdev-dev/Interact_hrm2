"use client";

import React from "react";

type EmployeeSessionValue = {
  employeeId: string;
  employeeName: string;
  setEmployeeId: (id: string) => void;
  setEmployeeName: (name: string) => void;
};

const EmployeeSessionContext = React.createContext<EmployeeSessionValue | null>(
  null,
);

export function EmployeeSessionProvider({
  employeeId,
  employeeName,
  setEmployeeId,
  setEmployeeName,
  children,
}: EmployeeSessionValue & { children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ employeeId, employeeName, setEmployeeId, setEmployeeName }),
    [employeeId, employeeName, setEmployeeId, setEmployeeName],
  );
  return (
    <EmployeeSessionContext.Provider value={value}>
      {children}
    </EmployeeSessionContext.Provider>
  );
}

/** Shared dashboard session — same name as Welcome Back / profile card. */
export function useEmployeeSession(): EmployeeSessionValue {
  const ctx = React.useContext(EmployeeSessionContext);
  if (!ctx) {
    return {
      employeeId: "",
      employeeName: "Employee",
      setEmployeeId: () => {},
      setEmployeeName: () => {},
    };
  }
  return ctx;
}
