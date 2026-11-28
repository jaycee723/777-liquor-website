import React, { useState } from 'react';
import {
  Package,
  Upload,
  Sparkles,
  Tag,
  BarChart3,
  Lightbulb,
  Download,
  Printer,
  Settings,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  ScanBarcode,
} from 'lucide-react';
import { AppSection } from '../types/inventory';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiConfig } from '../services/apiClient';
import { CloverSyncStatusBadge } from './CloverSyncStatusBadge';

interface AppShellProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  onOpenScanner?: () => void;
  onOpenCloverBridge?: () => void;
  children: React.ReactNode;
}

interface NavItem {
  id: AppSection;
  label: string;
  group: 'Catalog' | 'Insights & Distribution' | 'System';
  phaseNote?: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'inventory', label: 'Inventory', group: 'Catalog', icon: Package },
  { id: 'import', label: 'Import', group: 'Catalog', icon: Upload },
  { id: 'enrichment', label: 'Enrichment', group: 'Catalog', icon: Sparkles },
  { id: 'pricing', label: 'Pricing Review', group: 'Catalog', icon: Tag },
  { id: 'analytics', label: 'Analytics', group: 'Insights & Distribution', icon: BarChart3 },
  { id: 'suggestions', label: 'Suggestions', group: 'Insights & Distribution', icon: Lightbulb },
  { id: 'exports', label: 'Exports & Push', group: 'Insights & Distribution', icon: Download },
  { id: 'labels', label: 'Label Studio', group: 'Insights & Distribution', phaseNote: 'P5', icon: Printer },
  { id: 'settings', label: 'Settings', group: 'System', icon: Settings },
];

const SECTION_LABELS: Record<AppSection, string> = {
  inventory: 'Inventory Grid',
  import: 'Import & Invoice OCR',
  enrichment: 'Catalog Enrichment',
  pricing: 'Pricing Review',
  analytics: 'Sales Analytics',
  suggestions: 'Product Suggestions',
  exports: 'Exports & Cooler Door',
  labels: 'Label Studio',
  settings: 'Settings',
};

export function AppShell({
  activeSection,
  onSelectSection,
  onOpenScanner,
  onOpenCloverBridge,
  children,
}: AppShellProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const groups: Array<NavItem['group']> = ['Catalog', 'Insights & Distribution', 'System'];

  const handleNavClick = (section: AppSection) => {
    onSelectSection(section);
    setMobileNavOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap inline-flex items-center gap-1.5">
          <span>777 Liquor</span>
          <span className="font-medium text-slate-500 dark:text-slate-400">Inventory</span>
        </span>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Primary workspace navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groups.map((group) => (
          <div key={group} className="space-y-1">
            <div className="px-2.5 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              {group}
            </div>
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full h-10 px-2.5 flex items-center justify-between gap-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" aria-hidden={true} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.phaseNote && (
                    <span
                      className={`text-[10px] font-mono ${
                        isActive
                          ? 'text-slate-300 dark:text-slate-600'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {item.phaseNote}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Account Footer */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div className="px-2 py-1 text-xs">
          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
            {user?.name ?? 'Store Staff'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {user?.email ?? 'owner@777liquor.com'}
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full h-9 px-2.5 flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile/Tablet Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[80vw] h-full">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 h-14 px-4 sm:px-5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap">
                777 Liquor
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-bold text-slate-900 dark:text-slate-100 truncate">
                {SECTION_LABELS[activeSection]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <span className="hidden lg:inline text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
              931 University Ave, Honolulu
            </span>
            <CloverSyncStatusBadge
              compact
              onOpenBridge={onOpenCloverBridge ?? (() => onSelectSection('import'))}
            />
            <span
              data-testid="api-mode-badge"
              title={
                apiConfig.useMockApi
                  ? 'Mock data layer active (VITE_USE_MOCK_API=true)'
                  : `Live API active (${apiConfig.baseUrl})`
              }
              className={`h-7 px-2 inline-flex items-center text-[11px] font-semibold tracking-wide rounded border whitespace-nowrap shrink-0 ${
                apiConfig.useMockApi
                  ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300'
                  : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              {apiConfig.useMockApi ? 'Mock' : 'Live'}
            </span>
            {onOpenScanner && (
              <button
                type="button"
                onClick={onOpenScanner}
                aria-label="Scan barcode"
                className="h-9 px-2.5 sm:px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ScanBarcode className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Scan</span>
              </button>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              className="h-9 px-2.5 sm:px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {theme === 'light' ? (
                <>
                  <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Light</span>
                </>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:px-5 sm:py-4">
          {children}
        </main>
      </div>
    </div>
  );
}
