import React, { createContext, useContext, useEffect, useState } from 'react';

// Cart item shape:
// {
//   listingId: string,
//   title: string,
//   price: number,
//   currency: string,
//   quantity: number,
//   thumbnail: string
// }

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }) => {
  // Initialise cart from localStorage to survive page reloads
  const [cart, setCart] = useState(() => {
    try {
      const stored = localStorage.getItem('cart');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist cart changes back to localStorage
  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
  }, [cart]);

  // Add an item or increase quantity if it already exists
  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.listingId === item.listingId);
      if (existing) {
        return prev.map((i) =>
          i.listingId === item.listingId
            ? { ...i, quantity: i.quantity + item.quantity }
            : i
        );
      }
      return [...prev, { ...item }];
    });
  };

  // Remove an item completely from the cart
  const removeFromCart = (listingId) => {
    setCart((prev) => prev.filter((i) => i.listingId !== listingId));
  };

  // Update the quantity of a specific cart entry
  const updateQuantity = (listingId, quantity) => {
    setCart((prev) =>
      prev.map((i) =>
        i.listingId === listingId ? { ...i, quantity: Math.max(1, quantity) } : i
      )
    );
  };

  // Empty the entire cart
  const clearCart = () => setCart([]);

  // Compute the total amount for the current cart
  const totalAmount = () => cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        totalAmount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};
