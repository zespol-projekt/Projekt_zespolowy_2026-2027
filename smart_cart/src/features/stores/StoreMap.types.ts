import type { Coordinates, Store } from './model';
export type MapFocus = { point: Coordinates; request: number; zoom?: number;
  bounds?: { north: number; south: number; east: number; west: number } };
export type StoreMapProps = {
  stores: Store[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  userLocation: Coordinates | null;
  focus: MapFocus | null;
};
