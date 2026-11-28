import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
 *
 * It behaves like a modal for keyboard and screen-reader users: the dialog is
 * named by its title, focus moves to Cancel (the safe choice) on open, Tab is
 * trapped, Escape cancels, and focus returns to whatever opened it.
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
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const open = Boolean(state);

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

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = dialogRef.current.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const opener = restoreFocusRef.current;
      // The row an action came from is usually replaced by the refetch that
      // follows, so fall back to the main landmark rather than dropping focus
      // on <body>.
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus();
      } else {
        const main = document.querySelector('main');
        if (main) {
          if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
          main.focus({ preventScroll: true });
        }
      }
    };
  }, [open, close]);

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
            ref={dialogRef}
            className="glass-card"
            style={{ width: '100%', maxWidth: 420, padding: 'var(--td-space-lg)' }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="td-confirm-title"
            aria-describedby={state.message ? 'td-confirm-message' : undefined}
          >
            <h3 id="td-confirm-title" style={{ fontWeight: 700, marginBottom: 12, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              {state.danger && <FaExclamationTriangle size={16} style={{ color: 'var(--td-error)' }} aria-hidden="true" />}
              {state.title}
            </h3>
            {state.message && (
              <p id="td-confirm-message" style={{ fontSize: 14, color: 'var(--td-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                {state.message}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button ref={cancelRef} type="button" className="btn btn-outline btn-sm" onClick={() => close(false)}>
                {state.cancelLabel}
              </button>
              <button
                type="button"
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
