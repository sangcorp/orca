# Packaged Windows PTY native capability smoke

This narrow harness runs the packaged `Orca.exe` with `ELECTRON_RUN_AS_NODE=1` and loads its bundled `node-pty`. A 256-bit fixture token binds the target shell, detached grandchild, and unrelated canary to one unique named-pipe channel; the oracle checks the patched exports, job PIDs, exact job-handle termination, PTY/socket exit events, and canary survival.

Run it against an unpacked Windows package:

```text
pnpm run smoke:windows-pty-native-capability -- --exe=dist/win-unpacked/Orca.exe
```

The official `v1.4.158` package is the causal red artifact: it fails immediately because its
packaged `node-pty` lacks `assignCurrentProcessToJob`. Candidate green evidence comes from the
required Windows packaging job, which runs this smoke without retries.
