# Baza produktów, cen i prywatnych list

Stan po wdrożeniu pięciu migracji **14 listopada 2026**. Źródła definicji: [migracje](../supabase/migrations) i ponowiony [eksport schematu](../supabase-schema.sql). Eksport zawiera 10 tabel, 2 widoki i 15 funkcji w `public`, a także triggery, indeksy, ograniczenia, RLS i uprawnienia.
SHA-256: `ce5ba072d51496ca5dcd2db0bba7fa587c3d48211a7ed5fec679f578c7c87872`.

Opis starej struktury i potwierdzonych przed naprawą błędów zachowano w [audycie bazy przed zmianami](database-audit-before-fixes.md). Rozmowa Gemini jest źródłem historycznym, nie aktualnym kontraktem.

## Model

| Tabela | Przeznaczenie |
| --- | --- |
| `categories` | Dziesięć działów katalogu |
| `base_products` | 224 dotychczasowe, często szerokie kategorie produktów; nie są automatycznie grupami zamienników |
| `comparison_groups` | Precyzyjna grupa porównania: klucz, nazwa, jednostka, powiązanie z produktem bazowym |
| `products` | Konkretny produkt/opakowanie, EAN i wartości odżywcze; dodatkowo grupa porównania, `sale_mode` i źródło klasyfikacji |
| `stores` | Sieci handlowe, nie adresy placówek |
| `store_offers` | Cena produktu w sieci; unikalne `(store_id,product_id)`, status ceny, źródło i metadane promocji |
| `price_history` | Zachowana historia zmian cen |
| `shopping_lists` | Nazwane listy z właścicielem `auth.uid()` |
| `shopping_list_items` | Ilość, jednostka, grupa, opcjonalny konkretny produkt i wybrane sieci dla dodatkowego zakupu |
| `favorite_groups` | Prywatne ulubione grupy, unikalne dla właściciela i grupy |

Jedna lista zawiera najwyżej 100 grup; jedna pozycja na grupę. Powtórne dodanie zwiększa ilość. Wybór konkretnego produktu dotyczy całej pozycji. Ilość ma do dwóch miejsc po przecinku, zakres `0 < quantity <= 100000`, dla `szt` jest całkowita. Jednostki `g`, `ml` i `szt` nie są mieszane.

`sale_mode`: `package` oznacza pełne opakowania, `bulk` masę według znanej podstawy ceny, `unknown` wyłącza ofertę z kalkulacji. `classification_source='reviewed'` chroni ręczną klasyfikację przed automatycznym nadpisaniem. Zachowawcze reguły nazw dotyczą m.in. mleka z podanym rodzajem/tłuszczem/laktozą, określonych typów mąki i ryżu, masła i jajek. Pozostałe produkty zachowują oddzielne grupy, dopóki nie zostanie potwierdzona równoważność.

`regular_price_observed_at` jest rzeczywistą datą potwierdzenia, nie czasem importu. Brak daty jest widoczny w UI. Cena regularna `prawdziwa` nie wygasa automatycznie. Status `estymowana` nie jest używany do wyceny.

## Promocje

Nowe pola `store_offers` to `promo_scope` (`unknown/nationwide/personalized`), `promo_evidence_url`, `promo_price_status` i `promo_rule` JSON. Dopiero potwierdzony zasięg, dowód, reguła, rzeczywista cena i aktualne daty dopuszczają rabat do naliczenia. Zakładamy posiadanie kart wszystkich sieci; wymóg aktywacji i karty pozostaje widoczny. Nieznane lub sprzeczne warunki nie są interpretowane z tekstu.

Format reguł, ograniczenia i kontrolowany import opisuje [utrzymanie katalogu](utrzymanie-katalogu.md). Reguły dla opakowań dotyczą konkretnego SKU. Produkty luzem korzystają tylko z rabatu jednostkowego, bez interpretowania masy jako liczby sztuk.

## Widoki i RPC

