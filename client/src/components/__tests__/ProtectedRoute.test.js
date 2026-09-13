import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../services/api');
import { setAuth, resetTestState, authUser } from '../../test-utils';
import ProtectedRoute from '../ProtectedRoute';

beforeEach(() => { resetTestState(); setAuth(null); });

describe('ProtectedRoute', () => {
  const renderRoute = (role) => render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/secret" element={<ProtectedRoute requiredRole={role}><div data-testid="child">secret</div></ProtectedRoute>} />
        <Route path="/login" element={<div data-testid="login">login</div>} />
        <Route path="/" element={<div data-testid="home">home</div>} />
      </Routes>
    </MemoryRouter>
  );
  test('unauthenticated users are redirected to /login', () => {
    renderRoute();
    expect(screen.getByTestId('login')).toBeInTheDocument();
  });
  test('authenticated users see the children', () => {
    setAuth(authUser());
    renderRoute();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
  test('a suspended user is redirected to /login', () => {
    setAuth(authUser({ role: 'suspended' }));
    renderRoute();
    expect(screen.getByTestId('login')).toBeInTheDocument();
  });
  test('role-restricted routes deny under-privileged users', () => {
    setAuth(authUser({ role: 'user' }));
    renderRoute('admin');
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });
  test('admin users pass an admin-only route', () => {
    setAuth(authUser({ role: 'admin' }));
    renderRoute('admin');
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
