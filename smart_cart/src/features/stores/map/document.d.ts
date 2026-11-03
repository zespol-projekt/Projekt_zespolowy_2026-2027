export const MAPLIBRE_VERSION: string;
export const MAPLIBRE_ASSETS: string;
export const MAP_DOCUMENT_BASE_URL: string;
export function createNativeMapSource(html: string): { html: string; baseUrl: string };
export function createMapDocument(channel: string): string;
