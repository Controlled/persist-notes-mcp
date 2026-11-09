#!/usr/bin/env node
// Executável do pacote (npx @persistnotes/mcp). O código fica em dist/, gerado por scripts/build.js.
'use strict';
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  process.stderr.write(`Persist Notes MCP needs Node.js 18 or newer (found ${process.versions.node}). Install a current Node.js from https://nodejs.org and try again.\n`);
  process.exit(1);
}
require('../dist/server.js').main(process.argv);
