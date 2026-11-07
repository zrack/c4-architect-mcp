import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';

// Check the server's compact SVG when present, with the Mermaid export retained
// as a compatibility fallback. Inspect actual rendered paths, not just layout
// waypoints, so labels cannot silently hide unrelated arrows.
const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const outputDirectory = path.resolve(args.shift() ?? path.join(projectRoot, 'output/playwright/component-scale'));
const inputs = args.length ? args : ['component-12.md', 'component-20.md'].map(name => path.join(outputDirectory, name));

async function readExportState(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#canvas > svg');
    return {
      viewBox: svg.getAttribute('viewBox').trim().split(/\s+/).map(Number),
      style: svg.getAttribute('style'),
      selectedNodes: [...svg.querySelectorAll('g.node.selected')].map(node => node.dataset.nodeId),
      activeEdges: [...svg.querySelectorAll('g.edge:not(.dimmed)')].map(edge => edge.dataset.edgeId),
      outgoingEdges: [...svg.querySelectorAll('g.edge.outgoing')].map(edge => edge.dataset.edgeId),
      incomingEdges: [...svg.querySelectorAll('g.edge.incoming')].map(edge => edge.dataset.edgeId),
      dimmedEdges: [...svg.querySelectorAll('g.edge.dimmed')].map(edge => edge.dataset.edgeId),
      selectionTitle: document.getElementById('selection-title').textContent,
    };
  });
}

async function inspectDownloadedSvg(page, filename) {
  const source = await fs.readFile(filename, 'utf8');
  return page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (document.querySelector('parsererror')) throw new Error('Downloaded SVG is invalid XML');
    const svg = document.documentElement;
    return {
      namespace: svg.namespaceURI,
      width: Number(svg.getAttribute('width')),
      height: Number(svg.getAttribute('height')),
      viewBox: svg.getAttribute('viewBox').trim().split(/\s+/).map(Number),
      style: svg.getAttribute('style'),
      nodes: svg.querySelectorAll('g.node').length,
      edges: svg.querySelectorAll('g.edge').length,
      selectedNodes: [...svg.querySelectorAll('g.node.selected')].map(node => node.dataset.nodeId),
      activeEdges: [...svg.querySelectorAll('g.edge:not(.dimmed)')].map(edge => edge.dataset.edgeId),
      outgoingEdges: [...svg.querySelectorAll('g.edge.outgoing')].map(edge => edge.dataset.edgeId),
      incomingEdges: [...svg.querySelectorAll('g.edge.incoming')].map(edge => edge.dataset.edgeId),
      dimmedEdges: [...svg.querySelectorAll('g.edge.dimmed')].map(edge => edge.dataset.edgeId),
    };
  }, source);
}

