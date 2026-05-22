import "server-only";

import { existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";

export type ZkbioSyncResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type PythonLaunch = { command: string; args: string[] };

/** Resolve a Python executable (new laptops often lack `py` on PATH). */
export function resolveZkbioPythonLaunch(scriptPath: string, scriptArgs: string[]): PythonLaunch | null {
  const custom = process.env.ZKBIO_PYTHON?.trim();
  if (custom) {
    return { command: custom, args: [scriptPath, ...scriptArgs] };
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const candidates: PythonLaunch[] = [];

  if (process.platform === "win32") {
    for (const ver of ["312", "313", "311", "310"]) {
      const exe = path.join(localAppData, "Programs", "Python", `Python${ver}`, "python.exe");
      if (existsSync(exe)) {
        candidates.push({ command: exe, args: [scriptPath, ...scriptArgs] });
      }
      const pf = path.join(programFiles, `Python${ver}`, "python.exe");
      if (existsSync(pf)) {
        candidates.push({ command: pf, args: [scriptPath, ...scriptArgs] });
      }
    }
    candidates.push({ command: "py", args: ["-3", scriptPath, ...scriptArgs] });
  }

  candidates.push(
    { command: "python3", args: [scriptPath, ...scriptArgs] },
    { command: "python", args: [scriptPath, ...scriptArgs] },
  );

  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.command}\0${c.args.join("\0")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.command.includes(path.sep) || c.command.includes("/")) {
      if (!existsSync(c.command)) continue;
      return c;
    }
    return c;
  }
  return null;
}

function spawnPython(launch: PythonLaunch, root: string): Promise<ZkbioSyncResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(launch.command, launch.args, {
      cwd: root,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
    });
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      stderr += String(err);
      resolve({ code: -1, stdout, stderr });
    });
  });
}

/**
 * Runs scripts/zkbio_sync_punches.py (reads scripts/zkbio-sync.local.env inside Python).
 */
export async function runZkbioSync(options?: { start?: string; end?: string }): Promise<ZkbioSyncResult> {
  const root = process.cwd();
  const scriptPath = path.join(root, "scripts", "zkbio_sync_punches.py");
  const scriptArgs: string[] = [];
  if (options?.start) scriptArgs.push("--start", options.start);
  if (options?.end) scriptArgs.push("--end", options.end);

  const launch = resolveZkbioPythonLaunch(scriptPath, scriptArgs);
  if (!launch) {
    return {
      code: -1,
      stdout: "",
      stderr:
        "Python not found for ZKBio sync. Install Python 3.12+ or set ZKBIO_PYTHON to python.exe path in .env.local",
    };
  }

  let result = await spawnPython(launch, root);
  const spawnErr = result.stderr || "";
  const needsFallback =
    result.code === -1 &&
    (spawnErr.includes("ENOENT") || spawnErr.includes("spawn py") || spawnErr.includes("not recognized"));

  if (!needsFallback || launch.command.includes(path.sep)) {
    return result;
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  for (const ver of ["312", "313", "311"]) {
    const exe = path.join(localAppData, "Programs", "Python", `Python${ver}`, "python.exe");
    if (!existsSync(exe) || exe === launch.command) continue;
    result = await spawnPython({ command: exe, args: [scriptPath, ...scriptArgs] }, root);
    if (result.code !== -1 || !String(result.stderr).includes("ENOENT")) {
      return result;
    }
  }

  return result;
}
