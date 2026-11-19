import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import { MEDICAL_FORM_SEEDS } from "@/lib/medical-form-templates";

export const runtime = "nodejs";

/**
 * Upsert Interact Global medical subscription + claim templates into Form Templates.
 * Idempotent by title — safe to call multiple times.
 */
export async function POST() {
  try {
    const created: string[] = [];
    const updated: string[] = [];

    for (const seed of MEDICAL_FORM_SEEDS) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM hrm_form_templates WHERE title = ? LIMIT 1`,
        [seed.title]
      );
      const existing = (rows as Array<{ id: number }>)[0];
      const schemaJson = JSON.stringify(seed.form_schema);

      if (existing?.id) {
        await pool.execute(
          `UPDATE hrm_form_templates
           SET description = ?, category = ?, form_schema = ?, is_active = 1, scope = 'company',
               department_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [seed.description, seed.category, schemaJson, existing.id]
        );
        updated.push(seed.title);
      } else {
        await pool.execute(
          `INSERT INTO hrm_form_templates
            (title, description, scope, department_id, category, form_schema, created_by, is_active)
           VALUES (?, ?, 'company', NULL, ?, ?, 'system', 1)`,
          [seed.title, seed.description, seed.category, schemaJson]
        );
        created.push(seed.title);
      }
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      count: MEDICAL_FORM_SEEDS.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Seed failed";
    // Fallback if ENUM rejects 'medical' — retry as general
    if (/medical|Data truncated|ENUM/i.test(msg)) {
      try {
        const created: string[] = [];
        const updated: string[] = [];
        for (const seed of MEDICAL_FORM_SEEDS) {
          const category = "general";
          const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM hrm_form_templates WHERE title = ? LIMIT 1`,
            [seed.title]
          );
          const existing = (rows as Array<{ id: number }>)[0];
          const schemaJson = JSON.stringify(seed.form_schema);
          if (existing?.id) {
            await pool.execute(
              `UPDATE hrm_form_templates
               SET description = ?, category = ?, form_schema = ?, is_active = 1, scope = 'company',
                   department_id = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [seed.description, category, schemaJson, existing.id]
            );
            updated.push(seed.title);
          } else {
            await pool.execute(
              `INSERT INTO hrm_form_templates
                (title, description, scope, department_id, category, form_schema, created_by, is_active)
               VALUES (?, ?, 'company', NULL, ?, ?, 'system', 1)`,
              [seed.title, seed.description, category, schemaJson]
            );
            created.push(seed.title);
          }
        }
        return NextResponse.json({
          success: true,
          created,
          updated,
          categoryFallback: "general",
          warning: msg,
        });
      } catch (err2: unknown) {
        const msg2 = err2 instanceof Error ? err2.message : "Seed failed";
        return NextResponse.json({ success: false, error: msg2 }, { status: 500 });
      }
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
