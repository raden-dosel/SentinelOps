import React, { useState, useEffect, useMemo } from 'react';
import {
  Client,
  Quotation,
  Invoice,
  Payment,
  Project,
} from '../../types';
import {
  clientRepository,
  quotationRepository,
  invoiceRepository,
  paymentRepository,
  projectRepository,
} from '../../storage/repositories';
import { formatCurrency, fromCentavos } from '../../domain/calculations';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  Receipt,
  DollarSign,
  Briefcase,
  TrendingUp,
  AlertCircle,
  Plus,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigateTab: (tab: 'clients' | 'quotations' | 'billing' | 'projects' | 'settings') => void;
  onQuickAction: (action: 'new_client' | 'new_quotation' | 'new_project' | 'new_invoice') => void;
}

export type TimePeriod = 'ALL' | 'THIS_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR' | 'LAST_30_DAYS';

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateTab,
  onQuickAction,
}) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [period, setPeriod] = useState<TimePeriod>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAllData() {
      try {
        setLoading(true);
        const [cli, quo, inv, pay, prj] = await Promise.all([
          clientRepository.getAll(),
          quotationRepository.getAll(),
          invoiceRepository.getAll(),
          paymentRepository.getAll(),
          projectRepository.getAll(),
        ]);
        setClients(cli);
        setQuotations(quo);
        setInvoices(inv);
        setPayments(pay);
        setProjects(prj);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadAllData();
  }, []);

  // Filter records by selected period
  const filterByDate = (dateStr?: string): boolean => {
    if (!dateStr || period === 'ALL') return true;
    const date = new Date(dateStr);
    const now = new Date();

    if (period === 'THIS_MONTH') {
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth()
      );
    }
    if (period === 'THIS_QUARTER') {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const recordQuarter = Math.floor(date.getMonth() / 3);
      return date.getFullYear() === now.getFullYear() && recordQuarter === currentQuarter;
    }
    if (period === 'THIS_YEAR') {
      return date.getFullYear() === now.getFullYear();
    }
    if (period === 'LAST_30_DAYS') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      return date >= thirtyDaysAgo && date <= now;
    }
    return true;
  };

  /**
   * Metric Formulations (per SentinelOps specifications):
   * 1. Open Leads = Leads in actionable statuses (New Inquiry, Site Visit Scheduled, Quotation Sent)
   * 2. Pending Quotations = Quotations awaiting decision (Draft, Sent)
   * 3. Ongoing Projects = Projects actively in progress (Planning, Survey, Approved, Ongoing)
   * 4. Collected Cash = Sum of valid (non-reversed) payments recorded in period
   * 5. Outstanding Receivables = Sum of unpaid balance on non-void invoices
   * 6. Billed Revenue = Sum of grand total on non-void, non-draft invoices in period
   */
  const metrics = useMemo(() => {
    // 1. Open Leads
    const openLeadsCount = clients.filter(
      (c) =>
        filterByDate(c.createdAt) &&
        (c.leadStatus === 'New Inquiry' ||
          c.leadStatus === 'Site Visit Scheduled' ||
          c.leadStatus === 'Quotation Sent')
    ).length;

    // 2. Pending Quotations
    const pendingQuotes = quotations.filter(
      (q) =>
        filterByDate(q.issueDate) &&
        (q.status === 'Draft' || q.status === 'Sent')
    );
    const pendingQuotesCount = pendingQuotes.length;
    const pendingQuotesValueCentavos = pendingQuotes.reduce(
      (acc, q) => acc + q.grandTotalCentavos,
      0
    );

    // 3. Ongoing Projects
    const ongoingProjectsCount = projects.filter(
      (p) =>
        filterByDate(p.createdAt) &&
        (p.status === 'Planning' ||
          p.status === 'Survey' ||
          p.status === 'Approved' ||
          p.status === 'Ongoing')
    ).length;

    // 4. Collected Cash Payments
    const validPayments = payments.filter((p) => !p.isReversed && filterByDate(p.paymentDate));
    const collectedCashCentavos = validPayments.reduce((acc, p) => acc + p.amountCentavos, 0);

    // 5. Outstanding Receivables
    const activeInvoices = invoices.filter((inv) => inv.status !== 'Void' && inv.status !== 'Draft');
    const outstandingBalancesCentavos = activeInvoices.reduce(
      (acc, inv) => acc + inv.remainingBalanceCentavos,
      0
    );

    // Overdue Invoices
    const overdueInvoices = invoices.filter((inv) => inv.status === 'Overdue');
    const overdueTotalCentavos = overdueInvoices.reduce(
      (acc, inv) => acc + inv.remainingBalanceCentavos,
      0
    );

    // 6. Billed Revenue
    const billedInvoices = activeInvoices.filter((inv) => filterByDate(inv.issueDate));
    const billedRevenueCentavos = billedInvoices.reduce(
      (acc, inv) => acc + inv.grandTotalCentavos,
      0
    );

    return {
      openLeadsCount,
      pendingQuotesCount,
      pendingQuotesValueCentavos,
      ongoingProjectsCount,
      collectedCashCentavos,
      outstandingBalancesCentavos,
      overdueInvoicesCount: overdueInvoices.length,
      overdueTotalCentavos,
      billedRevenueCentavos,
    };
  }, [clients, quotations, invoices, payments, projects, period]);

  // Chart Data: Financial Comparison (Billed vs Collected)
  const chartData = useMemo(() => {
    return [
      {
        name: 'Financial Flow',
        Billed: fromCentavos(metrics.billedRevenueCentavos),
        Collected: fromCentavos(metrics.collectedCashCentavos),
        Outstanding: fromCentavos(metrics.outstandingBalancesCentavos),
      },
    ];
  }, [metrics]);

  // Project Status Breakdown Chart Data
  const projectStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });

    const colors: Record<string, string> = {
      Ongoing: '#3b82f6',
      Approved: '#6366f1',
      Survey: '#a855f7',
      Planning: '#f59e0b',
      Completed: '#10b981',
      Closed: '#64748b',
    };

    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: colors[name] || '#3b82f6',
    }));
  }, [projects]);

  return (
    <div className="space-y-6">
      {/* Welcome Banner & Period Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-850 border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Operations & Financial Overview
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time business performance derived directly from local encrypted tablet storage.
          </p>
        </div>

        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs">
          <button
            onClick={() => setPeriod('ALL')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              period === 'ALL' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            All Time
          </button>
          <button
            onClick={() => setPeriod('THIS_MONTH')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              period === 'THIS_MONTH' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            This Month
          </button>
          <button
            onClick={() => setPeriod('THIS_QUARTER')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              period === 'THIS_QUARTER' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Quarter
          </button>
          <button
            onClick={() => setPeriod('THIS_YEAR')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              period === 'THIS_YEAR' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Year
          </button>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* KPI 1: Collected Cash */}
        <div
          onClick={() => onNavigateTab('billing')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition cursor-pointer space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Collected Cash
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono tracking-tight">
              {formatCurrency(metrics.collectedCashCentavos)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Actual cash collected and acknowledged in period
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-emerald-400 group-hover:translate-x-1 transition-transform">
            <span>View payment ledger</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* KPI 2: Outstanding Receivables */}
        <div
          onClick={() => onNavigateTab('billing')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-rose-500/50 transition cursor-pointer space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Outstanding Balances
            </span>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-rose-400 font-mono tracking-tight">
              {formatCurrency(metrics.outstandingBalancesCentavos)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {metrics.overdueInvoicesCount > 0 ? (
                <span className="text-rose-400 font-semibold">
                  ⚠️ {metrics.overdueInvoicesCount} invoice(s) overdue ({formatCurrency(metrics.overdueTotalCentavos)})
                </span>
              ) : (
                'All receivables are currently within due dates'
              )}
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-rose-400 group-hover:translate-x-1 transition-transform">
            <span>Inspect invoices</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* KPI 3: Total Billed Revenue */}
        <div
          onClick={() => onNavigateTab('billing')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-blue-500/50 transition cursor-pointer space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Billed Revenue
            </span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight">
              {formatCurrency(metrics.billedRevenueCentavos)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Cumulative invoices issued under selected timeframe
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-blue-400 group-hover:translate-x-1 transition-transform">
            <span>View billing history</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* KPI 4: Ongoing Projects */}
        <div
          onClick={() => onNavigateTab('projects')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Ongoing Projects
            </span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-indigo-400 tracking-tight">
              {metrics.ongoingProjectsCount}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Active installations in survey, approved, or ongoing execution
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-indigo-400 group-hover:translate-x-1 transition-transform">
            <span>Track project timelines</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* KPI 5: Pending Quotations */}
        <div
          onClick={() => onNavigateTab('quotations')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 transition cursor-pointer space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pending Quotations
            </span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-amber-400 tracking-tight">
              {metrics.pendingQuotesCount}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Worth {formatCurrency(metrics.pendingQuotesValueCentavos)} in pipeline proposals
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-amber-400 group-hover:translate-x-1 transition-transform">
            <span>Review proposals</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* KPI 6: Open CRM Leads */}
        <div
          onClick={() => onNavigateTab('clients')}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 transition cursor-pointer space-y-3 group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active CRM Leads
            </span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-purple-400 tracking-tight">
              {metrics.openLeadsCount}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              New inquiries and scheduled site visits awaiting proposal
            </p>
          </div>
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-purple-400 group-hover:translate-x-1 transition-transform">
            <span>Manage customer leads</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Visual Charts & Operations Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Financial Flow Bar Chart */}
        <div className="lg:col-span-8 p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span>Revenue vs Collections Flow (₱ PHP)</span>
            </h3>
            <span className="text-xs text-slate-400">Real-time balances</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickFormatter={(val) => `₱${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(val: unknown) =>
                    typeof val === 'number'
                      ? `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                      : String(val)
                  }
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Legend />
                <Bar dataKey="Billed" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Billed Revenue" />
                <Bar dataKey="Collected" fill="#10b981" radius={[6, 6, 0, 0]} name="Cash Collected" />
                <Bar dataKey="Outstanding" fill="#f43f5e" radius={[6, 6, 0, 0]} name="Receivables" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project Pipeline Breakdown Chart */}
        <div className="lg:col-span-4 p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-indigo-400" />
              <span>Project Pipeline</span>
            </h3>
            <span className="text-xs text-slate-400">{projects.length} Total</span>
          </div>

          {projects.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs">
              <Briefcase className="w-8 h-8 mb-2 opacity-50" />
              <span>No project records logged yet.</span>
            </div>
          ) : (
            <div className="h-56 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={projectStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {projectStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '0.75rem',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="pt-3 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>Need a new site survey?</span>
            <button
              onClick={() => onQuickAction('new_project')}
              className="text-blue-400 hover:underline font-semibold"
            >
              + Create Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
