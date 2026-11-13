export function calculatePortfolioTotals(items = []) {
  const costTotals = new Map();
  const marketTotals = new Map();
  const gainTotals = new Map();
  const pricedCounts = new Map();

  for (const item of items) {
    const currency = item.currency || 'USD';
    const shares = Number(item.shares);
    const averageCost = Number(item.averageCost);
    const basis = shares * averageCost;

    costTotals.set(currency, (costTotals.get(currency) || 0) + basis);

    const hasPrice = item.currentPrice !== null &&
      item.currentPrice !== undefined &&
      Number.isFinite(Number(item.currentPrice)) &&
      Number(item.currentPrice) > 0;

    if (!hasPrice) continue;

    const marketValue = shares * Number(item.currentPrice);
    const gain = marketValue - basis;

    marketTotals.set(currency, (marketTotals.get(currency) || 0) + marketValue);
    gainTotals.set(currency, (gainTotals.get(currency) || 0) + gain);
    pricedCounts.set(currency, (pricedCounts.get(currency) || 0) + 1);
  }

  return { costTotals, marketTotals, gainTotals, pricedCounts };
}
