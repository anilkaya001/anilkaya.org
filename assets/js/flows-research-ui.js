(() => {
"use strict";
const byId = (id) => document.getElementById(id);
const engine = window.FlowsUI?.researchModel || window.Flows2Model;
let model = null;
const chart = byId('chart');
const chartWrap = byId('chart-wrap');
const tooltip = byId('chart-tooltip');
const selection = { minutes: 30, liquidity: 'normal', inventory: 'ensemble' };
const definitions = {
  up: { label: 'Upside acceleration', color: '#52d891', mark: '↑', description: 'Upward shocks are amplified in this price interval under the selected assumptions.' },
  down: { label: 'Downside acceleration', color: '#ff8d83', mark: '↓', description: 'Downward shocks are amplified in this price interval under the selected assumptions.' },
  volatile: { label: 'Volatility expansion', color: '#ffc47b', mark: '↕', description: 'This interval meets the model’s volatility expansion criteria under the selected assumptions.' },
  dampen: { label: 'Two-sided dampening', color: '#a5baff', mark: '≋', description: 'Both upward and downward shocks are dampened in this price interval under the selected assumptions.' },
  mixed: { label: 'Mixed response', color: '#a7b6ca', mark: '·', description: 'The selected assumptions yield a mixed response in this price interval.' }
};
const activeLayers = new Set(Object.keys(definitions));
const inventoryLabels = { ensemble: 'Scenario ensemble', short: 'Short gamma tilt', long: 'Long gamma tilt' };
const liquidityLabels = { normal: 'Normal', thin: 'Thin' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const asNumber = (number, places = 2) => Number.isFinite(number) ? number.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }) : '—';
const asPrice = (number) => Number.isFinite(number) ? '$' + asNumber(number) : '—';
const asRatio = (number) => Number.isFinite(number) ? asNumber(number, 3) + '×' : '—';
const asPct = (number, places = 0) => Number.isFinite(number) ? asNumber(number, places) + '%' : '—';
const asShares = (number) => Number.isFinite(number) ? (number > 0 ? '+' : '') + asNumber(number, 0) : '—';
const asInterval = (low, high) => `${asPrice(low)}–${asPrice(high)}`;
const range = (low, high) => `${asNumber(low, 3)}–${asNumber(high, 3)}×`;
let result = null;
let selectedId = null;
let keyboardPoint = null;
let geometry = null;
let selectedPrice = null;

function buildControls() {
  const segment = (element, values, key, label) => {
    element.innerHTML = values.map((value) => `<button type="button" data-value="${escapeHtml(value)}" aria-pressed="false">${escapeHtml(label(value))}</button>`).join('');
    element.onclick = (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      selection[key] = key === 'minutes' ? Number(button.dataset.value) : button.dataset.value;
      runModel();
    };
  };
  segment(byId('horizons'), model.meta.minutes, 'minutes', (value) => `${value}m`);
  segment(byId('liquidity'), model.meta.liquidity, 'liquidity', (value) => liquidityLabels[value] ?? value);
  byId('inventory').innerHTML = model.meta.inventory.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(inventoryLabels[value] ?? value)}</option>`).join('');
  byId('inventory').onchange = (event) => {
    selection.inventory = event.currentTarget.value;
    runModel();
  };
  byId('layers').innerHTML = Object.entries(definitions).filter(([kind]) => kind !== 'mixed').map(([kind, item]) => `<button class="layer" type="button" data-kind="${kind}" aria-pressed="true">${item.label}</button>`).join('');
  byId('layers').onclick = (event) => {
    const button = event.target.closest('button');
    if (!button || !result) return;
    if (activeLayers.delete(button.dataset.kind)) button.setAttribute('aria-pressed', 'false');
    else {
      activeLayers.add(button.dataset.kind);
      button.setAttribute('aria-pressed', 'true');
    }
    keyboardPoint = null;
    chooseNearestZone(result.spot);
    renderVisual();
  };
  byId('zone-list').onclick = (event) => {
    const button = event.target.closest('button');
    if (button) selectZone(button.dataset.id, true);
  };
  byId('export').onclick = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([model.csv(result)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `flows-2-nvda-${selection.minutes}m-${selection.liquidity}-${selection.inventory}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

function showSnapshot() {
  const { meta, history } = model;
  const first = history[0].price;
  const change = 100 * (meta.spot / first - 1);
  const quote = byId('quote');
  quote.querySelector('strong').textContent = asPrice(meta.spot);
  const delta = quote.querySelector('.change');
  delta.textContent = `${change >= 0 ? '+' : ''}${asPct(change, 2)}`;
  delta.classList.toggle('negative', change < 0);
  quote.querySelector('.quote-context').textContent = `Last observation ${history.at(-1).time} TRT · change within replay`;
  quote.hidden = false;
  byId('source-title').textContent = meta.source || 'Recorded NVDA snapshot';
  const mode = meta.captureMode === 'point-in-time' ? 'Point-in-time capture' : meta.captureMode === 'historical-reconstruction' ? 'Historical reconstruction' : 'Historical export';
  const series = meta.seriesLabel || (meta.priceBasis === 'spot-marks' ? 'Recorded underlying spot marks' : 'Recorded underlying prices');
  byId('source-caption').textContent = [mode, meta.sessionLabel, `As of ${meta.asOfLabel}`, meta.provenance].filter(Boolean).join(' · ');
  byId('chart-sub').textContent = meta.modelReady === false ? series : `${series} and conditional price zones`;
  const badge = byId('data-status');
  badge.textContent = 'Historical replay';
  badge.classList.add('ready');
  byId('footer-status').textContent = `${meta.sessionLabel} · ${meta.version}`;
}

function visibleZones() {
  return result.zones.filter((zone) => activeLayers.has(zone.kind));
}

function chooseNearestZone(target) {
  const zones = visibleZones();
  if (zones.some((zone) => String(zone.id) === selectedId)) return;
  const distance = (zone) => Math.max(0, zone.low - target, target - zone.high);
  const nearest = zones.reduce((best, zone) => !best || distance(zone) < distance(best) ? zone : best, null);
  selectedId = nearest ? String(nearest.id) : null;
}

function runModel() {
  try {
    const currentZone = result?.zones.find((zone) => String(zone.id) === selectedId);
    result = model.evaluate({ ...selection });
    if (!result || !Array.isArray(result.rows) || !Array.isArray(result.zones)) throw new Error('Missing response result');
    const ready = result.rows.length > 0;
    for (const id of ['layer-controls', 'readouts', 'chart-caption']) byId(id).hidden = !ready;
    byId('model-controls').hidden = model.meta.modelReady === false;
    chooseNearestZone(currentZone?.center ?? result.spot);
    if (!result.zones.some((zone) => zone.id === selectedId)) selectedId = null;
    for (const button of byId('horizons').querySelectorAll('button')) button.setAttribute('aria-pressed', String(+button.dataset.value === selection.minutes));
    for (const button of byId('liquidity').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.value === selection.liquidity));
    byId('inventory').value = selection.inventory;
    byId('run-label').textContent = `${result.scenarios} SCENARIOS · ${result.contractCount} OPTION SERIES`;
    byId('export').disabled = !ready;
    byId('failure').hidden = true;
    keyboardPoint = null;
    renderVisual();
    if (ready) drawReadouts();
    writeMethodology();
  } catch (error) {
    showFailure('The model could not evaluate this snapshot with the selected inputs.');
    byId('export').disabled = true;
    console.error(error);
  }
}

