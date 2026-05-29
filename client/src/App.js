import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

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
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

export default App;