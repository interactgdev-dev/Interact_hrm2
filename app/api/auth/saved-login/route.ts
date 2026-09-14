/**
 * Saved-login API — disabled for credential storage.
 * Credentials must stay in browser localStorage only (see saved-login-client.ts).
 * Endpoints kept as safe no-ops so old clients cannot read/write shared DB rows.
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    logins: [],
    disabled: true,
    message: "Saved logins are device-local only; server storage is disabled.",
  });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    disabled: true,
    message: "Server-side saved login storage is disabled.",
  });
}

export async function DELETE() {
  return NextResponse.json({
    success: true,
    disabled: true,
    message: "Server-side saved login storage is disabled.",
  });
}
