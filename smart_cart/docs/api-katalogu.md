# API katalogu v1 (dla aplikacji)

Stan: 21 listopada 2026. Migracja `supabase/migrations/20261122000100_catalog_api.sql`. Testy: `tests/database-catalog-api.sql`.

Nowe funkcje **uzupełniają** obecne API. Bez zmian zostają: `rpc/search_product_groups`, widok `catalog_offers`, `rpc/add_shopping_item`, `rpc/compare_basket`, listy i ulubione. Obecne ekrany działają dalej; nowe ekrany (drzewo kategorii, wyniki z liczbami, karta produktu) korzystają z funkcji poniżej.

## Wywołanie

Jak pozostałe RPC w `src/features/catalog/api.ts` (`createDataClient`): `POST <EXPO_PUBLIC_SUPABASE_URL>/rest/v1/rpc/<funkcja>`, nagłówki `apikey` (klucz publiczny) i `Authorization: Bearer <token sesji>`, ciało JSON z parametrami. Każda funkcja zwraca **jeden obiekt JSON** z polem `version: 1`.

```ts
tree: (signal: AbortSignal) => call<CatalogTree>('rpc/catalog_tree', { method: 'POST', body: {}, signal }),
branch: (slug: string, offset: number, signal: AbortSignal) => call<CatalogPage>('rpc/catalog_branch', { method: 'POST', body: { p_subcategory: slug, p_limit: 30, p_offset: offset }, signal }),
search: (query: string, offset: number, signal: AbortSignal) => call<CatalogSearch>('rpc/catalog_search', { method: 'POST', body: { p_query: query, p_limit: 30, p_offset: offset }, signal }),
group: (id: number, signal: AbortSignal) => call<CatalogGroup>('rpc/catalog_group', { method: 'POST', body: { p_group_id: id }, signal }),
product: (id: number, signal: AbortSignal) => call<CatalogProduct>('rpc/catalog_product', { method: 'POST', body: { p_product_id: id }, signal }),
```

| Funkcja | Parametry | Zwraca |
|---|---|---|
| `catalog_tree` | — | kategorie w ustalonej kolejności, każda z podkategoriami (`children`) |
| `catalog_branch` | `p_subcategory` (slug), `p_limit` 1–100 (domyślnie 30), `p_offset` ≥ 0 | grupy i produkty podkategorii, strona wyników |
| `catalog_search` | `p_query`, `p_limit`, `p_offset` | grupy i produkty pasujące do zapytania, strona wyników |
| `catalog_group` | `p_group_id` | grupa z wszystkimi produktami i ich ofertami w sieciach |
| `catalog_product` | `p_product_id` | produkt, jego grupa, ścieżka, oferty i ostatnie zmiany cen |

## Pojęcia

- **Kategoria → podkategoria → element.** Element to **grupa zamienników** (`kind: "group"`, np. „Mleko UHT 3,2% · z laktozą” — różne marki i opakowania o tych samych cechach) albo **pojedynczy produkt** (`kind: "product"` — produkt bez zamienników, np. jeszcze nieuporządkowany).
- Oba rodzaje mają `group_id` — to on idzie do `add_shopping_item` (`p_group_id`), ulubionych i `compare_basket`. Dla `kind: "product"` pole `product_id` wskazuje ten produkt; konkretny produkt na liście to `p_selected_product_id`.
- `verification_status` podkategorii: `reviewed` — grupy sprawdzone (dziś: Nabiał → Mleko), `in_progress`, `preliminary` — dane wstępne (automatyczne). Warto to pokazać w UI, np. „dane wstępne”.
- Produkty bazowe bez podkategorii (np. piwo) nie występują w żadnej funkcji.

## Ceny — znaczenie pól

