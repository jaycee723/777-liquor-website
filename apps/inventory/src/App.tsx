/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { AppSection } from './types/inventory';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LoginGate } from './components/LoginGate';
import { AppShell } from './components/AppShell';
import { InventoryGrid } from './components/InventoryGrid';
import { ImportWorkbench } from './components/ImportWorkbench';
import { EnrichmentQueue } from './components/EnrichmentQueue';
import { PricingReview } from './components/PricingReview';
import { SalesAnalytics } from './components/SalesAnalytics';
import { ProductSuggestions } from './components/ProductSuggestions';
import { ExportsPushCenter } from './components/ExportsPushCenter';
import { PhaseRoadmapView } from './components/PhaseRoadmapView';
import { ToastBanner, ToastMessage } from './components/ToastBanner';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { ErrorBoundary } from './components/ErrorBoundary';

function OperationsConsole() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<AppSection>('inventory');
  const [importInitialMode, setImportInitialMode] = useState<'inventory' | 'clover'>('inventory');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<{ code: string; nonce: number } | null>(
    null
  );

  const showToast = useCallback((tone: 'success' | 'error', text: string) => {
    const id = Date.now();
    setToast({ id, tone, text });
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 3400);
  }, []);

  const handleGlobalBarcodeDetected = useCallback((code: string) => {
    setScannerOpen(false);
    setActiveSection('inventory');
    setScannedBarcode({ code, nonce: Date.now() });
  }, []);

  if (!user) {
    return <LoginGate />;
  }

  return (
    <>
      <AppShell
        activeSection={activeSection}
        onSelectSection={(sec) => {
          if (sec === 'import') setImportInitialMode('inventory');
          setActiveSection(sec);
        }}
        onOpenScanner={() => setScannerOpen(true)}
        onOpenCloverBridge={() => {
          setImportInitialMode('clover');
          setActiveSection('import');
        }}
      >
        {activeSection === 'inventory' ? (
          <InventoryGrid
            onToast={showToast}
            onOpenScanner={() => setScannerOpen(true)}
            scannedBarcode={scannedBarcode}
          />
        ) : activeSection === 'import' ? (
          <ImportWorkbench
            initialMode={importInitialMode}
            onToast={showToast}
            onNavigateInventory={() => setActiveSection('inventory')}
            onNavigateSettings={() => setActiveSection('settings')}
          />
        ) : activeSection === 'enrichment' ? (
          <EnrichmentQueue onToast={showToast} />
        ) : activeSection === 'pricing' ? (
          <PricingReview onToast={showToast} />
        ) : activeSection === 'analytics' ? (
          <SalesAnalytics
            onNavigateImport={() => setActiveSection('import')}
            onNavigatePricing={() => setActiveSection('pricing')}
            onNavigateInventory={() => setActiveSection('inventory')}
            onToast={showToast}
          />
        ) : activeSection === 'suggestions' ? (
          <ProductSuggestions
            onNavigateInventory={() => setActiveSection('inventory')}
            onToast={showToast}
          />
        ) : activeSection === 'exports' ? (
          <ExportsPushCenter
            onNavigateEnrichment={() => setActiveSection('enrichment')}
            onToast={showToast}
          />
        ) : (
          <PhaseRoadmapView
            section={activeSection}
            onReturnToInventory={() => setActiveSection('inventory')}
            onNavigateImport={() => setActiveSection('import')}
            onNavigateExports={() => setActiveSection('exports')}
            onToast={showToast}
          />
        )}
      </AppShell>
      <BarcodeScannerModal
        open={scannerOpen}
        onDetected={handleGlobalBarcodeDetected}
        onClose={() => setScannerOpen(false)}
      />
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <OperationsConsole />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
