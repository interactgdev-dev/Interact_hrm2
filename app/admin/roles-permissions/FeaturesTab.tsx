"use client";

import React from "react";
import styles from "./system-control-demo.module.css";
import type { GlobalFeature } from "./system-control-data";

type Props = {
  features: GlobalFeature[];
  onToggle: (key: string) => void;
  onSave: () => void;
  readOnly?: boolean;
};

export default function FeaturesTab({ features, onToggle, onSave, readOnly }: Props) {
  return (
    <div className={styles.panelBody}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Global features</h2>
          <p className={styles.sectionSub}>
            If a feature is OFF, it is hidden for every role — even when the permission is checked
            in the matrix.
          </p>
        </div>
        <button
          type="button"
          className={styles.btnSolidPurple}
          onClick={onSave}
          disabled={readOnly}
        >
          Save changes
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Description</th>
              <th className={styles.colToggle}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {features.map((feat) => (
              <tr key={feat.key}>
                <td className={styles.featureNameCell}>{feat.name}</td>
                <td className={styles.mutedCell}>{feat.desc}</td>
                <td>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={feat.on}
                      disabled={readOnly}
                      onChange={() => onToggle(feat.key)}
                    />
                    <span className={styles.toggleSlider} />
                  </label>
                  <span className={`${styles.statusPill} ${feat.on ? styles.statusOn : styles.statusOff}`}>
                    {feat.on ? "ON" : "OFF"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
