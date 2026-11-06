const PALETTE = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee'];

export function drawPortfolioChart(canvas, positions = []) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || 600));
  const height = Math.max(150, Math.round(rect.height || 210));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const currencies = new Set(positions.map(item => item.currency || 'USD'));
  if (currencies.size > 1) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#a3b2c7';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Mixed USD/CAD positions are not combined without an FX conversion.', 12, 28);
    return;
  }
  const totals = new Map();
  for (const item of positions) {
    const value = Number(item.shares) * Number(item.averageCost);
    if (Number.isFinite(value) && value > 0) totals.set(item.symbol, (totals.get(item.symbol) || 0) + value);
  }
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--text').trim() || '#f3f7fc';
  const muted = style.getPropertyValue('--muted').trim() || '#a3b2c7';
  const line = style.getPropertyValue('--line').trim() || 'rgba(210,225,245,.13)';

  if (!entries.length || total <= 0) {
    ctx.fillStyle = muted;
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Add positions with a cost basis to see allocation.', 12, 28);
    return;
  }

  const cx = Math.min(88, width * .22);
  const cy = height / 2;
  const radius = Math.min(66, height * .34);
  let angle = -Math.PI / 2;
  entries.forEach(([symbol, value], index) => {
    const sweep = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.arc(cx, cy, radius * .62, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fillStyle = PALETTE[index % PALETTE.length];
    ctx.fill();
    angle += sweep;
  });
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(entries.length, cx, cy + 4);
  ctx.textAlign = 'left';

  const left = Math.min(width * .43, 155);
  const rowGap = Math.min(25, (height - 16) / entries.length);
  const startY = Math.max(18, (height - entries.length * rowGap) / 2 + 10);
  ctx.font = '700 12px system-ui, sans-serif';
  entries.forEach(([symbol, value], index) => {
    const y = startY + index * rowGap;
    ctx.fillStyle = PALETTE[index % PALETTE.length];
    ctx.fillRect(left, y - 9, 8, 8);
    ctx.fillStyle = textColor;
    ctx.fillText(symbol, left + 14, y - 2);
    ctx.fillStyle = muted;
    ctx.font = '11px system-ui, sans-serif';
    const pct = (value / total * 100).toFixed(1);
    ctx.fillText(`${pct}% · ${formatCompact(value)}`, left + 65, y - 2);
    ctx.font = '700 12px system-ui, sans-serif';
  });
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(left, height - 6);
  ctx.lineTo(width - 6, height - 6);
  ctx.stroke();
}

function formatCompact(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