function renderVisual() {
  clearHover();
  renderZones();
  drawChart();
}

function selectZone(id, restoreFocus = false) {
  if (!visibleZones().some((zone) => String(zone.id) === id)) return;
  selectedId = id;
  selectedPrice = null;
  renderVisual();
  if (restoreFocus) {
    const button = Array.from(byId('zone-list').querySelectorAll('button')).find((item) => item.dataset.id === id);
    button?.focus({ preventScroll: true });
  }
}

function renderZones() {
  const zones = visibleZones();
  const descendingZones = zones.slice().reverse();
  const list = byId('zone-list');
  if (result.rows.length === 0) {
    list.innerHTML = '<p class="zone-empty">Response zones withheld</p>';
    byId('inspector-sub').textContent = 'Recorded prices only';
    const detail = byId('zone-detail');
    if (model.meta.withheld) {
      const reasons = model.meta.withheld.split(' · ');
      detail.innerHTML = `<ul class="coverage-list">${reasons.map((reason) => `<li>${escapeHtml(reason.charAt(0).toUpperCase() + reason.slice(1))}</li>`).join('')}</ul>`;
    } else {
      detail.textContent = 'This horizon lacks enough eligible option series. Select a shorter horizon to inspect the available coverage.';
    }
    byId('inspector-foot').textContent = 'Load an eligible option chain and trade tape to calculate the model.';
    return;
  }
  const priorScroll = list.scrollTop;
  list.innerHTML = descendingZones.map((zone) => {
    const active = String(zone.id) === selectedId;
    return `<button class="zone-btn" type="button" data-id="${escapeHtml(zone.id)}" data-kind="${escapeHtml(zone.kind)}" aria-pressed="${active}"><span class="zone-swatch"></span><span class="zone-type">${definitions[zone.kind].label}</span><span class="zone-range">${asInterval(zone.low, zone.high)}</span></button>`;
  }).join('') || '<p class="zone-empty">No qualifying zones are visible for these settings.</p>';
  list.scrollTop = priorScroll;
  const selected = zones.find((zone) => String(zone.id) === selectedId);
  byId('inspector-sub').textContent = `${zones.length} visible ${zones.length === 1 ? 'zone' : 'zones'} · ${selection.minutes}-minute horizon`;
  const detail = byId('zone-detail');
  const metrics = selected?.metrics ?? modelRow(selectedPrice ?? result.spot);
  const type = selected ? definitions[selected.kind] : null;
  const stats = [
    ['Up response', asRatio(metrics.up), range(metrics.upLow, metrics.upHigh)],
    ['Down response', asRatio(metrics.down), range(metrics.downLow, metrics.downHigh)],
    ['Realized vol', asRatio(metrics.vol), range(metrics.volLow, metrics.volHigh)]
  ];
  const label = type ? `${type.mark} ${type.label}` : 'Conditional response';
  const confidence = type ? asPct(metrics.support * 100) + ' support' : 'Grid estimate';
  detail.innerHTML = `<div class="zone-kicker" data-kind="${selected?.kind || 'mixed'}"><span>${label}</span><span>${confidence}</span></div><h3>${asPrice(metrics.price)}</h3><dl class="metrics">${stats.map(([name, metric, interval]) => `<div title="Scenario range ${interval}"><dt>${name}</dt><dd>${metric}</dd></div>`).join('')}</dl><p class="zone-explain">${type?.description || 'Responses are shown for this starting price. Colored zones require a larger reading and agreement across scenarios.'}</p><p class="zone-explain">Scenario p10–p90 (up / down / vol) ${stats.map((item) => item[2]).join(' / ')}.</p>`;
  byId('inspector-foot').textContent = `Modeled hedge shares · Up ${asShares(metrics.upShares)} / Down ${asShares(metrics.downShares)}`;
}

