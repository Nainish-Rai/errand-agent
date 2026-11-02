# Cleanup

```sh
pnpm -s verify --run "$RUN" cleanup
pnpm -s verify --run "$RUN" status        # state after cleanup
pnpm -s verify --run "$RUN" history       # command outcomes, failures included
```

Always clean up, after failures too. In a script: `trap 'pnpm -s verify --run "$RUN" cleanup' EXIT`.

Cleanup closes every browser context and Chrome, stops the backend and web process trees
(SIGTERM to their process groups and every known PID, SIGKILL after 15 s), removes the snapshot,
keeps all evidence, and exits the daemon. It then checks from outside the daemon. Expect:

```json
{ "ok": true, "daemonExited": true, "processesRemaining": [], "browserProcessesRemaining": [],
  "portsListening": [], "snapshotRemoved": true }
```

`ok: false` means something survived: the result names the PIDs or ports. Stop only those.

## Confirm nothing survived

```sh
ps -Ao pid,command | grep "errand-verify/$RUN" | grep -v grep     # nothing
lsof -nP -iTCP:BACKEND_PORT -iTCP:WEB_PORT -sTCP:LISTEN           # nothing (ports in state.json)
```

The run's servers are recognised by their process groups and by the snapshot path on their
command lines; eve's server child leaves its parent's group, and cleanup still finds it that way.

## Orphans

If the daemon died, the socket is gone and `cleanup` recovers: it stops the daemon only if its
command line is this run's own `control-errand.js --run RUN _serve`; otherwise it stops only the
processes recorded in `state.json` or naming this run's snapshot. A second cleanup is safe and
reports `alreadyCleaned`.

## Maintenance

- `pnpm -s verify --help`: complete syntax. `pnpm check:tests` runs the tool's unit tests.
- When routes, accessible names or boot environment change, update [driving](driving.md), the
  [feature map](../features/README.md) and the suites after a live run, and clean that run up.
