import React, { useState } from 'react';
import { Lock, Sun, Moon, ArrowRight, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiConfig } from '../api/client';

export function LoginGate() {
  const { login, loginWithGoogle } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Enter your store email address.');
      return;
    }
    if (!passcode.trim()) {
      setError('Enter your store passcode.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, passcode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in could not be completed.';
      if (!msg.includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const fillDemoCredentials = () => {
    setEmail('owner@777liquor.com');
    setPasscode('777931');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="w-full px-6 py-4 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          <div className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            inventory.777liquor.com
          </div>
          <span className="hidden sm:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
            ·
          </span>
          <a
            href="https://777liquor.com"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 transition-colors whitespace-nowrap"
          >
            <span>777liquor.com</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {theme === 'light' ? (
            <>
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Dark mode</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Light mode</span>
            </>
          )}
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8">
          <div className="mb-6">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              777 Liquor Grocery &amp; Gift Shop · 931 University Ave, Honolulu
            </p>
            <h1 className="mt-2 text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Sign in to Inventory Console
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              Authorized staff access for Clover-to-Toast catalog sync and shelf pricing.
            </p>
          </div>

          <button
            type="button"
            disabled={googleSubmitting || submitting}
            onClick={() => void handleGoogleSignIn()}
            data-testid="google-signin-btn"
            className="w-full h-11 px-4 inline-flex items-center justify-center gap-2.5 text-sm font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60 cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.29A7.21 7.21 0 0 1 4.9 12c0-.79.14-1.56.38-2.29V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1z"
              />
              <path
                fill="#EA4335"
                d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1c.95-2.84 3.6-4.95 6.72-4.95z"
              />
            </svg>
            <span>{googleSubmitting ? 'Connecting Google Account…' : 'Continue with Google (Cloud Sync)'}</span>
          </button>

          <div className="my-5 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            <span>or sign in with counter passcode</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Store Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@777liquor.com"
                className="w-full h-11 px-3.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="login-passcode"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Passcode
              </label>
              <input
                id="login-passcode"
                name="passcode"
                type="password"
                autoComplete="current-password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter counter passcode"
                className="w-full h-11 px-3.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="px-3.5 py-2.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || googleSubmitting}
              className="w-full h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-md bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white transition-colors disabled:opacity-60 cursor-pointer"
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
              <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <span>{apiConfig.useMockApi ? 'Mock API Session' : 'Cloudflare Worker Auth'}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">inventory.777liquor.com</span>
            </div>
            {apiConfig.useMockApi && (
              <button
                type="button"
                onClick={fillDemoCredentials}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Fill Demo Login
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