function modelRow(price) {
  return result.rows.reduce((best, row) => Math.abs(row.price - price) < Math.abs(best.price - price) ? row : best);
}

function drawReadouts() {
  const stats = [
    ['Test shocks', `±${asPct(result.shockPct, 2)}`, 'Initial spot shocks for up/down response'],
    ['Baseline volatility', asPct(result.baseSigmaPct, 2), `${selection.minutes}-minute reference diffusion input`],
    ['Options tape', `${asNumber(result.coverage?.prints, 0)} prints`, `${asNumber(result.coverage?.signedPrints, 0)} eligible sides · ${result.contractCount} series`],
    ['Scenario coverage', `${asNumber(result.paths, 0)} paths`, `${result.scenarios} sets of assumptions · ${result.rows.length} price nodes`]
  ];
  byId('readouts').innerHTML = stats.map(([label, value, reference]) => `<div class="panel readout"><span class="small-label">${label}</span><strong>${value}</strong><p>${reference}</p></div>`).join('');
}

function makeTicks(minimum, maximum, count) {
  const stepEstimate = (maximum - minimum) / count;
  const magnitude = 10 ** Math.floor(Math.log10(stepEstimate));
  const step = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= stepEstimate) * magnitude;
  const ticks = [];
  for (let value = Math.ceil(minimum / step) * step; value <= maximum + step * 1e-9; value += step) ticks.push(value);
  return ticks;
}

