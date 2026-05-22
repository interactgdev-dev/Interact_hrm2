import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { pool } from "@/lib/db";

// Max file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const employee_id = formData.get("employee_id");
  const files = formData.getAll("files");
  if (!employee_id || files.length === 0) {
    return NextResponse.json({ success: false, error: "Missing employee_id or files" }, { status: 400 });
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const savedFiles = [];
  for (const file of files) {
    if (!(file instanceof File)) continue;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: `File ${file.name} exceeds 100MB limit` }, { status: 400 });
    }
    const ext = path.extname(file.name);
    if (ext.toLowerCase() !== ".pdf") {
      return NextResponse.json({ success: false, error: "Only PDF files allowed" }, { status: 400 });
    }
    const uniqueName = uuidv4() + ext;
    const filePath = path.join(UPLOAD_DIR, uniqueName);
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    // Save record in DB (MySQL)
    await pool.execute(
      `INSERT INTO employee_attachments (employee_id, file_name, file_path, file_size) VALUES (?, ?, ?, ?)`,
      [Number(employee_id), file.name, `/uploads/${uniqueName}`, file.size]
    );
    savedFiles.push({ name: file.name, url: `/uploads/${uniqueName}` });
  }
  return NextResponse.json({ success: true, files: savedFiles });
}
