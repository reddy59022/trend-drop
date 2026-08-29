import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import api from '../services/api';
import { isNative, platform } from '../services/native';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (token) {
      try {
        const res = await api.get('/auth/me');
        setUser(res.data);
      } catch (error) {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
      }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const register = async (formData) => {
    const config = {
      headers: { 'Content-Type': 'multipart/form-data' },
    };
    const res = await api.post('/auth/register', formData, config);
    // Registration returns { message, emailSent, userId } - no token yet.
    // Token is obtained after email verification and login.
    // Do NOT store undefined token in localStorage or state.
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  // ============================================================
  // Push notification registration (iOS/Android only).
  // Registered token is POSTed to /api/mobile/push-token and
  // stored on the user's MobilePreferences record.
  // ============================================================
  const registerPushToken = async () => {
    if (!isNative()) return null;
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return null;
      await PushNotifications.register();
      return await new Promise((resolve) => {
        const finished = (val) => { resolve(val); };
        PushNotifications.addListener('registration', (token) => {
          const t = token?.value;
          if (t) {
            api.post('/mobile/push-token', {
              token: t,
              platform: platform(),
              deviceId: t,
              appVersion: '1.0.0',
            }).catch(() => {});
          }
          finished(t);
        });
        // Timeout in case registration never fires
        setTimeout(() => finished(null), 8000);
      });
    } catch (e) {
      console.warn('Push registration failed:', e.message);
      return null;
    }
  };

  // Listen for 401 unauthorized events dispatched by the API interceptor.
  // On web the interceptor does a hard redirect; on native iOS/Android it
  // relies on this listener to clear auth state so React Router redirects
  // to /login (a hard redirect would hit a non-existent WebView path).
  useEffect(() => {
    const onUnauthorized = () => {
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
    };
    window.addEventListener('auth-unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth-unauthorized', onUnauthorized);
  }, []);

  const updateProfile = async (data) => {
    const res = await api.put('/auth/profile', data);
    setUser(res.data);
    return res.data;
  };

  const updateAvatar = async (formData) => {
    const config = {
      headers: { 'Content-Type': 'multipart/form-data' },
    };
    const res = await api.put('/auth/avatar', formData, config);
    setUser(res.data);
    return res.data;
  };

  // Helper: POST an OAuth payload to the server auth endpoint.
  // The server endpoints (/api/auth/google|apple|facebook) are POST-only,
  // so we must exchange the SDK-produced token here — never navigate away.
  const exchangeOAuthToken = async (url, payload) => {
    const res = await api.post(url, payload);
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  // Dynamically load an external OAuth SDK script (works in browser AND
  // Capacitor WebView on iOS/Android).
  const loadScript = (src, id) =>
    new Promise((resolve, reject) => {
      if (document.getElementById(id)) return resolve();
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

  // ============================================================
  // Native OAuth (iOS/Android): popup/full-page OAuth flows are
  // unreliable inside a Capacitor WebView. Instead we open the
  // provider's consent screen with the system Browser plugin and
  // listen for the deep-link callback that App.js forwards here
  // as a window 'oauth-callback' CustomEvent carrying the token.
  // ============================================================
  const [oauthListeners, setOauthListeners] = useState({});

  const openNativeOAuth = (url, key) =>
    new Promise((resolve, reject) => {
      const onCallback = (event) => {
        const rawUrl = event?.detail?.url || event?.url || '';
        if (!rawUrl) return;
        const url = rawUrl;
        let token = null;
        try {
          const parsed = new URL(url);
          token =
            parsed.searchParams.get('token') ||
            parsed.hash?.split('token=')[1]?.split('&')[0] ||
            parsed.searchParams.get('id_token') ||
            null;
        } catch (e) {
          /* ignore malformed url */
        }
        if (token) {
          window.removeEventListener('oauth-callback', onCallback);
          setOauthListeners((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          resolve(token);
        }
      };
      window.addEventListener('oauth-callback', onCallback);
      setOauthListeners((prev) => ({ ...prev, [key]: { resolve, reject } }));

      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url, presentationStyle: 'popover' }))
        .catch((e) => {
          window.removeEventListener('oauth-callback', onCallback);
          setOauthListeners((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          reject(new Error('Native OAuth is not available. Try a different login method.'));
        });

      // Safety timeout so a cancelled flow doesn't hang
      setTimeout(() => {
        window.removeEventListener('oauth-callback', onCallback);
        resolve(null);
      }, 120000);
    });

  const loginWithGoogle = async () => {
    const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google login is not configured. Set REACT_APP_GOOGLE_CLIENT_ID.');
    }

    if (isNative()) {
      const redirectUri = process.env.REACT_APP_NATIVE_REDIRECT_URI || 'trenddrop://oauth-callback';
      const scope = encodeURIComponent('openid email profile');
      const nonce = Math.random().toString(36).slice(2);
      const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=id_token token&scope=${scope}&nonce=${nonce}`;
      const idToken = await openNativeOAuth(url, 'google');
      const { email, name } = decodeJwtPayload(idToken);
      return exchangeOAuthToken('/auth/google', { idToken, email, name });
    }

    await loadScript('https://accounts.google.com/gsi/client', 'gsi-client');

    const idToken = await new Promise((resolve, reject) => {
      if (!window.google?.accounts?.id) {
        reject(new Error('Google Identity Services failed to load'));
        return;
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (response?.credential) {
            resolve(response.credential);
          } else {
            reject(new Error('Google sign-in was cancelled or failed'));
          }
        },
        auto_select: false,
      });
      window.google.accounts.id.prompt();
    });

    const { email, name } = decodeJwtPayload(idToken);
    return exchangeOAuthToken('/auth/google', { idToken, email, name });
  };

  const loginWithApple = async () => {
    const clientId = process.env.REACT_APP_APPLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('Apple Sign-In is not configured. Set REACT_APP_APPLE_CLIENT_ID.');
    }

    if (isNative()) {
      const redirectUri = process.env.REACT_APP_NATIVE_REDIRECT_URI || 'trenddrop://oauth-callback';
      const scope = encodeURIComponent('name email');
      const url = `https://appleid.apple.com/auth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=id_token&scope=${scope}`;
      const identityToken = await openNativeOAuth(url, 'apple');
      const { email, name } = decodeJwtPayload(identityToken);
      return exchangeOAuthToken('/auth/apple', { identityToken, email, name });
    }

    try {
      await loadScript(
        'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
        'apple-auth-js'
      );
    } catch (e) {
      throw new Error('Apple Sign-In is not available on this browser.');
    }

    const redirectURI =
      process.env.REACT_APP_APPLE_REDIRECT_URI || window.location.origin;
    window.AppleID.auth.init({
      clientId,
      scope: 'name email',
      redirectURI,
      usePopup: true,
    });

    const response = await window.AppleID.auth.signIn();
    const identityToken = response?.authorization?.id_token;
    if (!identityToken) {
      throw new Error('Apple Sign-In returned no identity token');
    }

    let email = '';
    let name = '';
    const userInfo = response?.user;
    if (userInfo?.email) email = userInfo.email;
    if (userInfo?.name) {
      name = [userInfo.name.firstName, userInfo.name.lastName]
        .filter(Boolean)
        .join(' ');
    }
    // Decode payload for email when user info isn't returned (subsequent sign-ins)
    const decoded = decodeJwtPayload(identityToken);
    if (!email) email = decoded.email || '';
    if (!name) name = decoded.name || '';

    return exchangeOAuthToken('/auth/apple', { identityToken, email, name });
  };

  const loginWithFacebook = async () => {
    try {
      await loadScript('https://connect.facebook.net/en_US/sdk.js', 'fb-jssdk');
    } catch (e) {
      throw new Error('Facebook Login is not available on this browser.');
    }

    const appId = process.env.REACT_APP_FACEBOOK_APP_ID;
    if (!appId) {
      throw new Error(
        'Facebook Login is not configured. Set REACT_APP_FACEBOOK_APP_ID.'
      );
    }
    if (!window.FB) {
      throw new Error('Facebook SDK failed to load.');
    }

    // Async initialise (needed for FB.login to be allowed)
    await new Promise((resolve) => {
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: 'v19.0',
      });
      window.FB.getLoginStatus(() => resolve());
    });

    const accessToken = await new Promise((resolve, reject) => {
      window.FB.login(
        (response) => {
          if (response?.authResponse?.accessToken) {
            resolve(response.authResponse.accessToken);
          } else {
            reject(new Error('Facebook login was cancelled or failed'));
          }
        },
        { scope: 'email,public_profile' }
      );
    });

    // Fetch email + name from Graph API
    let email = '';
    let name = '';
    try {
      const me = await new Promise((resolve) => {
        window.FB.api('/me?fields=id,name,email', (res) => resolve(res));
      });
      email = me?.email || '';
      name = me?.name || '';
    } catch (e) {
      /* fall back to server-side data */
    }

    return exchangeOAuthToken('/auth/facebook', { accessToken, email, name });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        updateProfile,
        updateAvatar,
        loginWithGoogle,
        loginWithApple,
        loginWithFacebook,
        registerPushToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Decode a JWT payload locally (email + name + sub) without verifying.
// The server always re-verifies the token, so this is display-only.
const decodeJwtPayload = (jwt) => {
  if (!jwt) return { email: '', name: '' };
  try {
    const payload = JSON.parse(
      atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return {
      email: payload.email || '',
      name: payload.name || '',
    };
  } catch (e) {
    return { email: '', name: '' };
  }
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};