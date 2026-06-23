import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import MobileTabBar from './components/MobileTabBar';

// Performance: Lazy load pages - they only load when navigated to
const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Feed = lazy(() => import('./pages/Feed'));
const Sell = lazy(() => import('./pages/Sell'));
const ListingDetail = lazy(() => import('./pages/ListingDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Closet = lazy(() => import('./pages/Closet'));
const Search = lazy(() => import('./pages/Search'));
const Offers = lazy(() => import('./pages/Offers'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Settings = lazy(() => import('./pages/Settings'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Messages = lazy(() => import('./pages/Messages'));
const Reviews = lazy(() => import('./pages/Reviews'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const SellerDashboard = lazy(() => import('./pages/SellerDashboard'));
const CartPage = lazy(() => import('./pages/Cart'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmail'));
const AdminPage = lazy(() => import('./pages/Admin'));
const CollectionsPage = lazy(() => import('./pages/Collections'));
const SavedSearchesPage = lazy(() => import('./pages/SavedSearches'));

// Performance: Minimal loading component for lazy-loaded pages
const PageLoader = () => (
  <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
    <div className="spinner"></div>
  </div>
);

function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <CartProvider>
        <div className="app">
          <Navbar />
          <main className="main-content">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/sell" element={<Sell />} />
                <Route path="/listing/:id" element={<ListingDetail />} />
                <Route path="/profile/:id" element={<Profile />} />
                <Route path="/closet/:id" element={<Closet />} />
                <Route path="/search" element={<Search />} />
                <Route path="/offers" element={<Offers />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/wishlist" element={<Wishlist />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/reviews/:sellerId" element={<Reviews />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/seller-dashboard" element={<SellerDashboard />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/collections/:sellerId" element={<CollectionsPage />} />
                <Route path="/saved-searches" element={<SavedSearchesPage />} />
              </Routes>
            </Suspense>
          </main>
          <MobileTabBar />
          <Footer />
        </div>
      </CartProvider>
    </ThemeProvider>
  );
}

export default App;