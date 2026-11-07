// Reproduce the README assets through the real stdio MCP server and browser exports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright';
import { componentScaleFixtures } from '../test/fixtures/component-scale.mjs';
const component20 = componentScaleFixtures.find(fixture => fixture.name === 'component-20').diagram;
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root,'output/docs'); const assets = path.join(root,'docs/images');
await fs.mkdir(output,{recursive:true}); await fs.mkdir(assets,{recursive:true});
const client = new Client({name:'readme-examples',version:'1.0.0'});
let browser;
const call = async (name,args) => { const r = await client.callTool({name,arguments:args}); assert.notEqual(r.isError,true,JSON.stringify(r)); return r; };
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:root}));
  const graphPath = path.join(output,'example-graph.json');
  await call('analyze_architectural_boundaries',{targetDir:path.join(root,'examples/order-service/src'),c4Level:'Component',configPath:path.join(root,'examples/c4-architect.config.json'),tsconfigPath:path.join(root,'examples/order-service/tsconfig.json'),outputPath:graphPath,responseMode:'summary'});
  await call('render_architecture_graph',{graphPath,title:'Order processing — source-derived Component example',outputPath:path.join(output,'component-example.md')});
  await fs.copyFile(path.join(output,'component-example.png'),path.join(assets,'component-example.png'));
  await fs.copyFile(path.join(output,'component-example.svg'),path.join(assets,'component-example.svg'));
  await call('render_c4_mermaid',{...component20,title:'Order processing — 20-node renderer example',outputPath:path.join(output,'component-20.md')});
  await fs.copyFile(path.join(output,'component-20.png'),path.join(assets,'component-20.png'));
  await fs.copyFile(path.join(output,'component-20.svg'),path.join(assets,'component-20.svg'));
  const channel = process.env.C4_BROWSER_CHANNEL ?? 'chrome';
  browser = await chromium.launch({headless:true,...(channel==='chromium'?{}:{channel})});
  const page = await browser.newPage({viewport:{width:1800,height:1200},deviceScaleFactor:1});
  await page.goto(pathToFileURL(path.join(output,'component-20.html')).href);
  await page.getByRole('button',{name:'Show connections for Order orchestration',exact:true}).click();
  assert.equal(await page.locator('#selection-title').textContent(),'Order orchestration');
  for (const format of ['svg','png']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button',{name:`Export ${format.toUpperCase()}`,exact:true}).click();
    const download = await pending; assert.equal(await download.failure(),null);
    await download.saveAs(path.join(assets,`selection-example.${format}`));
  }
  await page.locator('header').screenshot({path:path.join(assets,'export-toolbar.png')});
  console.log('README source-derived image, 20-node example, selected PNG/SVG exports, and toolbar captured.');
} finally { await browser?.close(); await client.close(); }
