import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute - Guards routes that require authentication.
 * Redirects unauthenticated users to /login with the intended destination.
 * Supports role-based access control via the requiredRole prop.
 */
const ProtectedRoute = ({ children, requiredRole }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (!user) {
    // Redirect to login, preserving the intended page
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Check role-based access
  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!roles.includes(user.role)) {
      // User doesn't have the required role - redirect to home
      return <Navigate to="/" replace />;
    }
  }

  // Check if user is suspended
  if (user.role === 'suspended') {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;