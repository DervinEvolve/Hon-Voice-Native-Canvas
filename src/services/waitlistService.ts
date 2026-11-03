import { supabase } from '../utils/supabaseClient';

export interface WaitlistEntry {
  id?: string;
  email: string;
  role?: string;
  created_at?: string;
  source?: string;
}

const isDuplicateError = (error: any): boolean =>
  error?.status === 409 ||
  error?.code === '23505' ||
  error?.message?.includes('already exists') ||
  error?.message?.includes('duplicate') ||
  error?.message?.includes('violates unique constraint') ||
  error?.details?.includes('already exists');

export const waitlistService = {
  /**
   * Add an email to the waitlist.
   *
   * Browsers can only insert email and source; they cannot read the list back
   * (migrations/harden_live_policies.sql). The insert therefore does not ask
   * for the new row, and there is no duplicate check before it.
   *
   * @param email The email to add
   * @param _role Ignored: the live waitlist table has no role column
   * @param source Source tracking value; the database accepts only
   *   'landing_page' and 'login_page_waitlist'
   * @returns {Promise<{ success: boolean, error?: any }>}
   */
  async addToWaitlist(email: string, _role: string = '', source: string = 'landing_page'): Promise<{ success: boolean; error?: any }> {
    try {
      const { error } = await supabase
        .from('waitlist')
        .insert([{ email, source }]);

      if (error) {
        // An address already on the list counts as success.
        if (isDuplicateError(error)) {
          return { success: true };
        }
        throw error;
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error adding to waitlist:', error);
      if (isDuplicateError(error)) {
        return { success: true };
      }
      return { success: false, error };
    }
  }
};
