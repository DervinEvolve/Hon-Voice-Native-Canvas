import { useEffect } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { Creator } from './components/Creator';
import { useComicStore } from './store/useComicStore';
import { Comic } from './types';
import { nanoid } from 'nanoid';
import { useAuth } from './contexts/AuthContext';
import { LoginOptions } from './components/auth/LoginOptions';
import Login from './components/Login';
import { ThemeProvider } from './contexts/ThemeContext';
import { CollaborationProvider } from './contexts/CollaborationContext';

// Protected route wrapper component
const ProtectedRoute: React.FC<{ children: React.ReactNode; requireWallet?: boolean }> = ({ 
  children, 
  requireWallet = false 
}) => {
  const { isAuthenticated, user } = useAuth();
  
  if (!isAuthenticated || (requireWallet && !user?.wallet)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-8">
        <h2 className="text-2xl font-bold text-white mb-4">
          {!isAuthenticated 
            ? 'Sign In or Connect Wallet' 
            : 'Connect Your Wallet'}
        </h2>
        <p className="text-gray-400 mb-6">
          {!isAuthenticated 
            ? 'Please sign in with your preferred method' 
            : 'Please connect your wallet to access this feature'}
        </p>
        <LoginOptions />
        {!isAuthenticated && (
          <Link to="/login" className="mt-6 text-sm text-gray-400 underline hover:text-white">
            More sign-in options
          </Link>
        )}
      </div>
    );
  }

  return <>{children}</>;
};

// The canvas opens on an empty draft board when none is loaded.
const CanvasEntry: React.FC = () => {
  const { currentComic, initializeComic } = useComicStore();

  useEffect(() => {
    if (currentComic) return;
    const newComic: Comic = {
      id: `draft-${nanoid()}`,
      title: 'Untitled Comic',
      creator: 'Anonymous',
      creatorWallet: 'placeholder-wallet-address',
      coverImage: '',
      coverType: 'image' as const,
      pages: [[]],
      pageTemplates: [],
      narrations: {},
      createdAt: new Date(),
      lastModified: new Date()
    };
    initializeComic(newComic);
  }, [currentComic, initializeComic]);

  return <Creator />;
};

// Wrap the canvas with the collaboration provider
const CollaborativeCreator: React.FC = () => (
  <ProtectedRoute>
    <CollaborationProvider>
      <CanvasEntry />
    </CollaborationProvider>
  </ProtectedRoute>
);

const AppContent = () => {
  const { isAuthenticated } = useAuth();

  return (
    <ThemeProvider>
      <div className="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
        <Routes>
          <Route path="/" element={<CollaborativeCreator />} />
          <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </ThemeProvider>
  );
};

function App() {
  return (
    <AppContent />
  );
}

export default App;