- `catalog_offers`: aktywne sieci, produkty i grupy, ceny, sposób sprzedaży, data obserwacji, metadane i flaga zweryfikowanej promocji. `single_price` to koszt jednej podstawowej jednostki/opakowania, nie automatycznie cena przy zakupie wielosztukowym.
- `v_store_offers_full`: zachowany porządek i nazwy starego widoku; poprawione bezpieczeństwo i semantyka wyceny. Nowa aplikacja korzysta z `catalog_offers`.
- `search_product_groups(search_query text='', result_limit integer=40, result_offset integer=0)`: grupy przed pojedynczymi produktami przy takiej samej trafności; normalizacja polskich znaków, wyszukiwanie przybliżone i paginacja. Wynik zawiera ID, nazwę, jednostkę, domyślne zapotrzebowanie, liczbę ofert i najniższą cenę jednostkową.
- `search_offers(search_query text='', result_limit integer=40)`: naprawiony starszy RPC z poprawnymi powiązaniami tabel i identyfikatorem oferty `bigint`.
- `add_shopping_item(p_list_id uuid,p_group_id bigint,p_quantity numeric,p_unit text,p_selected_product_id bigint=null)`: atomowe dodanie/zwiększenie pozycji we własnej liście, z kontrolą RLS.
- `compare_basket(p_items jsonb)`: nowy kontrakt zamiast usuniętego `compare_basket(integer[],boolean,boolean)`.

Przykładowa pozycja (należy użyć ID istniejących danych):

```json
{
  "p_items": [{
    "id": "id-pozycji",
    "group_id": 123,
    "quantity": 750,
    "unit": "g",
    "selected_product_id": null,
    "extra_store_ids": []
  }]
}
```

Wynik ma `version:2`, czas obliczenia i `stores` ze wszystkimi aktywnymi sieciami. Każda sieć zawiera `complete`, liczbę dostępnych/żądanych pozycji i listę wyników. `total_price` oraz `regular_total` są `null` przy niepełnej wycenie. Lista pusta nie tworzy zwycięzcy rankingu.

Każda pozycja zwraca `priced/missing`, wymaganą/kupowaną ilość, nadwyżkę, koszt i faktycznie dobrane oferty `picks`. Propozycja większego zakupu znajduje się w `alternative`; `extra_store_ids` określa, dla których sieci ją zaakceptowano. Wynik podaje wymaganie aktywacji/karty, okres promocji i datę obserwacji ceny regularnej.

Dobór opakowań używa ograniczonego programowania dynamicznego: może mieszać rozmiary, liczy pełny zakup i preferuje mniejszą nadwyżkę przy tej samej cenie. Limity obliczeń to m.in. 1000 opakowań danego wariantu i 10000 stanów; przekroczenie zwraca kontrolowany błąd z prośbą o mniejszą ilość lub konkretny produkt. Masy luzem wyceniane są proporcjonalnie z zaokrągleniem do groszy.

## Dostęp

Katalog: `authenticated` tylko SELECT, dodatkowo RLS wymaga potwierdzonego, nieanonimowego konta w `auth.users`. Zapis katalogu wyłącznie administracyjny. `anon` nie ma SELECT ani wykonania RPC aplikacyjnych. Użytkownicy nie mają TRUNCATE ani uprawnień do sekwencji katalogu.

Własne listy i ulubione: RLS po `auth.uid()`; pozycje sprawdzają właściciela listy. Drugie konto nie może czytać ani zmieniać tych danych. Widoki mają `security_invoker=true`. Pomocnicze funkcje mają jawne uprawnienia i ustalony `search_path`.

## Faktyczny stan danych po migracjach

Odczyt z chmury: 8952 produkty, 9894 oferty, 8797 zapisanych grup (8789 z produktami) i 5 aktywnych sieci (Biedronka, Carrefour, Dino, Kaufland, Lidl). 9217 ofert ma status `prawdziwa`, 677 `brak`; estymowanych nie stwierdzono. 187 produktów objęto regułami precyzyjnych grup, pozostałe są osobnymi produktami.

6068 produktów ma niepotwierdzony sposób sprzedaży. Nie uzupełniono fikcyjnych dat cen ani zasięgu promocji: 0 zapisanych dat obserwacji i 0 automatycznie dopuszczonych promocji. Powoduje to ograniczenia kompletności porównania; [raport wdrożenia](wdrozenie-po-audycie.md) wyjaśnia zakres.

Mapa ma osobny katalog 7753 placówek czterech sieci (Biedronka, Lidl, Auchan, Dino) i nie potwierdza lokalnych cen. Nie ma automatycznej synchronizacji tych zbiorów.

Eksport schematu nie zawiera rekordów, ustawień SMTP, limitów Auth ani zapisanych szablonów email. Nie odświeża się sam; [instrukcja CLI](utrzymanie-katalogu.md).
