import { HttpClient } from '@angular/common/http';
import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';

export interface User {
  id: string;
  name: string;
  business: string;
  email: string;
  initials: string;
  segment: string;
}

export interface Transaction {
  date: string;
  type: string;
  reference: string;
  counterparty: string;
  amount: number;
  currency: string;
  amount_eur: number;
  category: string;
}

export interface TransactionPage {
  total: number;
  items: Transaction[];
}

export interface MonthlySummary {
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  end_balance: number;
}

export interface AccountOverview {
  account_iban: string;
  currency: string;
  period_from: string;
  period_to: string;
  opening_balance: number;
  balance: number;
  kpis: {
    total_income: number;
    total_expenses: number;
    net_result: number;
    min_balance: number;
    min_balance_date: string;
    overdraft_days: number;
    avg_monthly_income: number;
    avg_monthly_expenses: number;
    swiss_transfers_eur: number;
    swiss_transfers_count: number;
  };
  monthly: MonthlySummary[];
  daily_balance: { date: string; balance: number }[];
  categories: { name: string; amount: number }[];
}

export interface Budget {
  id: string;
  name: string;
  description: string;
  limit: number;
  spent: number;
  remaining: number;
  period_start: string;
  reset_date: string;
  reset_in_days: number;
}

/** Common header of every AI agent response. */
export interface AgentMeta {
  source: 'openshift-ai' | 'demo' | 'unavailable';
  model: string | null;
  generated_at: string;
  summary: string;
  warnings: string[];
  error: string | null;
}

export type Risk = 'low' | 'medium' | 'high';

export interface InvestmentProposal {
  title: string;
  kind: 'investment' | 'financing';
  category: string;
  amount_eur: number;
  contribution: 'one-off' | 'monthly';
  horizon_months: number;
  risk: Risk;
  return_min_pct: number;
  return_max_pct: number;
  plain_explanation: string;
  rationale: string;
}

export interface Insights extends AgentMeta {
  proposals: InvestmentProposal[];
}

export interface TaxFacts {
  year: number;
  revenue: number;
  business_expenses: number;
  estimated_profit: number;
  prepayment_basis: number;
  income_tax_prepaid: number;
  trade_tax_prepaid: number;
  wage_tax_paid: number;
  social_security_paid: number;
  owner_withdrawals: number;
  estimated_income_tax: number;
  estimated_trade_tax: number;
  estimated_additional_payment: number;
  marginal_rate_pct: number;
  vat_payments_found: boolean;
  recommended_quarterly_prepayment: number;
  monthly_tax_reserve: number;
}

export interface TaxPayment {
  date: string;
  tax: string;
  current_amount: number;
  recommended_amount: number;
  note: string;
}

export interface TaxTip {
  title: string;
  category: string;
  saving_min_eur: number;
  saving_max_eur: number;
  difficulty: 'easy' | 'medium' | 'hard';
  when: string;
  plain_explanation: string;
  steps: string[];
  rationale: string;
  legal_basis: string;
}

export interface TaxTips extends AgentMeta {
  facts: TaxFacts;
  schedule: TaxPayment[];
  tips: TaxTip[];
}

export interface CreditFacility {
  title: string;
  product: string;
  limit_eur: number;
  term: string;
  interest_min_pct: number;
  interest_max_pct: number;
  est_cost_eur: number;
  plain_explanation: string;
  rationale: string;
  steps: string[];
}

export interface Liquidity extends AgentMeta {
  as_of: string;
  days: number;
  opening_balance: number;
  forecast: { date: string; balance: number; low: number; high: number }[];
  scheduled: { date: string; label: string; amount: number }[];
  min_balance: number;
  min_balance_date: string;
  days_below_zero: number;
  end_balance: number;
  overdraft_cost_last_year: number;
  facilities: CreditFacility[];
}

