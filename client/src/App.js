import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import MobileTabBar from './components/MobileTabBar';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';

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
const SellerOnboarding = lazy(() => import('./pages/SellerOnboarding'));
const SellerAnalytics = lazy(() => import('./pages/SellerAnalytics'));
const CartPage = lazy(() => import('./pages/Cart'));
const BulkListingManager = lazy(() => import('./pages/BulkListingManager'));
const EditListing = lazy(() => import('./pages/EditListing'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmail'));
const AdminPage = lazy(() => import('./pages/Admin'));
const CollectionsPage = lazy(() => import('./pages/Collections'));
const SavedSearchesPage = lazy(() => import('./pages/SavedSearches'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetail'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));
const PartiesPage = lazy(() => import('./pages/Parties'));
const RecentlyViewedPage = lazy(() => import('./pages/RecentlyViewed'));
const SizeRecommendationPage = lazy(() => import('./pages/SizeRecommendation'));

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
          <ErrorBoundary>
          <Navbar />
          <main className="main-content">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/listing/:id" element={<ListingDetail />} />
                <Route path="/listing/:id/edit" element={<ProtectedRoute><EditListing /></ProtectedRoute>} />
                <Route path="/profile/:id" element={<Profile />} />
                <Route path="/closet/:id" element={<Closet />} />
                <Route path="/search" element={<Search />} />
                <Route path="/reviews/:sellerId" element={<Reviews />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/collections/:sellerId" element={<CollectionsPage />} />

                {/* Auth-required routes */}
                <Route path="/feed" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
                <Route path="/sell" element={<ProtectedRoute><Sell /></ProtectedRoute>} />
                <Route path="/offers" element={<ProtectedRoute><Offers /></ProtectedRoute>} />
                <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
                <Route path="/wishlist" element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
                <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
                <Route path="/cart" element={<ProtectedRoute><CartPage /></ProtectedRoute>} />
                <Route path="/seller-dashboard" element={<ProtectedRoute><SellerDashboard /></ProtectedRoute>} />
                <Route path="/seller/onboarding" element={<ProtectedRoute><SellerOnboarding /></ProtectedRoute>} />
                <Route path="/seller/analytics" element={<ProtectedRoute><SellerAnalytics /></ProtectedRoute>} />
                <Route path="/seller/listings/bulk" element={<ProtectedRoute><BulkListingManager /></ProtectedRoute>} />
                <Route path="/saved-searches" element={<ProtectedRoute><SavedSearchesPage /></ProtectedRoute>} />
                <Route path="/parties" element={<ProtectedRoute><PartiesPage /></ProtectedRoute>} />
<Route path="/recently-viewed" element={<ProtectedRoute><RecentlyViewedPage /></ProtectedRoute>} />
                <Route path="/size-recommendation" element={<ProtectedRoute><SizeRecommendationPage /></ProtectedRoute>} />
                 <Route path="/orders/:id" element={<ProtectedRoute><OrderDetailPage /></ProtectedRoute>} />

                {/* Admin-only routes */}
                <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>} />

                {/* 404 catch-all */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </main>
          <MobileTabBar />
          <Footer />
          </ErrorBoundary>
        </div>
      </CartProvider>
    </ThemeProvider>
  );
}

export default App;