| Pole | Znaczenie |
|---|---|
| `regular_price` | cena regularna **za 1 opakowanie** (dla produktów luzem: za `package.quantity`, zwykle 1000 g) |
| `regular_price_status` | `prawdziwa` — potwierdzona w źródle; `brak` — brak ceny regularnej; `estymowana` — szacunek (nie jest używany w porównaniu) |
| `regular_price_observed_at` | data ceny ze źródła: antonka i tanszykoszyk — dzień obserwacji; kodyzbiedry (Biedronka) — data aktualizacji wpisu w katalogu źródła, a bez niej data dodania wpisu, więc cena może mieć kilka miesięcy; `wyliczona_z_promocji` — dzień obserwacji promocji, z której ją wyliczono; `null` — nieznana |
| `price_source` | źródło ceny regularnej: `antonka`, `antonka_historia`, `tanszykoszyk`, `kodyzbiedry` albo `wyliczona_z_promocji` — cena regularna **wyliczona z ceny promocyjnej** (od 23.11.2026; status `prawdziwa`, liczy się w porównaniu; warto ją podpisać w UI, np. „cena wyliczona z promocji”) |
| `promotion` | promocja ze źródła albo `null`: cena, typ, warunek, okres, zasięg, reguła; `applies_today: true` — promocja jest **naliczana automatycznie dziś** (porównanie koszyka ją uwzględnia); `false` — tylko informacja (niepotwierdzona, wygasła, złożony warunek) |
| `requires_card`, `requires_activation` | warunki promocji do pokazania w UI (karta / aktywacja kuponu) |
| `price_today` | cena **1 opakowania dziś**: niższa z regularnej `prawdziwa` i promocji naliczanej dziś; `null` — dziś brak ceny |
| `price_today_basis` | `regular` / `promotion` / `null` |
| `unit_price_today` + `unit_price_per` | `price_today` przeliczona na **1 kg / 1 l / 1 szt** |
| `price_from` (element) | **najniższa cena jednostkowa** wśród ofert elementu: `unit_price` + `unit_price_per`, a także cena i rozmiar opakowania, sieć i `offer_id` tej oferty; `null` — żadna oferta nie ma dziś ceny |

„Od X zł” pokazujemy jako **„od 2,99 zł/l”** (`price_from.unit_price` + `unit_price_per`). Nie porównujemy cen opakowań o różnych rozmiarach. Promocje wielosztukowe (np. „przy zakupie 3”) nie obniżają `price_today` jednej sztuki — liczy je `compare_basket` dla zadanej ilości.

## Liczby i paginacja

- `product_count` — liczba **różnych produktów** elementu; `offer_count` — liczba ofert sieci; `store_count` — w ilu sieciach jest oferta; `stores_with_price_today` — w ilu sieciach jest dziś cena. Wszystkie liczone z **wszystkich** ofert, nie ze strony wyników.
- `total` — liczba wszystkich wyników zapytania/gałęzi; `limit` i `offset` — zastosowane (limit ograniczony do 1–100). Następna strona: `offset + limit < total`. Strona poza końcem: `items: []` z tym samym `total`.
- Kolejność w gałęzi: najpierw grupy, potem pojedyncze produkty, alfabetycznie. W wyszukiwaniu: najpierw dokładne i zaczynające się od zapytania nazwy grup, grupy przed pojedynczymi produktami, przy równym dopasowaniu większe grupy (więcej produktów) wyżej, potem alfabetycznie.

## Wyszukiwanie

Reguły (od migracji `20261123000100_search_and_basket_fixes.sql`):

- Wszystkie słowa zapytania muszą wystąpić **w jednym produkcie** elementu: w tekście „nazwa grupy + nazwa tego produktu”. Słowa z dwóch różnych produktów grupy nie są łączone.
- W **grupach zamienników** (`kind: "group"`) nazwa produktu bazowego nie jest przeszukiwana: cechy opisuje nazwa grupy. W pojedynczych produktach (`kind: "product"`) jest: „ser gouda” znajduje „Gouda plastry”, której produktem bazowym jest „Ser żółty”.
- Słowa wpisane w całości muszą być **całymi wyrazami**, a ostatnie słowo (jeszcze wpisywane) **początkiem wyrazu**. „bez gouda” nie trafia w „bezglutenowa”, „łaci” trafia w „Łaciate”, „mlek uht” nic nie znajduje.
- Nazwy ofert w sieciach (`store_product_name`) nie są przeszukiwane.

