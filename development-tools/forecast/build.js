#!/usr/bin/env node
// Build a self-contained forecast preview from an explicitly supplied JSON file.
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { buildSync } = require('esbuild');
const { run, clock } = require('./scenario');

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node development-tools/forecast/build.js scenarios.json preview.html');
  process.exit(2);
}
const root = resolve(__dirname, '../..');
const source = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
const inputs = Array.isArray(source) ? source : [source];
if (!inputs.length) throw new Error('Provide at least one scenario.');
const scenarios = inputs.map(input => ({ input, ...run(input), nowISO: clock(input.now, input.date) }));
const component = buildSync({ entryPoints: [resolve(root, 'electron/renderer/day-path.js')],
  bundle: true, platform: 'browser', format: 'iife', globalName: 'FocusIslandsDayPath',
  target: 'chrome120', write: false }).outputFiles[0].text;
const appCSS = readFileSync(resolve(root, 'electron/renderer/styles.css'), 'utf8');
const reviewCSS = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
const client = readFileSync(resolve(__dirname, 'client.js'), 'utf8');
const data = JSON.stringify(scenarios).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Focus Islands · Forecast preview</title><style>${appCSS}\n${reviewCSS}</style></head>
<body><div class="review-shell"><aside class="review-nav">
  <div class="brand"><span class="leaf">✦</span> focus islands</div>
  <div class="review-nav-title">Forecast scenarios <span id="scenario-count"></span></div>
  <label class="search-label" for="scenario-search">Find a scenario</label>
  <input id="scenario-search" type="search" placeholder="Search examples">
  <nav id="scenario-list" aria-label="Forecast scenarios"></nav>
  <p class="review-nav-note">Generated locally from the supplied scenario file.</p>
</aside><main class="review-main"><header class="review-header">
  <div><div class="eyebrow">Forecast review</div><h1 id="scenario-title"></h1><p id="scenario-subtitle"></p></div>
  <div class="review-pager"><button id="previous" class="button" type="button">← Previous</button><span id="scenario-position"></span><button id="next" class="button" type="button">Next →</button></div>
</header><div id="scenario-summary" class="review-summary"></div><div id="meeting-plan" class="review-meetings"></div><div id="day-path"></div>
<p class="review-interpretation">Neutral gaps are untracked time: neither focus nor break. Past meetings remain plan entries; the forecast uses their scheduled duration for break pacing without recording attendance.</p>
<section class="review-details"><div class="review-card"><h2>What happened so far</h2><div id="history"></div><h3>Decisions</h3><div id="decisions"></div></div>
<div class="review-card"><h2>Rest of the day</h2><div id="upcoming"></div></div></section>
<details class="review-input"><summary>Scenario input</summary><pre id="scenario-json"></pre></details>
<p class="review-footer">This uses the same day-path component and styles as the Today view. Forecasts are calculated by the app’s core planner.</p>
</main></div><script>const SCENARIOS = ${data};</script><script>${component}</script><script>${client}</script></body></html>`;
const output = resolve(outputPath);
writeFileSync(output, html);
console.log(`Wrote ${output} (${scenarios.length} scenarios)`);
