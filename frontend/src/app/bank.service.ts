import { HttpClient } from '@angular/common/http';
import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, retry, tap } from 'rxjs';

export interface User {
  id: string;
  username: string;
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
  /** Spending by category in the latest month of the statement. */
  month_categories: { name: string; amount: number }[];
}

export type GoalFrequency = 'one-off' | 'weekly' | 'monthly' | 'quarterly';

export interface GoalWay {
  id: string;
  title: string;
  category: string;
  frequency: GoalFrequency;
  amount_eur: number;
  payments: number;
  months: number | null;
  total_paid: number;
  expected_interest: number;
  risk: 'low' | 'medium' | 'high';
  return_min_pct: number;
  return_max_pct: number;
  plain_explanation: string;
  rationale: string;
  /** Versus saving the same monthly sum with no interest; positive = better. Null for the baseline itself. */
  months_faster?: number | null;
}

export interface GoalCreate {
  name: string;
  description?: string;
  target: number;
  saved: number;
  deadline_months?: number | null;
  photo?: string | null;
  icon?: string | null;
  way?: GoalWay | null;
}

export interface Goal extends GoalCreate {
  id: string;
  description: string;
  created: string;
  remaining: number;
  percent: number;
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

export interface GoalPlan extends AgentMeta {
  ways: GoalWay[];
  /** The standard alternative: regular saving with no product. */
  baseline: GoalWay | null;
}

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

/** Calculated balance forecast (no AI) used by the Overview chart. */
export interface Forecast {
  as_of: string;
  days: number;
  forecast: { date: string; balance: number; low: number; high: number; expected_in: number }[];
  scheduled: { date: string; label: string; amount: number }[];
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
  forecast: { date: string; balance: number; low: number; high: number; expected_in: number }[];
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

export type AnalyticsRange = 'week' | 'month' | 'year';

export interface Analytics {
  range: AnalyticsRange;
  period_from: string;
  period_to: string;
  start_balance: number;
  end_balance: number;
  total_income: number;
  total_expenses: number;
  net: number;
  min_balance: number;
  min_balance_date: string;
  overdraft_days: number;
  daily_balance: { date: string; balance: number }[];
  buckets: { key: string; label: string; income: number; expenses: number }[];
  categories: { name: string; amount: number }[];
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
  readonly goals = signal<Goal[]>([]);
  readonly insights = signal<Insights | null>(null);
  readonly insightsLoading = signal(false);
  readonly taxTips = signal<TaxTips | null>(null);
  readonly taxLoading = signal(false);
  readonly forecast = signal<Forecast | null>(null);
  readonly liquidity = signal<Liquidity | null>(null);
  readonly liquidityLoading = signal(false);
  readonly fx = signal<Fx | null>(null);
  readonly fxLoading = signal(false);
  readonly aiStatus = signal<AiStatus | null>(null);
  readonly error = signal<string | null>(null);

  /** 'unknown' until the session was checked once. */
  readonly session = signal<'unknown' | 'in' | 'out'>('unknown');

  /** Called by the route guard: is there a valid login session (cookie)? Loads data if so. */
  async checkSession(): Promise<boolean> {
    if (this.session() === 'in') return true;
    try {
      const u = await firstValueFrom(this.http.get<User>('/api/auth/me'));
      this.signedIn(u);
      return true;
    } catch {
      this.session.set('out');
      return false;
    }
  }

  login(username: string, password: string): Observable<User> {
    return this.http.post<User>('/api/auth/login', { username, password }).pipe(tap((u) => this.signedIn(u)));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(tap({ next: () => this.reset(), error: () => this.reset() }));
  }

  /** Session expired / logged out: forget everything loaded for the previous user. */
  reset(): void {
    this.session.set('out');
    for (const s of [this.user, this.overview, this.insights, this.taxTips, this.forecast, this.liquidity, this.fx, this.aiStatus, this.error]) {
      (s as WritableSignal<unknown>).set(null);
    }
    this.goals.set([]);
  }

  private signedIn(u: User): void {
    this.user.set(u);
    this.session.set('in');
    this.error.set(null);
    this.loadAll();
  }

  private loadAll(): void {
    this.http
      .get<AccountOverview>('/api/account/overview')
      .subscribe({ next: (o) => this.overview.set(o), error: () => this.fail() });
    this.loadGoals();
    this.loadForecast();
    this.loadAiStatus();
    this.loadInsights(false);
    this.loadTaxTips(false);
    this.loadLiquidity(90, false, false);
    this.loadFx(false);
  }

  loadForecast(): void {
    this.http.get<Forecast>('/api/forecast', { params: { days: 200 } })
      .subscribe({ next: (f) => this.forecast.set(f), error: () => this.fail() });
  }

  /** Goals change the cash-flow forecast: reload it (and the liquidity outlook) after any goal change. */
  private goalsChanged = <T>() => tap<T>(() => {
    this.loadForecast();
    this.loadLiquidity(90, false, false);
  });

  updateProfile(body: { name: string; business: string; email: string }): Observable<User> {
    return this.http.put<User>('/api/auth/me', body).pipe(tap((u) => this.user.set(u)));
  }

  changePassword(current_password: string, new_password: string): Observable<void> {
    return this.http.post<void>('/api/auth/password', { current_password, new_password });
  }

  loadGoals(): void {
    this.http.get<Goal[]>('/api/goals').subscribe({ next: (g) => this.goals.set(g), error: () => this.fail() });
  }

  /** Ways to reach a goal. The server caches identical requests; `refresh` asks the AI for a new answer. */
  planGoal(
    body: { name: string; target: number; saved: number; deadline_months: number | null },
    refresh = false,
  ): Observable<GoalPlan> {
    return this.http.post<GoalPlan>('/api/goals/plan', body, { params: refresh ? { refresh: true } : {} });
  }

  addGoal(body: GoalCreate): Observable<Goal> {
    return this.http.post<Goal>('/api/goals', body).pipe(this.goalsChanged());
  }

  updateGoal(id: string, body: GoalCreate): Observable<Goal> {
    return this.http.put<Goal>(`/api/goals/${encodeURIComponent(id)}`, body).pipe(this.goalsChanged());
  }

  deleteGoal(id: string): Observable<void> {
    return this.http.delete<void>(`/api/goals/${encodeURIComponent(id)}`).pipe(this.goalsChanged());
  }

  /** Money in/out, balance and spending by category for the last week, month (30 days) or year. */
  analytics(range: AnalyticsRange): Observable<Analytics> {
    return this.http.get<Analytics>('/api/analytics', { params: { range } });
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
    // An AI answer can be slow or hit a gateway timeout: try once more, and if it still fails do NOT raise the
    // page-wide error banner. The agent pages have their own "Run analysis again" button.
    this.http.get<T>(url, { params }).pipe(retry({ count: 1, delay: 2000 })).subscribe({
      next: (v) => {
        target.set(v);
        loading.set(false);
      },
      error: () => {
        loading.set(false);
      },
    });
  }

  private fail(): void {
    if (this.session() !== 'in') return; // 401s are handled by the auth interceptor
    this.error.set('Could not load data from the server. Please refresh the page.');
  }
}