Bez znaczenia są wielkość liter, polskie znaki (`łaciate` = `ŁACIATE` = `laciate`) i zapis procentów (`3,2%` = `3.2%` = `3,2 %`). Puste zapytanie → `total: 0`. Pole `query` zwraca znormalizowane zapytanie (do debugowania). Czas odpowiedzi (zmierzony na wspólnej bazie, ~11,5 tys. produktów, z połączeniem): wyszukiwanie ok. 0,15–0,2 s, gałąź ok. 0,1 s, drzewo ok. 0,3 s. Warto opóźnić wyszukiwanie o ~300 ms od ostatniego wpisanego znaku i przerywać poprzednie zapytanie (`AbortSignal`).

## Koszyk: źródło ceny w `compare_basket`

Od migracji `20261123000100_search_and_basket_fixes.sql` każdy wybór `stores[].items[].picks[]` (oraz `alternative.picks[]`) ma pole `price_source`: to samo źródło co w `catalog_offers` i w ofertach katalogu. `observed_at` to `regular_price_observed_at` oferty i dotyczy ceny regularnej, także gdy naliczono promocję. Podpis jak w katalogu: `price_source: "wyliczona_z_promocji"` → „Cena wyliczona z promocji”; `"kodyzbiedry"` albo `observed_at: null` → „Data ceny nieznana”. Pozostałe pola i sumy porównania bez zmian.

```json
{ "offer_id": 41250, "product_id": 5521, "name": "MLEKO UHT 3,2% MLECZNA DOLINA 1 l", "package_count": 2, "quantity": 2000, "unit": "ml",
  "sale_mode": "package", "total_price": 2.98, "regular_total": 2.98, "promotion_applied": false, "requires_activation": false,
  "requires_card": false, "condition": null, "observed_at": "2026-11-18T00:00:00+00:00", "price_source": "kodyzbiedry",
  "valid_from": null, "valid_to": null }
```

## Błędy

| Sytuacja | HTTP | Treść (`message`) |
|---|---|---|
| brak sesji (gość) | 401 | `permission denied for function …` |
| konto niepotwierdzone / anonimowe | 403 | `Zaloguj się potwierdzonym kontem, aby przeglądać katalog.` |
| nie ma podkategorii / grupy / produktu | 404 | `Nie ma takiej podkategorii.` / `Nie ma takiej grupy.` / `Nie ma takiego produktu.` |

Grupa bez ofert i produkt bez podkategorii (np. piwo) dają 404.

## Przykłady odpowiedzi

Dane testowe (z `tests/database-catalog-api.sql`), skrócone.

### `catalog_tree` — jedna kategoria

```json
{ "version": 1, "categories": [
  { "id": 3, "slug": "nabial", "parent_slug": null, "name": "Nabiał", "order": 3, "product_count": 4, "offer_count": 5,
    "children": [
      { "id": 9, "slug": "nabial-mleko", "parent_slug": "nabial", "name": "Mleko", "order": 1,
        "verification_status": "reviewed", "product_count": 4, "offer_count": 5, "has_items": true },
      { "id": 10, "slug": "nabial-napoje-roslinne-i-tofu", "parent_slug": "nabial", "name": "Napoje roślinne i tofu", "order": 2,
        "verification_status": "preliminary", "product_count": 0, "offer_count": 0, "has_items": false }
    ] }
] }
```

### `catalog_branch("nabial-mleko", 2, 0)` — strona 1 z 2; element bez ceny dziś

```json
{ "version": 1, "total": 3, "limit": 2, "offset": 0,
  "subcategory": { "id": 9, "slug": "nabial-mleko", "name": "Mleko", "verification_status": "reviewed",
                   "category": { "slug": "nabial", "name": "Nabiał" } },
  "items": [
    { "kind": "group", "group_id": 106, "product_id": null, "name": "Mleko UHT 2% · z laktozą", "unit": "ml", "default_quantity": 1000,
      "product_count": 1, "offer_count": 1, "store_count": 1, "stores_with_price_today": 0, "price_from": null, "image_url": null },
    { "kind": "group", "group_id": 53, "product_id": null, "name": "Mleko UHT 3,2% · z laktozą", "unit": "ml", "default_quantity": 1000,
      "product_count": 2, "offer_count": 3, "store_count": 2, "stores_with_price_today": 2,
      "price_from": { "unit_price": 2.99, "unit_price_per": "1 l", "package_price": 2.99, "package_quantity": 1000, "package_unit": "ml",
                      "store": { "id": 5, "slug": "lidl", "name": "Lidl" }, "offer_id": 17 },
      "image_url": null }
  ] }
```

