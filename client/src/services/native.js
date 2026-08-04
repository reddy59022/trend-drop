import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => (isNative() ? Capacitor.getPlatform() : 'web');

/** Pick/take an image natively. Falls back to a file input on web. */
export const pickImage = async ({ source = CameraSource.Prompt } = {}) => {
  if (!isNative()) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result, file });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source,
      quality: 85,
    });
    return { dataUrl: photo.dataUrl, file: null };
  } catch (err) {
    if (err && err.message && err.message.includes('cancel')) return null;
    throw err;
  }
};

export const shareItem = async ({ title, text, url }) => {
  try {
    if (isNative()) {
      await Share.share({ title, text, url, dialogTitle: 'Share' });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    // Fallback: copy the link. Use the cross-platform copyText (works on
    // iOS/Android WebViews where navigator.clipboard may be unavailable).
    return copyText(url || text || '');
  } catch (err) {
    if (err && err.name !== 'AbortError') console.warn('Share failed:', err);
    return false;
  }
};

export const hapticTap = async () => {
  try {
    if (isNative()) await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* plugin not registered */ }
};

export const hapticSuccess = async () => {
  try {
    if (isNative()) await Haptics.notification({ type: 'SUCCESS' });
  } catch { /* plugin not registered */ }
};

export const setStatusBarColor = async (color, { light = false } = {}) => {
  try {
    if (isNative()) {
      await StatusBar.setBackgroundColor({ color });
      await StatusBar.setStyle({ style: light ? 'LIGHT' : 'DARK' });
    }
  } catch { /* plugin not registered */ }
};

export const getPlatformInfo = () => ({ platform: platform(), isNative: isNative() });

/**
 * Copy text to the clipboard across ALL platforms.
 *
 * iOS WKWebView and older Android WebViews do not reliably expose
 * `navigator.clipboard.writeText` (it can be undefined or reject with
 * NotAllowedError outside of a user gesture). Falls back to a hidden
 * textarea + document.execCommand('copy'), which works on iOS/Android
 * WebViews AND all desktop/mobile browsers.
 */
export const copyText = async (text) => {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // Fall through to the execCommand fallback (permission / gesture issues)
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/**
 * Prompt for a short text input across all platforms.
 *
 * `window.prompt()` is silently blocked inside the iOS/Android Capacitor
 * WebView (always returns null), making flows like "deny reason",
 * "return tracking number" impossible on native. This returns a Promise.
 * IMPORTANT: The caller MUST render the returned { element } inside its own
 * JSX to display the prompt UI. Simpler pages prefer the dedicated
 * <PromptModal> component (see OrderDetail.js / ReturnsCenter.js).
 */
export const promptText = (opts = {}) => {
  const { title = 'Enter value', placeholder = '', initialValue = '', confirmLabel = 'OK' } = opts;
  if (!isNative()) {
    const value = window.prompt(title, initialValue);
    return Promise.resolve({ ok: value !== null, value: value === null ? '' : value });
  }
  // Native: render a React modal into a detached host element for the caller.
  const React = require('react');
  const { createElement, useState } = React;
  const ReactDOM = require('react-dom/client');
  const modalHost = document.createElement('div');
  modalHost.style.position = 'fixed';
  modalHost.style.inset = '0';
  modalHost.style.zIndex = '30000';
  modalHost.style.background = 'rgba(8,8,26,0.6)';
  modalHost.style.display = 'flex';
  modalHost.style.alignItems = 'center';
  modalHost.style.justifyContent = 'center';
  modalHost.style.padding = '16px';
  document.body.appendChild(modalHost);

  return new Promise((resolve) => {
    let root;
    const cleanup = () => {
      if (root) { try { root.unmount(); } catch (e) { /* already unmounted */ } }
      if (modalHost.parentNode) modalHost.parentNode.removeChild(modalHost);
    };

    const PromptModal = () => {
      const [value, setValue] = useState(initialValue);
      return createElement(
        'div',
        {
          style: {
            width: '100%', maxWidth: 420, padding: 'var(--td-space-lg)',
            background: 'var(--td-surface)', borderRadius: 'var(--td-radius-md)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          },
          onClick: (e) => e.stopPropagation(),
        },
        createElement('h3', { style: { fontWeight: 700, marginBottom: 12, fontSize: 16 } }, title),
        createElement('textarea', {
          className: 'form-input',
          placeholder: placeholder || '',
          value,
          onChange: (e) => setValue(e.target.value),
          rows: 3,
          style: { width: '100%', marginBottom: 12, resize: 'vertical', minHeight: 80 },
        }),
        createElement(
          'div',
          { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
          createElement(
            'button',
            { className: 'btn btn-outline btn-sm', onClick: () => { cleanup(); resolve({ ok: false, value: '' }); } },
            'Cancel'
          ),
          createElement(
            'button',
            {
              className: 'btn btn-primary btn-sm',
              onClick: () => { cleanup(); resolve({ ok: true, value: value.trim() }); },
            },
            confirmLabel
          )
        )
      );
    };

    // Close on backdrop click (ignore clicks on the modal itself)
    modalHost.addEventListener('click', (e) => {
      if (e.target === modalHost) { cleanup(); resolve({ ok: false, value: '' }); }
    });
    root = ReactDOM.createRoot(modalHost);
    root.render(createElement(PromptModal));
  });
};

/** True if matchMedia exists (native WebViews may not expose it). */
export const supportsMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
