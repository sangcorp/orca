# Packaged Windows PTY native capability smoke

This narrow harness runs the packaged `Orca.exe` with `ELECTRON_RUN_AS_NODE=1` and loads its bundled `node-pty`. A 256-bit fixture token binds the target shell, detached grandchild, and unrelated canary to one unique named-pipe channel; the oracle checks the patched exports, job PIDs, exact job-handle termination, PTY/socket exit events, and canary survival.

`real-orca-close-restart.mjs` is the pending full-product sentinel. It launches the exact
packaged app with an isolated profile, starts target and canary commands in real Orca
terminals, detaches a target grandchild behind an exited launcher, closes the exact target
through the packaged CLI, then proves target absence and canary liveness before and after an
app restart. Its member sockets are kernel-backed connection/readiness barriers, while a
post-restart marker driven through packaged `terminal send` proves the restored PTY input path;
screenshots are diagnostics only.

The detached child is launched behind a transient hidden Windows Script Host process. Before
close, the packaged `conpty_console_list` native probe must include the target command and omit
that still-connected grandchild, preventing the older console-list fallback from satisfying the
job-ownership claim.

Run it only on a disposable Windows host after the native smoke passes:

```text
node tests/tools/windows-pty-native-capability-smoke/real-orca-close-restart.mjs --exe=dist/win-unpacked/Orca.exe
```

The real-app sentinel remains unrouted until it passes on Windows 2. PID plus fixture
token/role/channel is still partial OS identity. `startedAtMs` is self-reported Node process
time, not authoritative OS creation time, and the captured daemon PID files are retirement
barriers rather than retained process handles. Orca's canonical native process table does not
currently expose either primitive. Do not strengthen the claim with PID polling or PowerShell
process enumeration.

Before promotion, run the byte-identical external harness against the affected 1.4.158
artifact or a package with the job-ownership fix disabled. Record the artifact path, SHA,
version, and exact failing barrier; the expected red is target-grandchild connection closure
or the prerequisite native-capability smoke, not a timeout-only UI assertion.