### `catalog_search("mleko 3,2%")` i pusta lista

```json
{ "version": 1, "query": "mleko 3 2%", "total": 1, "limit": 30, "offset": 0, "items": [ { "kind": "group", "group_id": 53, "name": "Mleko UHT 3,2% · z laktozą", "…": "…" } ] }
{ "version": 1, "query": "kefir truskawkowy", "total": 0, "limit": 30, "offset": 0, "items": [] }
```

### Oferta (w `catalog_group` → `products[].offers[]` i `catalog_product` → `offers[]`)

Z promocją naliczaną dziś:

```json
{ "offer_id": 17, "product_id": 98101, "store": { "id": 5, "slug": "lidl", "name": "Lidl" },
  "store_product_name": "Łaciate Mleko UHT 3,2% 1 l",
  "regular_price": 3.80, "regular_price_status": "prawdziwa", "regular_price_observed_at": "2026-11-21T01:31:48+01:00", "price_source": "test",
  "promotion": { "price": 2.99, "type": "obniżka", "condition": null, "valid_from": "2026-11-20", "valid_to": "2026-11-23",
                 "scope": "nationwide", "price_status": "prawdziwa", "rule": { "kind": "unit" }, "evidence_url": "https://…",
                 "applies_today": true, "requires_card": false, "requires_activation": false },
  "price_today": 2.99, "price_today_basis": "promotion", "unit_price_today": 2.99, "unit_price_per": "1 l", "image_url": null }
```

Bez ceny (np. Lidl/Kaufland/Dino poza gazetką):

```json
{ "offer_id": 19, "store": { "id": 5, "slug": "lidl", "name": "Lidl" }, "store_product_name": "Mleko UHT 2% Testowe 1 l",
  "regular_price": null, "regular_price_status": "brak", "promotion": null,
  "price_today": null, "price_today_basis": null, "unit_price_today": null, "unit_price_per": "1 l" }
```

### `catalog_group(53)` — szkielet

```json
{ "version": 1,
  "group": { "kind": "group", "group_id": 53, "name": "Mleko UHT 3,2% · z laktozą", "…": "jak element listy",
             "path": { "category": { "slug": "nabial", "name": "Nabiał" }, "subcategory": { "slug": "nabial-mleko", "name": "Mleko", "verification_status": "reviewed" } } },
  "products": [
    { "product_id": 98101, "name": "Łaciate Mleko UHT 3,2% 1 l", "ean": "5900000098101",
      "package": { "quantity": 1000, "unit": "ml", "label": null }, "sale_mode": "package", "image_url": null,
      "offers": [ { "…": "oferty jak wyżej, od najtańszej dziś" } ] }
  ] }
```

Produkty w grupie są posortowane od najniższej ceny jednostkowej dziś; produkty bez ceny na końcu.

### `catalog_product(98101)` — szkielet

```json
{ "version": 1,
  "product": { "product_id": 98101, "name": "Łaciate Mleko UHT 3,2% 1 l", "ean": "5900000098101",
               "package": { "quantity": 1000, "unit": "ml", "label": null }, "sale_mode": "package", "image_url": null,
               "group": { "group_id": 53, "name": "Mleko UHT 3,2% · z laktozą", "unit": "ml", "kind": "group" },
               "path": { "category": { "slug": "nabial", "name": "Nabiał" }, "subcategory": { "slug": "nabial-mleko", "name": "Mleko", "verification_status": "reviewed" } } },
  "offers": [ { "…": "oferta jak wyżej",
                "history": [ { "regular_price": 3.80, "promo_price": 2.99, "price_source": "test", "recorded_at": "2026-11-21T01:31:48+01:00" } ] } ] }
```

`history` — do 10 ostatnich zmian ceny oferty, od najnowszej.

