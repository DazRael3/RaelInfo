const VALID_CURRENCIES = new Set(['USD', 'CAD']);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function hasUsablePrice(item) {
  return item.currentPrice !== null &&
    item.currentPrice !== undefined &&
    Number.isFinite(Number(item.currentPrice)) &&
    Number(item.currentPrice) > 0;
}

export function calculatePortfolioAnalytics(items = []) {
  const currencies = new Map();
  const holdings = [];

  for (const item of items) {
    const currency = VALID_CURRENCIES.has(String(item.currency || 'USD').toUpperCase())
      ? String(item.currency || 'USD').toUpperCase()
      : 'USD';
    const shares = finiteNumber(item.shares);
    const averageCost = finiteNumber(item.averageCost);
    const costBasis = shares * averageCost;
    const priced = hasUsablePrice(item);
    const currentPrice = priced ? Number(item.currentPrice) : null;
    const marketValue = priced ? shares * currentPrice : null;
    const gainLoss = priced ? marketValue - costBasis : null;
    const gainLossPercent = priced && costBasis > 0
      ? (gainLoss / costBasis) * 100
      : null;

    if (!currencies.has(currency)) {
      currencies.set(currency, {
        currency,
        positionCount: 0,
        pricedCount: 0,
        unpricedCount: 0,
        costBasis: 0,
        pricedCostBasis: 0,
        marketValue: 0,
        gainLoss: 0
      });
    }

    const summary = currencies.get(currency);
    summary.positionCount += 1;
    summary.costBasis += costBasis;

    if (priced) {
      summary.pricedCount += 1;
      summary.pricedCostBasis += costBasis;
      summary.marketValue += marketValue;
      summary.gainLoss += gainLoss;
    } else {
      summary.unpricedCount += 1;
    }

    holdings.push({
      id: item.id || '',
      symbol: String(item.symbol || '').toUpperCase(),
      currency,
      shares,
      averageCost,
      currentPrice,
      costBasis,
      marketValue,
      gainLoss,
      gainLossPercent,
      priceUpdatedAt: item.priceUpdatedAt || null,
      priced
    });
  }

  const summaries = [...currencies.values()].map(summary => ({
    ...summary,
    gainLossPercent: summary.pricedCostBasis > 0
      ? (summary.gainLoss / summary.pricedCostBasis) * 100
      : null
  }));

  for (const holding of holdings) {
    const summary = currencies.get(holding.currency);
    holding.allocationPercent = holding.priced && summary.marketValue > 0
      ? (holding.marketValue / summary.marketValue) * 100
      : null;
  }

  const ranked = holdings
    .filter(item => item.priced && item.gainLossPercent !== null)
    .sort((a, b) => b.gainLossPercent - a.gainLossPercent);

  const allocations = new Map();
  for (const holding of holdings) {
    if (!holding.priced) continue;
    const key = `${holding.currency}:${holding.symbol}`;
    const existing = allocations.get(key) || {
      symbol: holding.symbol,
      currency: holding.currency,
      marketValue: 0
    };
    existing.marketValue += holding.marketValue;
    allocations.set(key, existing);
  }

  const allocationRows = [...allocations.values()];
  for (const row of allocationRows) {
    const summary = currencies.get(row.currency);
    row.allocationPercent = summary.marketValue > 0
      ? (row.marketValue / summary.marketValue) * 100
      : 0;
  }
  allocationRows.sort((a, b) => b.allocationPercent - a.allocationPercent);

  return {
    summaries,
    holdings,
    ranked,
    allocationRows,
    totalPositions: holdings.length,
    pricedCount: holdings.filter(item => item.priced).length,
    unpricedCount: holdings.filter(item => !item.priced).length
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function money(value, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function percent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function signedMoney(value, currency) {
  if (value === null || value === undefined) return '—';
  const formatted = money(Math.abs(value), currency);
  return `${value >= 0 ? '+' : '−'}${formatted}`;
}

function appendMetric(parent, label, value, detail = '') {
  const card = element('div', 'portfolio-metric');
  card.append(element('span', 'portfolio-metric-label', label));
  card.append(element('strong', 'portfolio-metric-value', value));
  if (detail) card.append(element('small', 'portfolio-metric-detail', detail));
  parent.append(card);
}

function appendRankingList(parent, title, rows, emptyText) {
  const section = element('section', 'portfolio-analytics-section');
  section.append(element('h4', '', title));
  if (!rows.length) {
    section.append(element('p', 'muted', emptyText));
  } else {
    const list = element('ol', 'portfolio-analytics-list');
    for (const holding of rows) {
      const item = element('li', 'portfolio-analytics-row');
      const left = element('span', 'portfolio-analytics-symbol', `${holding.symbol} · ${holding.currency}`);
      const resultClass = holding.gainLoss >= 0 ? 'portfolio-positive' : 'portfolio-negative';
      const right = element('span', resultClass,
        `${percent(holding.gainLossPercent)} (${signedMoney(holding.gainLoss, holding.currency)})`);
      item.append(left, right);
      list.append(item);
    }
    section.append(list);
  }
  parent.append(section);
}

function csvSafe(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(analytics) {
  const header = [
    'Symbol', 'Currency', 'Shares', 'Average Cost', 'Cost Basis',
    'Current Price', 'Market Value', 'Unrealized Gain/Loss',
    'Unrealized Gain/Loss Percent', 'Allocation Percent', 'Price Updated At'
  ];
  const rows = analytics.holdings.map(item => [
    item.symbol,
    item.currency,
    item.shares,
    item.averageCost,
    item.costBasis,
    item.currentPrice ?? '',
    item.marketValue ?? '',
    item.gainLoss ?? '',
    item.gainLossPercent ?? '',
    item.allocationPercent ?? '',
    item.priceUpdatedAt ?? ''
  ]);
  const csv = [header, ...rows].map(row => row.map(csvSafe).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = `raelinfo-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderPortfolioAnalytics(root, items = []) {
  if (!root) return;
  root.replaceChildren();

  const analytics = calculatePortfolioAnalytics(items);
  const header = element('div', 'portfolio-analytics-heading');
  header.append(element('h3', '', 'Portfolio analytics'));
  const exportButton = element('button', 'portfolio-export-button', 'Export CSV');
  exportButton.type = 'button';
  exportButton.disabled = analytics.totalPositions === 0;
  exportButton.addEventListener('click', () => exportCsv(analytics));
  header.append(exportButton);
  root.append(header);

  if (!analytics.totalPositions) {
    root.append(element('p', 'muted', 'Add portfolio positions to see your analytics.'));
    return;
  }

  const coverage = element('p', 'portfolio-coverage',
    `Price coverage: ${analytics.pricedCount} of ${analytics.totalPositions} positions priced · ${analytics.unpricedCount} awaiting a price`);
  root.append(coverage);

  for (const summary of analytics.summaries) {
    const section = element('section', 'portfolio-currency-block');
    section.append(element('h4', '', `${summary.currency} overview`));
    const metrics = element('div', 'portfolio-metrics-grid');
    appendMetric(metrics, 'Cost basis · all positions', money(summary.costBasis, summary.currency));
    appendMetric(metrics, 'Cost basis · priced positions', money(summary.pricedCostBasis, summary.currency));
    appendMetric(metrics, 'Market value · priced only', money(summary.marketValue, summary.currency),
      `${summary.pricedCount} priced positions`);
    appendMetric(metrics, 'Unrealized gain/loss', signedMoney(summary.gainLoss, summary.currency),
      `Return on priced cost basis: ${percent(summary.gainLossPercent)}`);
    section.append(metrics);
    root.append(section);
  }

  const rankedByCurrency = new Map();
  for (const summary of analytics.summaries) {
    const rows = analytics.ranked.filter(item => item.currency === summary.currency);
    rankedByCurrency.set(summary.currency, rows);
  }

  for (const summary of analytics.summaries) {
    const rows = rankedByCurrency.get(summary.currency) || [];
    const section = element('section', 'portfolio-analytics-section');
    section.append(element('h4', '', `${summary.currency} performance rankings`));
    const columns = element('div', 'portfolio-ranking-grid');
    appendRankingList(columns, 'Top performers', rows.slice(0, 3),
      'Add prices and a positive cost basis to rank holdings.');
    appendRankingList(columns, 'Underperformers', [...rows].reverse().slice(0, 3),
      'No ranked holdings yet.');
    section.append(columns);
    root.append(section);
  }

  const concentrationSection = element('section', 'portfolio-analytics-section');
  concentrationSection.append(element('h4', '', 'Concentration watch'));
  const concentrationRows = analytics.allocationRows.filter(item => item.allocationPercent >= 15);
  if (!concentrationRows.length) {
    concentrationSection.append(element('p', 'muted',
      'No priced holding currently represents 15% or more of its currency portfolio.'));
  } else {
    const list = element('ul', 'portfolio-analytics-list');
    for (const holding of concentrationRows) {
      const warning = holding.allocationPercent >= 25 ? 'High concentration' : 'Concentration watch';
      list.append(element('li', 'portfolio-analytics-row',
        `${holding.symbol} (${holding.currency}): ${holding.allocationPercent.toFixed(1)}% · ${warning}`));
    }
    concentrationSection.append(list);
  }
  root.append(concentrationSection);

  const allocationSection = element('section', 'portfolio-analytics-section');
  allocationSection.append(element('h4', '', 'Market-value allocation'));
  allocationSection.append(element('p', 'muted',
    'Allocation is calculated separately by currency and includes only positions with saved prices.'));
  const allocationList = element('ul', 'portfolio-analytics-list');
  for (const item of analytics.allocationRows) {
    allocationList.append(element('li', 'portfolio-analytics-row',
      `${item.symbol} · ${item.currency}: ${item.allocationPercent.toFixed(1)}% (${money(item.marketValue, item.currency)})`));
  }
  if (!analytics.allocationRows.length) {
    allocationList.append(element('li', 'muted', 'No saved prices are available for allocation analysis.'));
  }
  allocationSection.append(allocationList);
  root.append(allocationSection);
}
