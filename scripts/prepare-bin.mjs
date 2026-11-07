import { chmod } from 'node:fs/promises';

// Local MCP configuration can launch this file directly, without npm's bin shim.
await chmod(new URL('../dist/index.js', import.meta.url), 0o755);
