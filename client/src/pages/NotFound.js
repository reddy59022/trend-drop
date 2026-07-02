import React from 'react';
import { Link } from 'react-router-dom';
import { FaHome, FaSearch } from 'react-icons/fa';

const NotFound = () => {
  return (
    <div className="page-container" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '60vh',
      textAlign: 'center',
      padding: '40px 20px'
    }}>
      <div style={{ fontSize: 80, marginBottom: 16, lineHeight: 1 }}>🔍</div>
      <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 8, color: 'var(--td-primary)' }}>404</h1>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>Page Not Found</h2>
      <p style={{ fontSize: 16, color: 'var(--td-text-tertiary)', maxWidth: 400, marginBottom: 32 }}>
        The page you're looking for doesn't exist or has been moved. 
        Let's get you back on track!
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/" className="btn btn-primary btn-lg" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FaHome /> Go Home
        </Link>
        <Link to="/search" className="btn btn-outline btn-lg" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FaSearch /> Browse Listings
        </Link>
      </div>
    </div>
  );
};

export default NotFound;