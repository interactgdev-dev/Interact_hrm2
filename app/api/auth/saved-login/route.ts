import { NextRequest, NextResponse } from "next/server";
import {
  deleteSavedLoginForDevice,
  listSavedLoginsForAnyDevice,
  upsertSavedLogin,
} from "@/lib/saved-login-db";
import {
  ensureDeviceKey,
  resolveDeviceKeys,
} from "@/lib/saved-login-device";

export async function GET(req: NextRequest) {
  try {
    const deviceKeys = resolveDeviceKeys(req);
    if (!deviceKeys.length) {
      return NextResponse.json({ success: true, logins: [] });
    }

    const saved = await listSavedLoginsForAnyDevice(deviceKeys);
    return NextResponse.json({
      success: true,
      logins: saved.map((row) => ({
        loginId: row.login_id,
        password: row.password,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load saved login";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const loginId = String(body?.loginId || "").trim();
    const password = String(body?.password || "");

    if (!loginId || !password) {
      return NextResponse.json(
        { success: false, error: "loginId and password are required" },
        { status: 400 }
      );
    }

    const res = NextResponse.json({ success: true });
    const deviceKeys = resolveDeviceKeys(req, String(body?.deviceKey || ""));
    if (!deviceKeys.length) {
      deviceKeys.push(ensureDeviceKey(req, res));
    }
    for (const deviceKey of deviceKeys) {
      await upsertSavedLogin(deviceKey, loginId, password);
    }
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to save login";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const deviceKeys = resolveDeviceKeys(req);
    for (const key of deviceKeys) {
      await deleteSavedLoginForDevice(key);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete saved login";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
