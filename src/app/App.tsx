import React, { useState } from 'react';
import { ToastProvider } from './providers/ToastContext';
import { AuthProvider, useAuth } from './providers/AuthContext';
import { SetupScreen } from '../features/auth/SetupScreen';
import { LoginScreen } from '../features/auth/LoginScreen';
import { LockScreen } from '../features/auth/LockScreen';
import { AppLayout, NavigationTab } from '../components/layout/AppLayout';
import { PWAStatus } from '../components/ui/PWAStatus';

import { DashboardView } from '../features/dashboard/DashboardView';
import { ClientsView } from '../features/clients/ClientsView';
import { QuotationsView } from '../features/quotations/QuotationsView';
import { ProjectsView } from '../features/projects/ProjectsView';
import { BillingView } from '../features/billing/BillingView';
import { SettingsView } from '../features/settings/SettingsView';

const MainAppContent: React.FC = () => {
  const { isInitialized, needsSetup, session } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');

  // Inter-module navigation context
  const [activeClientIdForQuote, setActiveClientIdForQuote] = useState<string | undefined>(undefined);
  const [activeClientIdForProject, setActiveClientIdForProject] = useState<string | undefined>(undefined);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | undefined>(undefined);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
          Initializing SentinelOps Local Vault...
        </p>
      </div>
    );
  }

  // First-run experience
  if (needsSetup) {
    return <SetupScreen />;
  }

  // Not authenticated
  if (!session || !session.isAuthenticated) {
    return <LoginScreen />;
  }

  const handleQuickAction = (action: 'new_client' | 'new_quotation' | 'new_project' | 'new_invoice') => {
    switch (action) {
      case 'new_client':
        setCurrentTab('clients');
        break;
      case 'new_quotation':
        setActiveClientIdForQuote(undefined);
        setCurrentTab('quotations');
        break;
      case 'new_project':
        setActiveClientIdForProject(undefined);
        setCurrentTab('projects');
        break;
      case 'new_invoice':
        setCurrentTab('billing');
        break;
    }
  };

  const handleOpenQuotationFromClient = (clientId: string) => {
    setActiveClientIdForQuote(clientId);
    setCurrentTab('quotations');
  };

  const handleOpenProjectFromClient = (clientId: string) => {
    setActiveClientIdForProject(clientId);
    setCurrentTab('projects');
  };

  const handleNavigateToInvoice = (invoiceId: string) => {
    setActiveInvoiceId(invoiceId);
    setCurrentTab('billing');
  };

  const handleNavigateToProject = (projectId: string) => {
    setCurrentTab('projects');
  };

  return (
    <>
      {/* Session Lock Screen overlay if locked */}
      {session.isLocked && <LockScreen />}

      <AppLayout
        currentTab={currentTab}
        onSelectTab={(tab) => {
          // Clear sub-context filters when user navigates directly
          setActiveClientIdForQuote(undefined);
          setActiveClientIdForProject(undefined);
          setCurrentTab(tab);
        }}
        onQuickAction={handleQuickAction}
      >
        {currentTab === 'dashboard' && (
          <DashboardView
            onNavigateTab={(tab) => setCurrentTab(tab as NavigationTab)}
            onQuickAction={handleQuickAction}
          />
        )}

        {currentTab === 'clients' && (
          <ClientsView
            onOpenQuotationBuilder={handleOpenQuotationFromClient}
            onOpenProjectBuilder={handleOpenProjectFromClient}
          />
        )}

        {currentTab === 'quotations' && (
          <QuotationsView
            initialClientId={activeClientIdForQuote}
            onNavigateToInvoice={handleNavigateToInvoice}
            onNavigateToProject={handleNavigateToProject}
          />
        )}

        {currentTab === 'projects' && (
          <ProjectsView
            initialClientId={activeClientIdForProject}
            onOpenInvoice={handleNavigateToInvoice}
          />
        )}

        {currentTab === 'billing' && (
          <BillingView initialInvoiceId={activeInvoiceId} />
        )}

        {currentTab === 'settings' && <SettingsView />}
      </AppLayout>
    </>
  );
};

export default function App() {
  return (
    <>
      <PWAStatus />
      <ToastProvider>
        <AuthProvider>
          <MainAppContent />
        </AuthProvider>
      </ToastProvider>
    </>
  );
}
