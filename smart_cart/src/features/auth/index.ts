import { getSupabase } from '../../lib/supabase';
import { createAuthService } from './service';

/** Wspólny moduł operacji; AuthProvider/useAuth zostaną podłączone w punkcie 4. */
export const authService = createAuthService(() => getSupabase()?.auth ?? null);
export { authPolicy } from './service';
export type * from './types';
