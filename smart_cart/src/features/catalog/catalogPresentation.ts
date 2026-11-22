import type { CatalogOffer } from './catalogV1.ts';

export function normalizeCatalogQuery(value: string): string {
  return value.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/,/g, '.').trim();
}

export function priceDateLabel(offer: Pick<CatalogOffer, 'price_source' | 'regular_price_observed_at'>): string {
  const unknown = 'Data ceny nieznana.';
  if (!['antonka', 'antonka_historia', 'tanszykoszyk'].includes(offer.price_source ?? '')) return unknown;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(offer.regular_price_observed_at ?? '');
  if (!match) return unknown;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return unknown;
  return `Cena widziana ${day}.${month}.${year}`;
}
