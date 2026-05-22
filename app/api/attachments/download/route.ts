import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get("filename");

    if (!filename) {
      return NextResponse.json({ success: false, error: "Missing filename" }, { status: 400 });
    }

    // Prevent path traversal attacks
    const safeName = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, safeName);

    // Verify the file exists and is within the upload directory
    const realPath = await fs.realpath(filePath);
    if (!realPath.startsWith(await fs.realpath(UPLOAD_DIR))) {
      return NextResponse.json({ success: false, error: "Invalid file path" }, { status: 403 });
    }

    // Read file
    const fileContent = await fs.readFile(filePath);
    
    return new NextResponse(fileContent, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { success: false, error: "File not found or download failed" },
      { status: 404 }
    );
  }
}
