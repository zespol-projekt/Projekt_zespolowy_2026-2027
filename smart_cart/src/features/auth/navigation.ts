import { validLeafletId } from '../leaflets/model.ts';
const routes = ['/', '/stores', '/products', '/cart', '/favorites', '/profile', '/settings', '/help', '/rules', '/leaflets'] as const;
export type AppRoute = typeof routes[number] | `/leaflets/${string}`;
let intended: AppRoute | null = null;
let logoutRevision = 0;

export function rememberDestination(pathname: string) {
  if ((routes as readonly string[]).includes(pathname) || (pathname.startsWith('/leaflets/') && validLeafletId(pathname.slice('/leaflets/'.length)))) intended = pathname as AppRoute;
}
export const destination = (): AppRoute => intended ?? '/';
export const logoutVersion = () => logoutRevision;
export function clearDestination() { intended = '/'; logoutRevision += 1; }
