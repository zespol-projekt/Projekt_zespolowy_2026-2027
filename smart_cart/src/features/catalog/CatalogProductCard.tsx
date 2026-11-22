import { ActivityIndicator, Image, Text, View } from 'react-native';
import { Notice, useUI } from '@/components/ui/Controls';
import { amount, money } from './types';
import type { CatalogOffer, CatalogProduct } from './catalogV1';
import { priceDateLabel } from './catalogPresentation';
import { CatalogButton } from './CatalogControls';

export function ProductImage({ name, url }: { name: string; url: string | null }) {
  return url && /^https:\/\//i.test(url)
    ? <Image source={{ uri: url }} accessibilityLabel={name} style={{ width: 80, height: 80, resizeMode: 'contain' }} />
    : null;
}

function OfferPrice({ offer, product }: { offer: CatalogOffer; product: CatalogProduct }) {
  const ui = useUI();
  const pack = product.package;
  const basis = pack.quantity !== null && pack.quantity > 0 && pack.unit
    ? `${product.sale_mode === 'bulk' ? 'za' : 'za opakowanie'} ${amount(pack.quantity, pack.unit)}`
    : product.sale_mode === 'package' ? 'za opakowanie (rozmiar nieznany)' : '— podstawa ceny nieznana';
  return <View style={{ gap: 5 }}>
    <Text accessibilityRole="header" style={ui.heading}>{offer.store.name}</Text>
    <Text style={ui.text}>{offer.price_today === null ? 'Brak ceny' : `${money(offer.price_today)} ${basis}`}</Text>
    {offer.unit_price_today !== null && offer.unit_price_per && <Text style={ui.muted}>{money(offer.unit_price_today)} / {offer.unit_price_per}</Text>}
    {offer.regular_price_status === 'estymowana' && <Text style={ui.muted}>Cena szacunkowa nie jest używana do porównania.</Text>}
    <Text style={ui.muted}>{priceDateLabel(offer)}</Text>
    {product.sale_mode === 'bulk' && <Text style={ui.muted}>Końcowy koszt zależy od rzeczywiście zważonej ilości.</Text>}
    {offer.promotion && <>
      <Text style={ui.muted}>{offer.promotion.applies_today ? 'Promocja uwzględniana przez porównanie koszyka.' : 'Promocja informacyjna — nie jest naliczana automatycznie.'}</Text>
      {offer.promotion.condition && <Text style={ui.text}>{offer.promotion.condition}</Text>}
      {(offer.promotion.valid_from || offer.promotion.valid_to) && <Text style={ui.muted}>Okres promocji: {offer.promotion.valid_from ?? 'brak daty początku'} – {offer.promotion.valid_to ?? 'brak daty końca'}</Text>}
      {offer.promotion.requires_activation && <Notice>Wymaga aktywacji kuponu w aplikacji sklepu.</Notice>}
      {offer.promotion.requires_card && <Text style={ui.muted}>Wymaga karty lub aplikacji sieci.</Text>}
    </>}
  </View>;
}

export function CatalogProductCard({ product, onAdd, disabled, showAdd = true, showHeading = true }: {
  product: CatalogProduct; onAdd: (id: number) => void; disabled: boolean; showAdd?: boolean; showHeading?: boolean;
}) {
  const ui = useUI();
  const pack = product.package;
  return <View style={ui.card}>
    {showHeading && <Text accessibilityRole="header" style={ui.heading}>{product.name}</Text>}
    <ProductImage name={product.name} url={product.image_url} />
    <Text style={ui.muted}>{pack.quantity !== null && pack.quantity > 0 && pack.unit ? `Ilość: ${amount(pack.quantity, pack.unit)}` : 'Brak potwierdzonej ilości w opakowaniu.'}</Text>
    {(pack.quantity === null || product.sale_mode === 'unknown') && <Notice>Nieznane opakowanie — porównanie cen niedostępne. Możesz dodać produkt jako potrzebę; ręczne wpisanie ilości nie umożliwi wyceny.</Notice>}
    {product.offers.length === 0 && <Text style={ui.text}>Brak ofert w bazie.</Text>}
    {product.offers.map(offer => <OfferPrice key={offer.offer_id} offer={offer} product={product} />)}
    {showAdd && <CatalogButton title={`Dodaj wybrany produkt: ${product.name}`} label="Dodaj ten produkt" disabled={disabled} onPress={() => onAdd(product.product_id)} />}
  </View>;
}

export function DetailStatus({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  return <>
    {loading && <ActivityIndicator accessibilityLabel="Wczytywanie produktów i cen" />}
    {error && <><Notice>{error}</Notice><CatalogButton title="Ponów pobieranie produktów i cen" onPress={retry} /></>}
  </>;
}
