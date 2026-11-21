import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth';
import { HomePage } from './pages/home.page';
import { LoginPage } from './pages/login.page';
import { LiquidityPage } from './pages/liquidity.page';
import { InvestmentsPage } from './pages/investments.page';
import { TaxPage } from './pages/tax.page';
import { FxPage } from './pages/fx.page';
import { AnalysisPage } from './pages/analysis.page';
import { AllocationPage } from './pages/allocation.page';
import { AccountPage } from './pages/account.page';
import { TransactionsPage } from './pages/transactions.page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, canActivate: [guestGuard], title: 'Sign in · Duck CFO' },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', component: HomePage, title: 'Overview · Duck CFO' },
      { path: 'liquidity', component: LiquidityPage, title: 'Liquidity · Duck CFO' },
      { path: 'investments', component: InvestmentsPage, title: 'Investments · Duck CFO' },
      { path: 'tax', component: TaxPage, title: 'Tax · Duck CFO' },
      { path: 'fx', component: FxPage, title: 'FX hedging · Duck CFO' },
      { path: 'allocation', component: AllocationPage, title: 'Allocation · Duck CFO' },
      { path: 'account', component: AccountPage, title: 'Account · Duck CFO' },
      { path: 'analytics', component: AnalysisPage, title: 'Analytics · Duck CFO' },
      { path: 'transactions', component: TransactionsPage, title: 'Transactions · Duck CFO' },
    ],
  },
  { path: '**', redirectTo: '' },
];