async function checkInteractiveExports(page, outputDirectory, name, expected, target) {
  // A zoomed view must still export the original full graph, not a viewport crop.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const selectedState = await readExportState(page);
  assert.deepEqual(selectedState.selectedNodes, [target.id], 'Export setup lost the component selection');
  const naturalWidth = selectedState.viewBox[2], naturalHeight = selectedState.viewBox[3];
  const saveDownload = async (format, suffix, expectedNameSuffix) => {
    const pending = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: `Export ${format.toUpperCase()}`, exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null, `${format} download failed`);
    assert.ok(download.suggestedFilename().endsWith(expectedNameSuffix), `Unexpected ${format} filename: ${download.suggestedFilename()}`);
    const filename = path.join(outputDirectory, `${name}.${suffix}.${format}`);
    await download.saveAs(filename);
    const status = (await page.locator('#export-status').textContent())?.trim() ?? '';
    assert.ok(status && !/failed|error/i.test(status), `Export status must confirm success: ${status}`);
    return { path: filename, filename: download.suggestedFilename(), status };
  };
  const selectedSvg = await saveDownload('svg', 'selected', `-node-${target.id}.svg`);
  const exported = await inspectDownloadedSvg(page, selectedSvg.path);
  assert.equal(exported.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(exported.width, naturalWidth, 'SVG width must ignore UI zoom');
  assert.equal(exported.height, naturalHeight, 'SVG height must ignore UI zoom');
  assert.deepEqual(exported.viewBox, selectedState.viewBox, 'SVG must contain the full graph viewBox');
  assert.ok(!exported.style || !/min-width|width\s*:\s*[^;]*%/i.test(exported.style), 'SVG must not retain viewport/zoom sizing');
  assert.equal(exported.nodes, expected.nodes.length, 'SVG must retain every component');
  assert.equal(exported.edges, expected.relationships.length, 'SVG must retain every relationship');
  for (const field of ['selectedNodes', 'activeEdges', 'outgoingEdges', 'incomingEdges', 'dimmedEdges']) {
    assert.deepEqual(exported[field], selectedState[field], `SVG lost current ${field}`);
  }
  assert.deepEqual(await readExportState(page), selectedState, 'SVG export changed the live selection or zoom');

  const selectedPng = await saveDownload('png', 'selected', `-node-${target.id}.png`);
  const png = await fs.readFile(selectedPng.path);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, naturalWidth * 2, 'PNG must export at full 2x graph width');
  assert.equal(metadata.height, naturalHeight * 2, 'PNG must export at full 2x graph height');
  const { data, info } = await sharp(png).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const highlightPixels = { outgoing: 0, incoming: 0 };
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    if (Math.abs(red - 21) <= 12 && Math.abs(green - 93) <= 12 && Math.abs(blue - 213) <= 12) highlightPixels.outgoing++;
    if (Math.abs(red - 169) <= 12 && Math.abs(green - 74) <= 12 && Math.abs(blue - 16) <= 12) highlightPixels.incoming++;
  }
  if (selectedState.outgoingEdges.length) assert.ok(highlightPixels.outgoing > 50, 'PNG lost blue outgoing highlights');
  if (selectedState.incomingEdges.length) assert.ok(highlightPixels.incoming > 50, 'PNG lost brown incoming highlights');
  assert.deepEqual(await readExportState(page), selectedState, 'PNG export changed the live selection or zoom');

  // A subsequent arrow selection and Show all must create fresh snapshots,
  // rather than exporting the component state cached by the first download.
  let edgeIndex = expected.relationships.findIndex((edge, index) => index === 5 && (edge.from === target.id || edge.to === target.id));
  if (edgeIndex < 0) edgeIndex = expected.relationships.findIndex(edge => edge.from === target.id || edge.to === target.id);
  const edgeId = `R${String(edgeIndex + 1).padStart(2, '0')}`;
  await page.locator('#connections button').filter({ hasText: new RegExp(`^${edgeId} ·`) }).click();
  const edgeSvg = await saveDownload('svg', 'edge-selected', `-edge-${edgeId}.svg`);
  const edgeExport = await inspectDownloadedSvg(page, edgeSvg.path);
  assert.deepEqual(edgeExport.activeEdges, [edgeId], 'Arrow export must isolate the selected relationship');
  assert.equal(edgeExport.dimmedEdges.length, expected.relationships.length - 1);
  assert.deepEqual(edgeExport.selectedNodes, []);
  const edgeState = await readExportState(page);
  assert.deepEqual(edgeState.activeEdges, [edgeId], 'Arrow export changed the current selection');

  await page.locator('#reset-view').click();
  const allSvg = await saveDownload('svg', 'all', '-all.svg');
  const allExport = await inspectDownloadedSvg(page, allSvg.path);
  assert.deepEqual(allExport.selectedNodes, []);
  assert.deepEqual(allExport.outgoingEdges, []);
  assert.deepEqual(allExport.incomingEdges, []);
  assert.deepEqual(allExport.dimmedEdges, []);
  assert.equal(allExport.activeEdges.length, expected.relationships.length);
  assert.deepEqual(allExport.viewBox, selectedState.viewBox);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  return {
    passed: true, naturalWidth, naturalHeight,
    pngWidth: metadata.width, pngHeight: metadata.height,
    preservedSelectionAndZoom: true, highlightPixels,
    selectedSvg, selectedPng, edgeSvg, allSvg,
  };
}