function drawChart() {
  if (!result) return;
  const width = Math.max(284, Math.floor(chartWrap.clientWidth));
  const height = chartWrap.clientHeight;
  const margin = { left: width < 480 ? 39 : 55, right: width < 480 ? 8 : 13, top: 28, bottom: 31 };
  const { left, top } = margin;
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const hasModel = result.rows.length > 0;
  const split = hasModel ? left + (right - left) * (width < 480 ? .60 : .68) : right;
  const prices = model.history.map((point) => point.price);
  const zones = visibleZones();
  const minPrice = Math.min(...prices, ...result.rows.slice(0, 1).map((row) => row.price), ...zones.map((zone) => zone.low));
  const maxPrice = Math.max(...prices, ...result.rows.slice(-1).map((row) => row.price), ...zones.map((zone) => zone.high));
  const pad = Math.max(.30, (maxPrice - minPrice) * .07);
  const min = minPrice - pad;
  const max = maxPrice + pad;
  const timestamps = model.history.map((point) => Number.isFinite(point.at) ? point.at : Date.parse(point.timestamp ?? ''));
  const timestampSpan = timestamps[timestamps.length - 1] - timestamps[0];
  const useTimestamps = timestampSpan > 0 && timestamps.every((time, index) => Number.isFinite(time) && (index === 0 || time > timestamps[index - 1]));
  const fraction = (index) => useTimestamps ? (timestamps[index] - timestamps[0]) / timestampSpan : index / (prices.length - 1);
  const px = (index) => left + (split - left) * fraction(index);
  const py = (value) => bottom - (value - min) * (bottom - top) / (max - min);
  const spotY = py(result.spot);
  const historyPath = prices.map((price, index) => `${index ? 'L' : 'M'}${px(index).toFixed(2)},${py(price).toFixed(2)}`).join(' ');
  const yTicks = makeTicks(min, max, 6);
  const xTickCount = width < 480 ? 3 : 5;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => Math.round((prices.length - 1) * index / (xTickCount - 1)));
  const horizontalGrid = yTicks.map((value) => `<line x1="${left}" x2="${right}" y1="${py(value)}" y2="${py(value)}" stroke="#253247"/><text x="${left - 7}" y="${py(value) + 3}" fill="#97a9be" text-anchor="end">${asNumber(value, value % 1 ? 1 : 0)}</text>`).join('');
  const verticalGrid = xTicks.map((index) => `<line x1="${px(index)}" x2="${px(index)}" y1="${top}" y2="${bottom}" stroke="#1b2a3e"/><text x="${px(index)}" y="${bottom + 18}" fill="#97a9be" text-anchor="${index === 0 ? 'start' : index === prices.length - 1 ? 'end' : 'middle'}">${escapeHtml(model.history[index].time)}</text>`).join('');
  const bands = zones.map((zone) => {
    const y = py(zone.high);
    const h = Math.max(2, py(zone.low) - y);
    const style = definitions[zone.kind];
    const active = String(zone.id) === selectedId;
    const x = split + 2;
    const label = width > 650 ? `${style.mark}  ${style.label}` : `${style.mark}  ${asPrice(zone.center)}`;
    return `<g data-zone="${escapeHtml(zone.id)}"><rect x="${x}" y="${y}" width="${right - x}" height="${h}" fill="${style.color}" fill-opacity="${active ? .25 : .125}" stroke="${style.color}" stroke-opacity="${active ? .94 : .42}"/><rect x="${x}" y="${y}" width="3" height="${h}" fill="${style.color}" opacity="${active ? 1 : .65}"/>${h >= 15 ? `<text x="${x + 8}" y="${y + h / 2 + 3}" fill="${style.color}" font-weight="650">${label}</text>` : ''}</g>`;
  }).join('');
  const departure = hasModel ? Math.max(.005, ...result.rows.flatMap((row) => [Math.abs(row.up - 1), Math.abs(row.down - 1), Math.abs(row.vol - 1)])) : .005;
  const responseLimit = Math.ceil(departure * 500) / 500;
  const profileStart = split + 8;
  const profileEnd = right - 8;
  const responseX = (ratio) => (profileStart + profileEnd) / 2 + (ratio - 1) / responseLimit * (profileEnd - profileStart) / 2;
  const traceTypes = [['up', definitions.up.color], ['down', definitions.down.color], ['vol', definitions.volatile.color]];
  const responseTraces = hasModel ? `<line x1="${responseX(1)}" x2="${responseX(1)}" y1="${top}" y2="${bottom}" stroke="#49617d" stroke-dasharray="3 4"/>` + traceTypes.map(([key, color]) =>
    `<path d="${result.rows.map((row, index) => `${index ? 'L' : 'M'}${responseX(row[key]).toFixed(2)},${py(row.price).toFixed(2)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.25" opacity=".85" pointer-events="none"/>`).join('') : '';
  const priceLabelWidth = 54;
  const priceLabelX = right - priceLabelWidth - 2;
  const zoneHead = hasModel ? `<rect x="${split}" y="${top}" width="${right - split}" height="${bottom - top}" fill="#121d2c"/><text x="${split + 8}" y="17" fill="#b3c7e4" font-weight="650">${width < 480 ? 'RESPONSE' : 'CONDITIONAL RESPONSE BY PRICE'}</text>` : '';
  const zoneFoot = hasModel ? `<text x="${profileStart}" y="${bottom + 18}" fill="#97a9be">−${asPct(responseLimit * 100, 1)}</text><text x="${profileEnd}" y="${bottom + 18}" text-anchor="end" fill="#97a9be">+${asPct(responseLimit * 100, 1)}</text>` : '';
  chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  chart.innerHTML = `<title>Recorded NVDA price history with conditional model zones</title><defs><linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#68aaff" stop-opacity=".28"/><stop offset="1" stop-color="#68aaff" stop-opacity="0"/></linearGradient></defs>${zoneHead}<text x="${left}" y="17" fill="#a7bad0" font-weight="600">${width < 480 ? 'PRICE HISTORY' : 'RECORDED PRICE HISTORY'}</text>${horizontalGrid}${verticalGrid}<path d="${historyPath} L${split},${bottom} L${left},${bottom} Z" fill="url(#history-fill)"/><line x1="${split}" x2="${split}" y1="${top}" y2="${bottom}" stroke="#6a81a3" stroke-dasharray="4 4" stroke-opacity=".78"/>${bands}${responseTraces}<line x1="${left}" x2="${right}" y1="${spotY}" y2="${spotY}" stroke="#a4c5f4" stroke-dasharray="4 4" stroke-opacity=".63" pointer-events="none"/><path d="${historyPath}" fill="none" stroke="#91bfff" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${split}" cy="${spotY}" r="4" fill="#b8d7ff" stroke="#0d1521" stroke-width="1.5"/><g pointer-events="none"><rect x="${priceLabelX}" y="${spotY - 9}" width="${priceLabelWidth}" height="18" rx="4" fill="#233b60" stroke="#42608c"/><text x="${priceLabelX + priceLabelWidth / 2}" y="${spotY + 3}" text-anchor="middle" fill="#e3edff" font-weight="700">${asPrice(result.spot)}</text></g><line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="#31435e"/>${zoneFoot}<g id="chart-hover" pointer-events="none"></g>`;
  geometry = { width, height, left, right, top, bottom, split, px, py, min, max };
}

function clearHover() {
  tooltip.hidden = true;
  byId('chart-hover')?.replaceChildren();
}

function showHover(point, announce = false) {
  if (!geometry || !point) return clearHover();
  const { px, py, top, bottom, width, height, split } = geometry;
  let x, y, label, description;
  if (point.type === 'history') {
    const sample = model.history[point.index];
    x = px(point.index);
    y = py(sample.price);
    label = `${escapeHtml(sample.time)} TRT · ${asPrice(sample.price)}`;
    description = 'Recorded price history';
  } else if (point.type === 'grid') {
    const row = point.row;
    x = split + 10;
    y = py(row.price);
    label = `${asPrice(row.price)} · Conditional response`;
    description = `Up ${asRatio(row.up)} · Down ${asRatio(row.down)} · Vol ${asRatio(row.vol)}`;
  } else {
    const zone = point.zone;
    x = split + 10;
    y = py(zone.center);
    label = `${definitions[zone.kind].label} · ${asInterval(zone.low, zone.high)}`;
    description = `Up ${asRatio(zone.metrics.up)} · Down ${asRatio(zone.metrics.down)} · Vol ${asRatio(zone.metrics.vol)}`;
  }
  const hover = byId('chart-hover');
  if (hover) hover.innerHTML = `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#7392be" stroke-dasharray="2 4"/><circle cx="${x}" cy="${y}" r="4.5" fill="#e1eeff" stroke="#21334c" stroke-width="1.5"/>`;
  tooltip.innerHTML = `${label}<span>${description}</span>`;
  tooltip.hidden = false;
  if (announce) byId('chart-live').textContent = `${label}. ${description}`;
  const tipWidth = tooltip.offsetWidth;
  const tipHeight = tooltip.offsetHeight;
  tooltip.style.left = `${Math.max(5, Math.min(x + 9, width - tipWidth - 6))}px`;
  tooltip.style.top = `${Math.max(5, Math.min(y - tipHeight - 8, height - tipHeight - 6))}px`;
}

function onChartPoint(event) {
  if (!geometry) return null;
  const rect = chart.getBoundingClientRect();
  const { width, height, left, right, top, bottom, split, px, min, max } = geometry;
  const x = (event.clientX - rect.left) * width / rect.width;
  const y = (event.clientY - rect.top) * height / rect.height;
  if (x < left || x > right || y < top || y > bottom) return null;
  if (x <= split) {
    let lower = 0;
    let upper = model.history.length - 1;
    while (upper - lower > 1) {
      const midpoint = Math.floor((lower + upper) / 2);
      if (px(midpoint) <= x) lower = midpoint;
      else upper = midpoint;
    }
    return { type: 'history', index: x - px(lower) <= px(upper) - x ? lower : upper };
  }
  const value = min + (bottom - y) * (max - min) / (bottom - top);
  const zone = visibleZones().find((item) => item.low <= value && value <= item.high);
  if (zone) return { type: 'zone', zone };
  if (value < result.rows[0]?.price || value > result.rows.at(-1)?.price || !result.rows.length) return null;
  return { type: 'grid', row: modelRow(value) };
}

function installChartInteractions() {
  chart.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch') showHover(onChartPoint(event));
  });
  chart.addEventListener('pointerleave', clearHover);
  chart.addEventListener('click', (event) => {
    const point = onChartPoint(event);
    if (!point) return;
    if (point.type === 'zone') selectZone(String(point.zone.id));
    if (point.type === 'grid') {
      selectedPrice = point.row.price;
      selectedId = null;
      renderZones();
    }
    showHover(point);
  });
  chart.addEventListener('focus', () => {
    if (!geometry) return;
    keyboardPoint ??= { type: 'history', index: model.history.length - 1 };
    showHover(keyboardPoint, true);
  });
  chart.addEventListener('blur', clearHover);
  chart.addEventListener('keydown', (event) => {
    if (!result) return;
    const count = model.history.length;
    const zones = visibleZones();
    const key = event.key;
    keyboardPoint ??= { type: 'history', index: count - 1 };
    if (key === 'Escape') {
      clearHover();
      return;
    }
    if ((key === 'Enter' || key === ' ') && keyboardPoint.type === 'grid') {
      event.preventDefault();
      selectedPrice = keyboardPoint.row.price;
      selectedId = null;
      renderZones();
      showHover(keyboardPoint, true);
      return;
    }
    if ((key === 'Enter' || key === ' ') && keyboardPoint.type === 'zone') {
      event.preventDefault();
      selectZone(String(keyboardPoint.zone.id));
      showHover(keyboardPoint, true);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    if ((key === 'ArrowUp' || key === 'ArrowDown') && zones.length) {
      const current = keyboardPoint.type === 'zone' ? zones.indexOf(keyboardPoint.zone) : zones.findIndex((zone) => String(zone.id) === selectedId);
      const next = current < 0 ? 0 : Math.max(0, Math.min(zones.length - 1, current + (key === 'ArrowUp' ? 1 : -1)));
      keyboardPoint = { type: 'zone', zone: zones[next] };
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && result.rows.length) {
      const current = keyboardPoint.type === 'grid' ? result.rows.indexOf(keyboardPoint.row) : result.rows.indexOf(modelRow(result.spot));
      const index = Math.max(0, Math.min(result.rows.length - 1, current + (key === 'ArrowUp' ? 1 : -1)));
      keyboardPoint = { type: 'grid', row: result.rows[index] };
    } else if (key === 'ArrowRight' && result.rows.length && keyboardPoint.type === 'history' && keyboardPoint.index === count - 1) {
      keyboardPoint = { type: 'grid', row: modelRow(result.spot) };
    } else if (key === 'Home' || key === 'End' || key === 'ArrowLeft' || key === 'ArrowRight') {
      const current = keyboardPoint.type === 'history' ? keyboardPoint.index : count - 1;
      const next = key === 'Home' ? 0 : key === 'End' ? count - 1 : Math.max(0, Math.min(count - 1, current + (key === 'ArrowRight' ? 1 : -1)));
      keyboardPoint = { type: 'history', index: next };
    }
    showHover(keyboardPoint, true);
  });
  new ResizeObserver(drawChart).observe(chartWrap);
}