## Typy TypeScript (propozycja do `types.ts`)

```ts
export type CatalogNode = { id: number; slug: string; parent_slug: string | null; name: string; order: number; product_count: number; offer_count: number };
export type CatalogSubcategory = CatalogNode & { verification_status: 'reviewed' | 'in_progress' | 'preliminary'; has_items: boolean };
export type CatalogTree = { version: 1; categories: (CatalogNode & { children: CatalogSubcategory[] })[] };
export type PriceFrom = { unit_price: number; unit_price_per: '1 kg' | '1 l' | '1 szt'; package_price: number; package_quantity: number; package_unit: Unit; store: { id: number; slug: string; name: string }; offer_id: number };
export type CatalogItem = { kind: 'group' | 'product'; group_id: number; product_id: number | null; name: string; unit: Unit; default_quantity: number;
  product_count: number; offer_count: number; store_count: number; stores_with_price_today: number; price_from: PriceFrom | null; image_url: string | null };
export type CatalogPage = { version: 1; total: number; limit: number; offset: number; items: CatalogItem[];
  subcategory: { id: number; slug: string; name: string; verification_status: CatalogSubcategory['verification_status']; category: { slug: string; name: string } } };
export type CatalogSearch = { version: 1; query: string; total: number; limit: number; offset: number; items: CatalogItem[] };
export type CatalogPromotion = { price: number | null; type: string | null; condition: string | null; valid_from: string | null; valid_to: string | null;
  scope: string; price_status: string; rule: Offer['promo_rule']; evidence_url: string | null; applies_today: boolean; requires_card: boolean; requires_activation: boolean };
export type CatalogOffer = { offer_id: number; product_id: number; store: { id: number; slug: string; name: string }; store_product_name: string;
  regular_price: number | null; regular_price_status: 'prawdziwa' | 'brak' | 'estymowana'; regular_price_observed_at: string | null; price_source: string | null;
  promotion: CatalogPromotion | null; price_today: number | null; price_today_basis: 'regular' | 'promotion' | null;
  unit_price_today: number | null; unit_price_per: '1 kg' | '1 l' | '1 szt'; image_url: string | null };
export type CatalogPath = { category: { slug: string; name: string }; subcategory: { slug: string; name: string; verification_status: CatalogSubcategory['verification_status'] } };
export type CatalogProductBase = { product_id: number; name: string; ean: string | null; package: { quantity: number | null; unit: Unit | null; label: string | null };
  sale_mode: 'package' | 'bulk' | 'unknown'; image_url: string | null };
export type CatalogGroup = { version: 1; group: CatalogItem & { path: CatalogPath | null }; products: (CatalogProductBase & { offers: CatalogOffer[] })[] };
export type CatalogProduct = { version: 1; product: CatalogProductBase & { group: { group_id: number; name: string; unit: Unit; kind: 'group' | 'product' }; path: CatalogPath };
  offers: (CatalogOffer & { history: { regular_price: number | null; promo_price: number | null; price_source: string | null; recorded_at: string }[] })[] };
```

## Znane ograniczenia (stan danych 21.11.2026)

- Lidl, Kaufland i Dino mają w danych głównie promocje z gazetek — wiele ofert ma dziś `price_today: null`. Pomaga cotygodniowe odświeżanie danych.
- Poza Nabiał → Mleko większość produktów to jeszcze pojedyncze produkty (`kind: "product"`); wspólne grupy powstają dla mleka, masła, mąki, ryżu, cukru i jajek oraz dla produktów z tym samym EAN w kilku sieciach. Kolejne kategorie porządkujemy etapami.
- `image_url` bywa `null`.
- Produkty bez ilości w nazwie (np. „Mleko w proszku pełne”) nie mają ceny jednostkowej: `unit_price_today: null` i nie liczą się do `price_from`.
- Ceny Biedronki pochodzą głównie z katalogu kodyzbiedry, w którym większość wpisów powstała w lutym–marcu 2026; część jest nieaktualna albo podejrzanie niska (np. mleko 0,99–1,49 zł/l). Poprawiamy to w kolejnym etapie; do tego czasu `price_from` może je pokazywać.
