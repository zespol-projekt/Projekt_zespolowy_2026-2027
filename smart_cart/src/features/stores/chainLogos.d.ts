import type { Chain } from './model';

export const CHAIN_LOGOS: Readonly<Record<Chain, string>>;
export const CHAIN_TILE_RADIUS: number;
export const CHAIN_TILE_COLORS: Readonly<Record<Chain, Readonly<{ backgroundColor: string; borderColor: string }>>>;
