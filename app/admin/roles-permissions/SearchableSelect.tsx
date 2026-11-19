"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./system-control-demo.module.css";

export type SelectOption = {
  value: string;
  label: string;
  meta?: string;
  accent?: string;
};

export type SelectGroup = {
  id: string;
  label: string;
  options: SelectOption[];
};

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  groups?: SelectGroup[];
  options?: SelectOption[];
  searchPlaceholder?: string;
  emptyText?: string;
  filterOption: (opt: SelectOption, query: string) => boolean;
  disabled?: boolean;
  /** Sticky action under the list (e.g. Add new role) — always visible while open. */
  footerAction?: { label: string; onClick: () => void };
};

function allOptions(groups?: SelectGroup[], options?: SelectOption[]): SelectOption[] {
  if (options) return options;
  return (groups ?? []).flatMap((g) => g.options);
}

export default function SearchableSelect({
  id,
  label,
  value,
  onChange,
  groups,
  options,
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  filterOption,
  disabled = false,
  footerAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const flat = useMemo(() => allOptions(groups, options), [groups, options]);
  const selected = flat.find((o) => o.value === value);

  const q = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter((o) => !q || filterOption(o, q)),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, q, filterOption]);

  const filteredOptions = useMemo(() => {
    if (!options) return [];
    return options.filter((o) => !q || filterOption(o, q));
  }, [options, q, filterOption]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function pick(opt: SelectOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  }

  function renderOption(opt: SelectOption) {
    const active = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        role="option"
        aria-selected={active}
        className={`${styles.permSelectOption} ${active ? styles.permSelectOptionActive : ""}`}
        onClick={() => pick(opt)}
      >
        {opt.accent && (
          <span className={styles.permSelectDot} style={{ background: opt.accent }} />
        )}
        <span className={styles.permSelectOptionText}>
          <span className={styles.permSelectOptionLabel}>{opt.label}</span>
          {opt.meta && <span className={styles.permSelectOptionMeta}>{opt.meta}</span>}
        </span>
      </button>
    );
  }

  return (
    <div className={styles.permSelectField} ref={wrapRef}>
      <label className={styles.permSelectLabel} htmlFor={`${id}-trigger`}>
        {label}
      </label>
      <button
        id={`${id}-trigger`}
        type="button"
        className={styles.permSelectTrigger}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        {selected ? (
          <>
            {selected.accent && (
              <span className={styles.permSelectDot} style={{ background: selected.accent }} />
            )}
            <span className={styles.permSelectTriggerText}>{selected.label}</span>
          </>
        ) : (
          <span className={styles.permSelectPlaceholder}>Choose…</span>
        )}
        <span className={styles.permSelectChevron} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.permSelectMenu} role="listbox" aria-label={label}>
          <div className={styles.permSelectSearchWrap}>
            <span className={styles.permSelectSearchIcon}>⌕</span>
            <input
              ref={searchRef}
              type="search"
              className={styles.permSelectSearch}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
          </div>
          <div className={styles.permSelectList}>
            {groups &&
              filteredGroups.map((g) => (
                <div key={g.id} className={styles.permSelectGroup}>
                  <div className={styles.permSelectGroupLabel}>{g.label}</div>
                  {g.options.map((opt) => renderOption(opt))}
                </div>
              ))}
            {options && filteredOptions.map((opt) => renderOption(opt))}
            {((groups && filteredGroups.length === 0) ||
              (options && filteredOptions.length === 0)) && (
              <div className={styles.permSelectEmpty}>{emptyText}</div>
            )}
          </div>
          {footerAction ? (
            <button
              type="button"
              className={styles.permSelectFooterAction}
              onClick={() => {
                setOpen(false);
                setQuery("");
                footerAction.onClick();
              }}
            >
              {footerAction.label}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
