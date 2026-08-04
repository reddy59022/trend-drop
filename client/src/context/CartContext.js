import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import api from '../services/api';
import { toast } from 'react-toastify';

// Cart item shape (local, source of truth for the UI):
// {
//   listingId: string,
//   title: string,
//   price: number,
//   currency: string,
//   quantity: number,
//   thumbnail: string,
//   available: number,   // max stock available
//   sellerId: string,    // optional
//   sellerName: string,  // optional
//   sellerCountry: string,
//   weight: number,
//   negotiatedPrice: number
// }

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

// Map a server cart item (populated listing) into the local app cart shape
const toLocalItem = (serverItem) => {
  const listing = serverItem.listing || {};
  return {
    listingId: String(listing._id || serverItem.listing || serverItem._id),
    title: listing.title || 'Item',
    price: listing.price || 0,
    currency: listing.currency || 'USD',
    quantity: serverItem.quantity || 1,
    thumbnail: (listing.images && listing.images[0]) || '/placeholder.png',
    available: listing.available ?? Infinity,
    sellerId: listing.seller?._id || listing.seller,
    sellerName: listing.seller?.name,
    sellerCountry: listing.shipsFrom || 'US',
    weight: listing.weight,
    serverSynced: true,
  };
};

export const CartProvider = ({ children }) => {
  const { user, token } = useAuth();
  const isAuthed = Boolean(user);
  const lastSyncedUser = useRef(null);

  // Initialise cart from localStorage to survive page reloads (guest & logged-out)
  const [cart, setCart] = useState(() => {
    try {
      const stored = localStorage.getItem('cart');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [synced, setSynced] = useState(false);

  // Persist cart changes back to localStorage (always keep a local fallback copy)
  useEffect(() => {
    try {
      localStorage.setItem('cart', JSON.stringify(cart));
    } catch { /* storage full / private mode */ }
  }, [cart]);

  // ===== Server sync helpers =====
  const fetchServerCart = useCallback(async () => {
    const res = await api.get('/cart');
    const items = (res.data.cart?.items || []).filter(i => i.listing).map(toLocalItem);
    return items;
  }, []);

  const syncCartFromServer = useCallback(async () => {
    if (!isAuthed) {
      setSynced(false);
      return;
    }
    try {
      const serverItems = await fetchServerCart();
      setCart(prev => {
        // Merge: server wins, but keep any local-only items and push them to server below
        const serverMap = new Map(serverItems.map(i => [i.listingId, i]));
        const merged = [...serverItems];
        const localOnly = [];
        for (const item of prev) {
          if (!serverMap.has(item.listingId)) localOnly.push(item);
        }
        for (const item of localOnly) {
          merged.push(item);
        }
        setSynced(true);

        // Push local-only items up to the server (in background)
        if (localOnly.length > 0) {
          localOnly.forEach(item => {
            api.post('/cart/items', { listingId: item.listingId, quantity: item.quantity }).catch(() => {});
          });
        }
        return merged;
      });
    } catch {
      // Server unavailable — keep local cart and mark unsynced
      setSynced(false);
    }
  }, [isAuthed, fetchServerCart]);

  // Sync when auth state changes (login / logout / user object loads)
  useEffect(() => {
    const userId = user?._id || user?.id || 'guest';
    if (lastSyncedUser.current === userId) return;
    lastSyncedUser.current = userId;
    if (isAuthed) {
      syncCartFromServer();
    } else {
      // On logout keep the local guest cart as-is
      setSynced(false);
    }
  }, [isAuthed, user, syncCartFromServer]);

  // Add an item or increase quantity if it already exists
  const addToCart = (item) => {
    if (!item?.listingId) return;

    setCart((prev) => {
      const existing = prev.find((i) => i.listingId === item.listingId);
      const next = existing
        ? prev.map((i) =>
            i.listingId === item.listingId
              ? { ...i, quantity: Math.min(i.available ?? Infinity, i.quantity + item.quantity) }
              : i
          )
        : [...prev, { ...item }];

      // Sync to server when authenticated
      if (isAuthed) {
        api.post('/cart/items', { listingId: item.listingId, quantity: item.quantity || 1 })
          .then(async () => {
            // Re-pull the canonical cart so quantities stay correct
            try {
              const serverItems = await fetchServerCart();
              setCart(serverItems);
            } catch { /* ignore */ }
          })
          .catch(err => {
            toast.error(err.response?.data?.message || 'Could not add item to cart');
            // Roll back to server state
            syncCartFromServer();
          });
      }
      return next;
    });
  };

  // Remove an item completely from the cart
  const removeFromCart = (listingId) => {
    setCart((prev) => prev.filter((i) => i.listingId !== listingId));
    if (isAuthed) {
      api.delete(`/cart/items/${listingId}`).catch(() => syncCartFromServer());
    }
  };

  // Update the quantity of a specific cart entry
  const updateQuantity = (listingId, quantity) => {
    const qty = Math.max(1, quantity);
    setCart((prev) => prev.map((i) => (i.listingId === listingId ? { ...i, quantity: qty } : i)));
    if (isAuthed) {
      api.post('/cart/items', { listingId, quantity: qty }).catch(() => syncCartFromServer());
    }
  };

  // Empty the entire cart (local) + remove each server item
  const clearCart = () => {
    setCart((prev) => {
      // Snapshot the items being removed INSIDE the state updater so it's
      // always the latest list — no stale render-scope closure (the cart may
      // have just been mutated by checkout/promo flows).
      const itemsToRemove = prev;
      if (isAuthed && itemsToRemove.length > 0) {
        // No bulk DELETE endpoint — remove each item individually
        itemsToRemove.forEach((item) => {
          api.delete(`/cart/items/${item.listingId}`).catch(() => {});
        });
      }
      return [];
    });
  };

  // Explicit refresh from the server (used after checkout / promotions)
  const refreshCart = useCallback(async () => {
    if (isAuthed) {
      try {
        const serverItems = await fetchServerCart();
        setCart(serverItems);
        setSynced(true);
      } catch {
        setSynced(false);
      }
    }
  }, [isAuthed, fetchServerCart]);

  // Compute the total amount for the current cart
  const totalAmount = cart.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
  const itemCount = cart.reduce((sum, i) => sum + (i.quantity || 1), 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        refreshCart,
        totalAmount,
        itemCount,
        synced,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};