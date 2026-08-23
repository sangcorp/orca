# Packaged Windows PTY native capability smoke

This narrow harness runs the packaged `Orca.exe` with `ELECTRON_RUN_AS_NODE=1` and loads its bundled `node-pty`. A 256-bit fixture token binds the target shell, detached grandchild, and unrelated canary to one unique named-pipe channel; the oracle checks the patched exports, job PIDs, exact job-handle termination, PTY/socket exit events, and canary survival.

This is not full P0-WINPTY-1 evidence. PID plus fixture token/role/channel is only partial identity: OS creation-time or process-handle identity, a real Orca terminal close, and Orca terminal/orphan inventory after restart remain unverified blockers that require Windows 2 repair and physical-host validation.
