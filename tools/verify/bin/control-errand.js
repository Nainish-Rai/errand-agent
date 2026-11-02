#!/usr/bin/env node
// control-errand: the CLI and, with `_serve`, the per-run daemon. TypeScript source runs through tsx.
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
