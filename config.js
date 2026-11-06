import 'dotenv/config';

const asNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Secrets are read from environment variables only. Never commit a populated .env file.
export const KEYS = Object.freeze({
  alpha: process.env.ALPHA_VANTAGE_KEY || '',
  fmp: process.env.FMP_KEY || '',
  eod: process.env.EODHD_KEY || '',
  coingecko: process.env.COINGECKO_API_KEY || '',
  news: process.env.NEWS_API_KEY || ''
});

export const CONFIG = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: asNumber(process.env.PORT, 3000),
  sessionDays: asNumber(process.env.SESSION_DAYS, 7),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '',
  stockProviderOrder: (process.env.STOCK_PROVIDER_ORDER || 'alpha,fmp,eod')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
  secUserAgent: process.env.SEC_USER_AGENT || '',
  dataDir: new URL('./data/', import.meta.url),
  publicDir: new URL('./public/', import.meta.url),
  cacheTtl: Object.freeze({
    crypto: 60_000,
    fx: 6 * 60 * 60 * 1000,
    stock: 2 * 60 * 1000,
    news: 5 * 60 * 1000,
    filings: 15 * 60 * 1000
  })
});
