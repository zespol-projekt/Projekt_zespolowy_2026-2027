const routes = ['/', '/stores', '/products', '/cart', '/favorites', '/profile', '/settings'] as const;
export type AppRoute = typeof routes[number];
let intended: AppRoute | null = null;
let logoutRevision = 0;

export function rememberDestination(pathname: string) {
  if (routes.includes(pathname as AppRoute)) intended = pathname as AppRoute;
}
export const destination = (): AppRoute => intended ?? '/';
export const logoutVersion = () => logoutRevision;
export function clearDestination() { intended = '/'; logoutRevision += 1; }
