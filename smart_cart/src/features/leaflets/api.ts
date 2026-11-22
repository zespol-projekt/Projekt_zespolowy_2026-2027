import { authService } from '@/features/auth/instance';
import { fetchLeaflets } from './transport';
export const loadLeaflets = (signal: AbortSignal) => fetchLeaflets(
  process.env.EXPO_PUBLIC_LEAFLETS_API_URL, process.env.EXPO_PUBLIC_SUPABASE_URL, authService, signal,
);
