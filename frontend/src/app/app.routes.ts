import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth';
import { HomePage } from './pages/home.page';
import { LoginPage } from './pages/login.page';
import { LiquidityPage } from './pages/liquidity.page';
import { InvestmentsPage } from './pages/investments.page';
import { TaxPage } from './pages/tax.page';
import { FxPage } from './pages/fx.page';
import { AnalysisPage } from './pages/analysis.page';
import { TransactionsPage } from './pages/transactions.page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, canActivate: [guestGuard], title: 'Sign in · DuckBank' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', component: HomePage, title: 'Overview · DuckBank' },
      { path: 'liquidity', component: LiquidityPage, title: 'Liquidity · DuckBank' },
      { path: 'investments', component: InvestmentsPage, title: 'Investments · DuckBank' },
      { path: 'tax', component: TaxPage, title: 'Tax · DuckBank' },
      { path: 'fx', component: FxPage, title: 'FX hedging · DuckBank' },
      { path: 'analytics', component: AnalysisPage, title: 'Analytics · DuckBank' },
      { path: 'transactions', component: TransactionsPage, title: 'Transactions · DuckBank' },
    ],
  },
  { path: '**', redirectTo: '' },
];