export interface FxExposure {
  currency: string;
  counterparty: string;
  payments: { date: string; amount: number; currency: string; rate: number; amount_eur: number }[];
  total_foreign: number;
  total_eur: number;
  rate_min: number;
  rate_max: number;
  rate_avg: number;
  rate_swing_pct: number;
  extra_cost_vs_best_rate: number;
  cost_with_forward_at_first_rate: number;
  open_position_foreign: number;
  open_position_note: string;
}

export interface HedgeProposal {
  title: string;
  product: string;
  notional: number;
  currency: string;
  tenor: string;
  protects_against: string;
  cost: string;
  plain_explanation: string;
  rationale: string;
  steps: string[];
}

export interface Fx extends AgentMeta {
  exposures: FxExposure[];
  risk_level: Risk | null;
  hedges: HedgeProposal[];
}

export interface AiStatus {
  configured: boolean;
  url: string;
  model: string;
  reachable: boolean;
  model_found: boolean;
  available_models: string[];
  demo_fallback: boolean;
  error: string | null;
}

/** API access + shared state (loaded once, shared by all pages). */
@Injectable({ providedIn: 'root' })
export class BankService {
  private readonly http = inject(HttpClient);

  readonly user = signal<User | null>(null);
  readonly overview = signal<AccountOverview | null>(null);
  readonly budgets = signal<Budget[]>([]);
  readonly insights = signal<Insights | null>(null);
  readonly insightsLoading = signal(false);
  readonly taxTips = signal<TaxTips | null>(null);
  readonly taxLoading = signal(false);
  readonly liquidity = signal<Liquidity | null>(null);
  readonly liquidityLoading = signal(false);
  readonly fx = signal<Fx | null>(null);
  readonly fxLoading = signal(false);
  readonly aiStatus = signal<AiStatus | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    // Prototype: no login — the demo user is "signed in" straight away.
    this.http.get<User>('/api/me').subscribe({ next: (u) => this.user.set(u), error: () => this.fail() });
    this.http
      .get<AccountOverview>('/api/account/overview')
      .subscribe({ next: (o) => this.overview.set(o), error: () => this.fail() });
    this.http.get<Budget[]>('/api/budgets').subscribe({ next: (b) => this.budgets.set(b), error: () => this.fail() });
    this.loadAiStatus();
    this.loadInsights(false);
    this.loadTaxTips(false);
    this.loadLiquidity(90, false, false);
    this.loadFx(false);
  }

  transactions(limit: number, offset = 0, category = ''): Observable<TransactionPage> {
    const params: Record<string, string | number> = { limit, offset };
    if (category) params['category'] = category;
    return this.http.get<TransactionPage>('/api/account/transactions', { params });
  }

  loadAiStatus(): void {
    this.http.get<AiStatus>('/api/ai/status').subscribe({ next: (s) => this.aiStatus.set(s), error: () => this.fail() });
  }

  loadInsights(refresh: boolean): void {
    this.load('/api/insights', { refresh }, this.insights, this.insightsLoading);
  }

  loadTaxTips(refresh: boolean): void {
    this.load('/api/tax-tips', { refresh }, this.taxTips, this.taxLoading);
  }

  loadLiquidity(days: number, includeTax: boolean, refresh: boolean): void {
    this.load('/api/liquidity', { days, include_tax: includeTax, refresh }, this.liquidity, this.liquidityLoading);
  }

  loadFx(refresh: boolean): void {
    this.load('/api/fx', { refresh }, this.fx, this.fxLoading);
  }

  private load<T>(
    url: string,
    params: Record<string, string | number | boolean>,
    target: WritableSignal<T | null>,
    loading: WritableSignal<boolean>,
  ): void {
    loading.set(true);
    this.http.get<T>(url, { params }).subscribe({
      next: (v) => {
        target.set(v);
        loading.set(false);
      },
      error: () => {
        loading.set(false);
        this.fail();
      },
    });
  }

  private fail(): void {
    this.error.set('Could not load data from the server. Please refresh the page.');
  }
}