function writeMethodology() {
  byId('model-notes').innerHTML = `
    <p>The price axis asks what the same option book might do if NVDA were already at a given price. Evaluate a signed test shock <code>u</code> at each node. With scenario dealer inventory <code>n<sub>j</sub></code>, contract multiplier <code>M</code> and repriced option delta <code>Δ<sub>j</sub></code>, the hedge is <code>H(S) = −Σ M n<sub>j</sub> Δ<sub>j</sub>(S)</code>. The model recomputes the hedge at <code>S + u</code>, converts the assumed executed share change into a bounded price impact, then divides the resulting price move by the original shock. A ratio of 1.15× means a 15% larger move for that shock. It does not give the chance that the shock occurs.</p>
    <p>The realized-volatility response is the square root of the ratio of simulated sums of squared five-minute log returns with and without hedging. Both simulations use the same seeded Gaussian and jump innovations. Repricing uses European-option deltas, spot-sensitive implied volatility, calendar time to expiry, and liquidity that can differ by shock direction. The liquidity and inventory controls are assumptions.</p>
    <p>For volatility expansion, both directional responses and the volatility ratio must reach 1.10×. Directional acceleration requires a response of at least 1.10× and a 0.045× gap over the opposite side. Dampening requires both directional responses to be at most 0.93× and realized-volatility response at most 0.97×. Labels require at least two contiguous nodes and 60% scenario support at each node. Support is the fraction of scenario parameter settings that agree with the median-based label. The p10–p90 bands describe scenario sensitivity.</p>`;
  const scope = result?.coverage?.scope;
  const reconstruction = model?.meta?.captureMode === 'historical-reconstruction';
  byId('validation-notes').innerHTML = `
    ${reconstruction ? '<p>Historical reconstruction uses provider event and quote times. The tape was downloaded after the chart cutoff. This replay cannot verify contemporaneous collector availability or support a point-in-time backtest.</p>' : ''}
    ${scope ? `<p>Scope ${escapeHtml(scope)}. Volume and price are from completed one-minute underlying bars.</p>` : ''}
    <p>Use a recorded, entitled market-data snapshot with price bars and option inputs available as of the stated timestamp. The up/down shocks describe conditional responses. The zones do not encode a price forecast, a probability of reaching a level, an observed dealer position, or a signal verified on market data. Times are in Ankara time.</p>
    <p>With an entitled live feed, preserve event and receipt timestamps, match trades to pre-trade quotes, apply corrections, keep ambiguous signed flow explicit and version each input snapshot. Open interest counts outstanding contracts. Trade side reflects the fill’s relationship to the quote. Neither identifies a dealer’s signed position. Verify point-in-time inputs and data rights before publication.</p>
    <p>Validate out of sample on time-ordered sessions with purging for overlapping outcomes. Compare realized-volatility error with an intraday seasonal baseline, and directional continuation with a price-and-liquidity baseline. Track performance separately by time of day, liquidity, event windows and expiry. See <a href="https://www.abarbon.com/papers/gamma-fragility" target="_blank" rel="noopener noreferrer">Gamma Fragility</a> and the <a href="https://unusualwhales.com/information/options-flow-feed-page-breakdown" target="_blank" rel="noopener noreferrer">Unusual Whales feed description</a>.</p>`;
}

