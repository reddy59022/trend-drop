import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';

/**
 * Cross-platform confirm dialog.
 *
 * WHY: `window.confirm()` / `window.prompt()` are silently disabled inside the
 * iOS WKWebView and Android WebView (they return `false` / `null` immediately
 * without showing any UI). That made destructive actions (delete account,
 * delete listing, force refund, cancel subscription, …) impossible on native
 * platforms.
 *
 * This context renders an in-page modal that works identically on Web, iOS and
 * Android. Usage (inside any component):
 *
 *   const confirmDialog = useConfirm();
 *   const ok = await confirmDialog({ title, message, confirmLabel, danger });
 *   if (!ok) return;
 */
const ConfirmContext = createContext(null);

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
};

export const ConfirmProvider = ({ children }) => {
  const [state, setState] = useState(null); // { title, message, confirmLabel, cancelLabel, danger, resolve }
  const resolveRef = useRef(null);

  const confirmDialog = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        title: opts.title || 'Are you sure?',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        danger: !!opts.danger,
      });
    });
  }, []);

  const close = useCallback((result) => {
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirmDialog}>
      {children}
      {state && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 20000,
            background: 'rgba(8,8,26,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, WebkitTapHighlightColor: 'transparent',
          }}
          onClick={() => close(false)}
        >
          <div
            className="glass-card"
            style={{ width: '100%', maxWidth: 420, padding: 'var(--td-space-lg)' }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
          >
            <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              {state.danger && <FaExclamationTriangle size={16} style={{ color: 'var(--td-error)' }} />}
              {state.title}
            </h3>
            {state.message && (
              <p style={{ fontSize: 14, color: 'var(--td-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                {state.message}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => close(false)}>
                {state.cancelLabel}
              </button>
              <button
                className="btn btn-sm"
                style={state.danger ? { background: 'var(--td-error)', color: '#fff' } : undefined}
                onClick={() => close(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

export default ConfirmProvider;