let packageRoot = path.dirname(require.resolve('mermaid'));
let mermaidPackage;
while (!mermaidPackage) {
  try {
    const candidate = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    if (candidate.name === 'mermaid') mermaidPackage = candidate;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!mermaidPackage) {
    const parent = path.dirname(packageRoot);
    if (parent === packageRoot) throw new Error('Cannot locate the installed Mermaid package. Run npm ci first.');
    packageRoot = parent;
  }
}
const bundleRoot = path.join(packageRoot, 'dist');
await fs.mkdir(outputDirectory, { recursive: true });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:white;font-family:Arial,sans-serif}
#diagram{display:inline-block;padding:24px}#diagram>svg{max-width:none!important;height:auto}
</style></head><body><div id="diagram"></div><script type="module">
import mermaid from '/mermaid/mermaid.esm.min.mjs';
window.loadSvg=async(source)=>{
  document.getElementById('diagram').innerHTML=source;
  const svg=document.querySelector('#diagram>svg'),bounds=svg.viewBox.baseVal;
  svg.style.width=Math.ceil(bounds.width)+'px';svg.style.height=Math.ceil(bounds.height)+'px';
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
};
window.renderFixture=async(source)=>{
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'default'});
  const result=await mermaid.render('fixture',source);
  document.getElementById('diagram').innerHTML=result.svg;
  const svg=document.querySelector('#diagram>svg'),bounds=svg.viewBox.baseVal;
  svg.style.width=Math.ceil(bounds.width)+'px';svg.style.height=Math.ceil(bounds.height)+'px';
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return result.svg;
};
window.ready=true;
</script></body></html>`;

const interactiveDocuments = new Map();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    if (interactiveDocuments.has(pathname)) {
      res.setHeader('Content-Type', 'text/html'); res.end(interactiveDocuments.get(pathname)); return;
    }
    if (!pathname.startsWith('/mermaid/')) { res.writeHead(404); res.end(); return; }
    const file = path.resolve(bundleRoot, pathname.slice('/mermaid/'.length));
    const relative = path.relative(bundleRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end('Unable to load local rendering resource');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

let browser;
const reports = [];
try {
  const channel = process.env.C4_BROWSER_CHANNEL ?? 'chrome';
  browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  const browserVersion = await browser.version();
  const page = await browser.newPage({ viewport: { width: 1800, height: 1600 }, deviceScaleFactor: 1 });
  for (const input of inputs) {
    const name = path.basename(input).replace(/\.(md|mmd)$/i, '');
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.ready === true);
      const markdown = await fs.readFile(input, 'utf8');
      const svgPath = input.replace(/\.(md|mmd)$/i, '.svg');
      let serverSvg;
      try {
        const candidate = await fs.readFile(svgPath, 'utf8');
        if (/<svg\b[^>]*\bdata-engine\s*=\s*["']elk["']/i.test(candidate)) serverSvg = candidate;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const renderer = serverSvg ? 'elk' : 'mermaid';
      // Parse the portable Mermaid export even when the primary image uses ELK.
      // This catches incompatible syntax after a Mermaid dependency update.
      const mermaidSource = markdown.match(/```mermaid\s*\n([\s\S]*?)```/)?.[1] ?? markdown;
      if (serverSvg) {
        const fallback = await page.evaluate(source => window.renderFixture(source), mermaidSource);
        assert.match(fallback, /<svg\b/, 'Mermaid fallback must render to SVG');
      }
      if (serverSvg) {
        await page.evaluate(source => window.loadSvg(source), serverSvg);
      } else {
        const source = markdown.match(/```mermaid\s*\n([\s\S]*?)```/)?.[1] ?? markdown;
        const svg = await page.evaluate(source => window.renderFixture(source), source);
        await fs.writeFile(path.join(outputDirectory, `${name}.svg`), svg);
      }
      // The compact server produces its own PNG. Preserve it and save a separate
      // browser preview so this check can never substitute a client render.
      await page.locator('#diagram').screenshot({ path: path.join(outputDirectory, `${name}${serverSvg ? '.browser' : ''}.png`) });
      const geometry = await page.evaluate(() => {
        const box = element => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const nodes = [...document.querySelectorAll('g.node')].map(element => ({ id: element.id, text: element.textContent, box: box(element) }));
        const labels = [...document.querySelectorAll('g.edgeLabel')].filter(element => element.textContent.trim()).map((element, index) => ({
          id: `edge-label-${index}`, edgeId: element.getAttribute('data-edge-id') ?? element.querySelector('[data-id]')?.getAttribute('data-id'), text: element.textContent, box: box(element),
        }));
        const intersects = (a, b, inset = 1) => a.x + inset < b.x + b.width - inset && a.x + a.width - inset > b.x + inset && a.y + inset < b.y + b.height - inset && a.y + a.height - inset > b.y + inset;
        const nodeOverlaps = [], labelNodeOverlaps = [], labelOverlaps = [];
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
          if (intersects(nodes[i].box, nodes[j].box)) nodeOverlaps.push([nodes[i].id, nodes[j].id]);
        }
        for (const label of labels) for (const node of nodes) {
          if (intersects(label.box, node.box)) labelNodeOverlaps.push([label.id, node.id]);
        }
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
          if (intersects(labels[i].box, labels[j].box)) labelOverlaps.push([labels[i].id, labels[j].id]);
        }
        const paths = [...document.querySelectorAll('path.flowchart-link')];
        const edgeNodeIntersections = [], edgeLabelIntersections = [];
        // Mermaid splits self-loops into three paths. They form one relationship
        // and share one label, with an arrowhead only on the terminal segment.
        const relationshipId = id => id?.replace(/(cyclic-special-)(1|mid|2)$/, '$1loop');
        for (const edge of paths) {
          const length = edge.getTotalLength(), matrix = edge.getScreenCTM();
          const touchedNodes = new Set(), touchedLabels = new Set();
          for (let distance = 3; distance < length - 3; distance += 3) {
            const p = edge.getPointAtLength(distance), point = new DOMPoint(p.x, p.y).matrixTransform(matrix);
            for (const node of nodes) {
              const b = node.box;
              if (point.x > b.x + 5 && point.x < b.x + b.width - 5 && point.y > b.y + 5 && point.y < b.y + b.height - 5) touchedNodes.add(node.id);
            }
            for (const label of labels) {
              if (relationshipId(label.edgeId) === relationshipId(edge.id)) continue;
              const b = label.box;
              if (point.x > b.x + 2 && point.x < b.x + b.width - 2 && point.y > b.y + 2 && point.y < b.y + b.height - 2) touchedLabels.add(label.id);
            }
          }
          for (const id of touchedNodes) edgeNodeIntersections.push([edge.id, id]);
          for (const id of touchedLabels) edgeLabelIntersections.push([edge.id, id]);
        }
        const arrowheadCount = paths.filter(edge => {
          const marker = edge.getAttribute('marker-end');
          return marker && marker !== 'none';
        }).length;
        const svgBox = box(document.querySelector('#diagram>svg'));
        const textSizes = [...document.querySelectorAll('#diagram svg text')].map(element => parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
        const nativeMinTextSize = textSizes.length ? Math.min(...textSizes) : null;
        const primarySizes = [...document.querySelectorAll('#diagram svg .node-title, #diagram svg .edge-label-text')]
          .map(element => parseFloat(getComputedStyle(element).fontSize)).filter(Number.isFinite);
        const primaryMinTextSize = primarySizes.length ? Math.min(...primarySizes) : null;
        const fitTo736Scale = Math.min(1, 736 / svgBox.width);
        return {
          nodes, labels, nodeOverlaps, labelNodeOverlaps, labelOverlaps, edgeNodeIntersections, edgeLabelIntersections,
          pathCount: paths.length, arrowheadCount, svgBox, nativeMinTextSize, primaryMinTextSize, fitTo736Scale,
          minTextPixelsAt736: nativeMinTextSize === null ? null : nativeMinTextSize * fitTo736Scale,
          primaryTextPixelsAt736: primaryMinTextSize === null ? null : primaryMinTextSize * fitTo736Scale,
        };
      });
      let expected;
      try {
        expected = JSON.parse(await fs.readFile(input.replace(/\.(md|mmd)$/i, '.input.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const countMismatches = [];
      if (expected) {
        const expectedLabels = expected.relationships.filter(item => item.label?.trim() || item.technology?.trim()).length;
        for (const [kind, actual, wanted] of [
          ['architecture nodes', geometry.nodes.length, expected.nodes.length],
          ['relationship labels', geometry.labels.length, expectedLabels],
          ['relationship arrowheads', geometry.arrowheadCount, expected.relationships.length],
        ]) if (actual !== wanted) countMismatches.push({ kind, actual, expected: wanted });
      }
      const failures = ['nodeOverlaps', 'labelNodeOverlaps', 'labelOverlaps', 'edgeNodeIntersections', 'edgeLabelIntersections']
        .filter(key => geometry[key].length).map(key => ({ check: key, count: geometry[key].length }));
      if (countMismatches.length) failures.push({ check: 'countMismatches', count: countMismatches.length });
      const compactness = renderer === 'elk' ? {
        area: geometry.svgBox.width * geometry.svgBox.height,
        baselineArea: 4300 * 2394,
        areaRatio: geometry.svgBox.width * geometry.svgBox.height / (4300 * 2394),
        maxDimension: Math.max(geometry.svgBox.width, geometry.svgBox.height),
      } : undefined;
      if (renderer === 'elk') {
        if (geometry.primaryMinTextSize === null || geometry.primaryMinTextSize < 14) {
          failures.push({ check: 'primaryTextTooSmall', actual: geometry.primaryMinTextSize, minimum: 14 });
        }
        if (expected?.nodes.length === 20 && (compactness.areaRatio >= 0.6 || compactness.maxDimension > 2600)) {
          failures.push({ check: 'compactness', areaRatio: compactness.areaRatio, maxDimension: compactness.maxDimension });
        }
      }
      let interaction;
      const htmlPath = input.replace(/\.(md|mmd)$/i, '.html');
      let interactiveHtml;
      try { interactiveHtml = await fs.readFile(htmlPath, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (renderer === 'elk' && interactiveHtml && expected) {
        const route = `/interactive/${interactiveDocuments.size}`;
        interactiveDocuments.set(route, interactiveHtml);
        await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
        await page.waitForSelector('g.node[data-node-id]');
        const target = expected.nodes.find(node => node.id === 'orders') ?? expected.nodes.find(node => expected.relationships.some(edge => edge.from === node.id || edge.to === node.id));
        if (target) {
          const expectedConnected = expected.relationships.filter(edge => edge.from === target.id || edge.to === target.id).length;
          const selector = await page.evaluate(id => `g.node[data-node-id="${CSS.escape(id)}"]`, target.id);
          const targetNode = page.locator(selector);
          await targetNode.click();
          const selectionTitle = (await page.locator('#selection-title').textContent())?.trim() ?? '';
          const highlightedEdges = await page.locator('g.edge[data-edge-id]:not(.dimmed)').count();
          const dimmedEdges = await page.locator('g.edge[data-edge-id].dimmed').count();
          const clickSelects = selectionTitle.includes(target.label) && highlightedEdges === expectedConnected && dimmedEdges === expected.relationships.length - expectedConnected;
          const exports = await checkInteractiveExports(page, outputDirectory, name, expected, target);
          await page.locator('#reset-view').click();
          const resetClears = await page.locator('g.edge[data-edge-id].dimmed').count() === 0;
          await targetNode.focus();
          await targetNode.press('Enter');
          const keyboardSelects = await page.locator('g.edge[data-edge-id]:not(.dimmed)').count() === expectedConnected;
          await page.keyboard.press('Escape');
          const escapeClears = await page.locator('g.edge[data-edge-id].dimmed').count() === 0;
          interaction = { targetId: target.id, selectionTitle, expectedConnected, highlightedEdges, dimmedEdges, clickSelects, resetClears, keyboardSelects, escapeClears, exports, passed: clickSelects && resetClears && keyboardSelects && escapeClears && exports.passed };
          if (!interaction.passed) failures.push({ check: 'interactiveTracing', ...interaction });
          await page.screenshot({ path: path.join(outputDirectory, `${name}.interactive.png`), fullPage: true });
          // The saved HTML is self-contained: its export controls must also work
          // when opened directly from disk, without the preview HTTP server.
          if (expected.nodes.length === 20) {
            const standalonePage = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
            try {
              await standalonePage.goto(pathToFileURL(path.resolve(htmlPath)).href);
              await standalonePage.waitForSelector('g.node[data-node-id]');
              await standalonePage.locator(selector).click();
              interaction.standaloneExports = await checkInteractiveExports(standalonePage, outputDirectory, `${name}.standalone`, expected, target);
            } finally {
              await standalonePage.close();
            }
          }
        }
      }
      reports.push({ input: path.resolve(input), name, renderer, mermaidVersion: mermaidPackage.version, browserVersion, ...geometry, compactness, interaction, countMismatches, failures, passed: failures.length === 0 });
    } catch (error) {
      reports.push({ input: path.resolve(input), name, mermaidVersion: mermaidPackage.version, browserVersion, passed: false, error: error.message });
    }
  }
  await fs.writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify({
    mermaidVersion: mermaidPackage.version, browserVersion, outputDirectory,
    reports: reports.map(({ name, renderer, nodes, labels, arrowheadCount, pathCount, failures, countMismatches, passed, error, svgBox, nativeMinTextSize, primaryMinTextSize, minTextPixelsAt736, primaryTextPixelsAt736, compactness, interaction }) => ({
      name, renderer, passed, nodes: nodes?.length, labels: labels?.length, arrowheadCount, pathCount, failures, countMismatches, error,
      width: svgBox?.width, height: svgBox?.height, nativeMinTextSize, primaryMinTextSize, minTextPixelsAt736, primaryTextPixelsAt736, compactness, interaction,
    })),
  }, null, 2));
  if (reports.some(report => !report.passed)) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