function showFailure(message) {
  const failure = byId('failure');
  failure.textContent = message;
  failure.hidden = false;
}

async function installSnapshot(input) {
  if (!engine || typeof engine.load !== 'function') throw new Error('The snapshot model could not load.');
  const loaded = await engine.load(input);
  if (!loaded || !Array.isArray(loaded.history) || loaded.history.length < 2) throw new Error('The snapshot must contain recorded price history.');
  model = loaded;
  selection.minutes = model.meta.minutes.includes(30) ? 30 : model.meta.minutes[0];
  selection.liquidity = model.meta.liquidity[0];
  selection.inventory = model.meta.inventory[0];
  selectedId = null;
  result = null;
  Object.keys(definitions).forEach((kind) => activeLayers.add(kind));
  buildControls();
  showSnapshot();
  chart.removeAttribute('hidden');
  byId('chart-empty').hidden = true;
  byId('workspace').classList.remove('idle');
  byId('choose-snapshot').textContent = 'Replace snapshot';
  runModel();
}

const field = byId('snapshot');
const picker = byId('choose-snapshot');
picker.addEventListener('click', () => field.click());
field.addEventListener('change', async () => {
  const file = field.files[0];
  if (!file) return;
  picker.disabled = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a JSON snapshot up to 10 MB.');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('The file is not readable JSON.');
    }
    await installSnapshot(data);
  } catch (error) {
    showFailure(error instanceof Error ? error.message : 'Could not load this snapshot.');
  } finally {
    picker.disabled = false;
    field.value = '';
  }
});
writeMethodology();
installChartInteractions();
const initial = byId('initial-snapshot');
if (initial) {
  Promise.resolve().then(() => installSnapshot(JSON.parse(initial.textContent)))
    .catch((error) => showFailure(error instanceof Error ? error.message : 'Could not open the recorded snapshot.'));
}
})();
