import { InvestmentProposal, Risk } from './bank.service';

const eurFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
const eurShortFmt = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const pctFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

export const eur = (v: number): string => eurFmt.format(v);
export const eurShort = (v: number): string => eurShortFmt.format(v);
export const pct = (v: number): string => pctFmt.format(v);

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function duration(months: number): string {
  if (months % 12 === 0) {
    const y = months / 12;
    return `${y} ${plural(y, 'year', 'years')}`;
  }
  return `${months} ${plural(months, 'month', 'months')}`;
}

export const RISK_INFO: Record<Risk, { level: number; label: string; text: string }> = {
  low: { level: 1, label: 'Low', text: 'You are very unlikely to lose money. Small but steady return.' },
  medium: { level: 2, label: 'Medium', text: 'The value can drop for a while. Over longer periods it usually grows.' },
  high: { level: 3, label: 'High', text: 'You could lose part of your money. Higher possible return.' },
};

/** Estimated outcome of an investment at the end of its horizon (low and high rate). */
export function projection(p: InvestmentProposal) {
  const m = p.horizon_months;
  const paidIn = p.contribution === 'monthly' ? p.amount_eur * m : p.amount_eur;
  const finalValue = (ratePct: number): number => {
    const r = ratePct / 100;
    if (p.contribution === 'one-off') return p.amount_eur * Math.pow(1 + r, m / 12);
    const i = r / 12;
    return i === 0 ? paidIn : p.amount_eur * ((Math.pow(1 + i, m) - 1) / i);
  };
  const lo = finalValue(p.return_min_pct);
  const hi = finalValue(p.return_max_pct);
  return { paidIn, gainMin: lo - paidIn, gainMax: hi - paidIn, endMin: lo, endMax: hi };
}

/** Total interest of an annuity loan (for capex financing proposals). */
export function loanInterest(amount: number, months: number, ratePct: number): number {
  const i = ratePct / 100 / 12;
  if (i === 0) return 0;
  const payment = (amount * i) / (1 - Math.pow(1 + i, -months));
  return payment * months - amount;
}

export function loanPayment(amount: number, months: number, ratePct: number): number {
  const i = ratePct / 100 / 12;
  return i === 0 ? amount / months : (amount * i) / (1 - Math.pow(1 + i, -months));
}
