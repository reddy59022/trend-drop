import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ConfirmProvider } from './context/ConfirmContext';
import './styles/globals.css';
import './App.css';
import './styles/append-to-app.css';
import './styles/responsive.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ConfirmProvider>
          <App />
          <ToastContainer position="bottom-right" autoClose={3000} />
        </ConfirmProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
