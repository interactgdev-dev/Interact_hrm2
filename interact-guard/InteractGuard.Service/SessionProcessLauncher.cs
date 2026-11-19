using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace InteractGuard.Service;

/// <summary>
/// Launch Watchdog/Agent into the interactive user session from SYSTEM (Session 0).
/// Never start UI processes in Session 0 — WebView2/camera break there.
/// </summary>
internal static class SessionProcessLauncher
{
    private const string AgentProcessName = "InteractGuard";
    private const string WatchdogProcessName = "InteractGuard.Watchdog";

    public static bool IsAgentRunning() =>
        Process.GetProcessesByName(AgentProcessName).Length > 0;

    public static bool IsWatchdogRunning() =>
        Process.GetProcessesByName(WatchdogProcessName).Length > 0;

    /// <summary>
    /// Ensure Watchdog (+ Agent via watchdog) run in the active console/RDP session.
    /// Returns true if agent is already running or launch was attempted successfully.
    /// </summary>
    public static bool EnsureAgentInUserSession(string installDir, ILogger? log = null)
    {
        if (IsAgentRunning() && IsWatchdogRunning())
            return true;

        if (!Directory.Exists(installDir))
        {
            log?.LogWarning("Install dir missing: {Dir}", installDir);
            return false;
        }

        var sessionId = ResolveInteractiveSessionId();
        if (sessionId is null)
        {
            log?.LogInformation("No interactive user session — cannot launch agent yet.");
            return false;
        }

        var watchdog = Path.Combine(installDir, "InteractGuard.Watchdog.exe");
        var agent = Path.Combine(installDir, "InteractGuard.exe");

        var ok = false;
        if (File.Exists(watchdog) && !IsWatchdogRunning())
            ok = LaunchInSession(sessionId.Value, watchdog, installDir, log) || ok;
        if (File.Exists(agent) && !IsAgentRunning())
            ok = LaunchInSession(sessionId.Value, agent, installDir, log) || ok;

        // Give processes a moment; treat "already running" as success
        Thread.Sleep(400);
        return IsAgentRunning() || ok;
    }

    private static uint? ResolveInteractiveSessionId()
    {
        var console = WTSGetActiveConsoleSessionId();
        if (console != 0xFFFFFFFF && console != 0)
            return console;

        // Prefer any active user session (RDP / fast-user-switch)
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var ptr, out var count) || ptr == IntPtr.Zero)
            return console != 0xFFFFFFFF ? console : null;

        try
        {
            var size = Marshal.SizeOf<WTS_SESSION_INFO>();
            uint? fallback = null;
            for (var i = 0; i < count; i++)
            {
                var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(ptr + (i * size));
                if (info.State != WTS_CONNECTSTATE_CLASS.WTSActive)
                    continue;
                if (info.SessionId == 0) continue;
                if (info.SessionId == console) return info.SessionId;
                fallback ??= info.SessionId;
            }
            return fallback ?? (console != 0xFFFFFFFF && console != 0 ? console : null);
        }
        finally
        {
            WTSFreeMemory(ptr);
        }
    }

    private static bool LaunchInSession(uint sessionId, string exePath, string workDir, ILogger? log)
    {
        IntPtr userToken = IntPtr.Zero;
        IntPtr primaryToken = IntPtr.Zero;
        IntPtr env = IntPtr.Zero;
        try
        {
            if (!WTSQueryUserToken(sessionId, out userToken) || userToken == IntPtr.Zero)
            {
                log?.LogWarning("WTSQueryUserToken failed for session {Session} (err {Err})",
                    sessionId, Marshal.GetLastWin32Error());
                return false;
            }

            if (!DuplicateTokenEx(
                    userToken,
                    0x10000000, // MAXIMUM_ALLOWED
                    IntPtr.Zero,
                    SECURITY_IMPERSONATION_LEVEL.SecurityImpersonation,
                    TOKEN_TYPE.TokenPrimary,
                    out primaryToken) ||
                primaryToken == IntPtr.Zero)
            {
                log?.LogWarning("DuplicateTokenEx failed (err {Err})", Marshal.GetLastWin32Error());
                return false;
            }

            CreateEnvironmentBlock(out env, primaryToken, false);

            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf<STARTUPINFO>();
            si.lpDesktop = @"winsta0\default";

            var cmd = $"\"{exePath}\"";
            var created = CreateProcessAsUser(
                primaryToken,
                null,
                cmd,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                0x00000400, // CREATE_UNICODE_ENVIRONMENT
                env,
                workDir,
                ref si,
                out var pi);

            if (!created)
            {
                log?.LogWarning("CreateProcessAsUser failed for {Exe} (err {Err})",
                    exePath, Marshal.GetLastWin32Error());
                return false;
            }

            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            log?.LogInformation("Launched {Exe} in session {Session}", Path.GetFileName(exePath), sessionId);
            return true;
        }
        catch (Exception ex)
        {
            log?.LogWarning(ex, "LaunchInSession failed for {Exe}", exePath);
            return false;
        }
        finally
        {
            if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
            if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
            if (userToken != IntPtr.Zero) CloseHandle(userToken);
        }
    }

    #region P/Invoke

    private enum WTS_CONNECTSTATE_CLASS
    {
        WTSActive = 0,
        WTSConnected = 1,
        WTSConnectQuery = 2,
        WTSShadow = 3,
        WTSDisconnected = 4,
        WTSIdle = 5,
        WTSListen = 6,
        WTSReset = 7,
        WTSDown = 8,
        WTSInit = 9,
    }

    private enum SECURITY_IMPERSONATION_LEVEL
    {
        SecurityAnonymous = 0,
        SecurityIdentification = 1,
        SecurityImpersonation = 2,
        SecurityDelegation = 3,
    }

    private enum TOKEN_TYPE
    {
        TokenPrimary = 1,
        TokenImpersonation = 2,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WTS_SESSION_INFO
    {
        public uint SessionId;
        public IntPtr pWinStationName;
        public WTS_CONNECTSTATE_CLASS State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint sessionId, out IntPtr phToken);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSEnumerateSessions(
        IntPtr hServer,
        int Reserved,
        int Version,
        out IntPtr ppSessionInfo,
        out int pCount);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr pMemory);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(
        IntPtr hExistingToken,
        uint dwDesiredAccess,
        IntPtr lpTokenAttributes,
        SECURITY_IMPERSONATION_LEVEL impersonationLevel,
        TOKEN_TYPE tokenType,
        out IntPtr phNewToken);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr hToken,
        string? lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    #endregion
}
