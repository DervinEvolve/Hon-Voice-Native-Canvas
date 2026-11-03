import React, { createContext, useContext, ReactNode } from 'react';
import { useAuth0, User, Auth0ContextInterface } from '@auth0/auth0-react';

interface AuthContextType extends Omit<Auth0ContextInterface<User>, 'user'> {
  user: User | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const auth0 = useAuth0();

  const value: AuthContextType = {
    ...auth0,
    user: auth0.user || null,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 