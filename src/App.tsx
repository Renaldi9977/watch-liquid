/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ThemeEngine from './components/ThemeEngine';
import Landing from './pages/Landing';
import ProfileSetup from './pages/ProfileSetup';
import Dashboard from './pages/Dashboard';
import Room from './pages/Room';
import { useStore } from './store/useStore';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const profile = useStore((state) => state.profile);
    if (!profile) return <Navigate to="/" replace />;
    return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeEngine />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/profile" element={<ProfileSetup />} />
        <Route path="/dashboard" element={
            <ProtectedRoute><Dashboard /></ProtectedRoute>
        } />
        <Route path="/room/:roomId" element={
            <ProtectedRoute><Room /></ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
