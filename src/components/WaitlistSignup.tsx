import React, { useState } from 'react';
import { waitlistService } from '../services/waitlistService';

interface WaitlistSignupProps {
  onSuccess?: () => void;
}

export const WaitlistSignup: React.FC<WaitlistSignupProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await waitlistService.addToWaitlist(
        email.trim().toLowerCase(),
        role || 'creator', 
        'login_page_waitlist'
      );

      if (result.success) {
        setIsSubmitted(true);
        onSuccess?.();
      } else {
        // Check if it's a duplicate entry error
        if (result.error?.code === '23505' || 
            result.error?.status === 409 ||
            result.error?.message?.includes('already exists') ||
            result.error?.message?.includes('duplicate')) {
          // Treat duplicate as success since they're already on the list
          setIsSubmitted(true);
          onSuccess?.();
        } else {
          setError('Failed to join waitlist. Please try again.');
        }
        console.error('Waitlist error details:', result.error);
      }
    } catch (err: any) {
      console.error('Waitlist signup error:', err);
      
      // Handle network-level 409 conflicts
      if (err?.status === 409 || 
          err?.code === '23505' ||
          err?.message?.includes('already exists') ||
          err?.message?.includes('duplicate')) {
        // Treat as success - they're already on the list
        setIsSubmitted(true);
        onSuccess?.();
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="space-y-6 sm:space-y-8 text-center">
        <div className="space-y-4">
          <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-white">You're on the list!</h3>
          <p className="text-white/70 text-sm sm:text-base">
            Thank you for your interest in Hon! We'll notify you as soon as we launch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Waitlist Form */}
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-[18px]">
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[rgba(7,10,13,0.8)] text-white placeholder-white/70 rounded-full border-none outline-none focus:ring-2 focus:ring-purple-500 transition-all text-sm sm:text-base"
            required
          />
          
                      <select 
              value={role} 
              onChange={(e) => setRole(e.target.value)}
              className="w-full h-20 sm:h-24 px-6 sm:px-[30px] py-6 sm:py-8 bg-[rgba(7,10,13,0.8)] text-white rounded-full border-none outline-none focus:ring-2 focus:ring-purple-500 transition-all text-base sm:text-lg leading-relaxed"
              style={{
                color: role ? 'white' : 'white',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 2rem center',
                backgroundSize: '1.25rem',
                paddingRight: '4rem',
                minHeight: '80px',
                fontSize: '18px',
                lineHeight: '1.6'
              }}
            >
            <option value="" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>What best describes you?</option>
            <option value="creator" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Content Creator</option>
            <option value="artist" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Digital Artist</option>
            <option value="writer" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Writer/Storyteller</option>
            <option value="filmmaker" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Filmmaker</option>
            <option value="designer" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Designer</option>
            <option value="developer" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Developer</option>
            <option value="educator" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Educator</option>
            <option value="student" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Student</option>
            <option value="other" style={{ color: 'white', backgroundColor: 'rgba(7,10,13,0.95)' }}>Other</option>
          </select>
          
          {error && (
            <div className="text-red-400 text-sm text-center bg-red-500/10 rounded-lg px-4 py-2">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            disabled={isLoading || !email}
            className="w-full h-12 sm:h-[50px] px-6 sm:px-[30px] py-4 sm:py-5 bg-[#872CFF] hover:bg-[#7A25E6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full border border-[#6f00ff] transition-all text-base sm:text-[20px] flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Joining...
              </>
            ) : (
              'Join the waitlist'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}; 