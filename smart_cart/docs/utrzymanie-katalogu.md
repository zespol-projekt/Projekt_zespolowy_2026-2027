# Utrzymanie katalogu, migracji i schematu

Pracujemy ze wspólnym Supabase w chmurze. Plik SQL jest migawką, nie automatycznie synchronizowanym połączeniem. Po każdej zmianie schematu trzeba ponowić eksport; zmiany struktury zapisujemy jako kolejną migrację, bez edycji migracji już wdrożonych.

## Praca z CLI

Poniższe polecenia odpowiadają CLI 3.1.0 i zakładają zalogowanie oraz `supabase link` do właściwego projektu. Można używać `npx.cmd supabase@3.1.0` zamiast globalnego `supabase`. Nie umieszczaj w repo hasła bazy ani tokenu dostępu CLI.

```powershell
supabase migration list --remote
supabase db push --remote --dry-run
supabase db push --remote
supabase db dump --remote --file supabase-schema.sql
```

Nowa kopia aplikacji korzystająca z istniejącego projektu nie wdraża ponownie starych migracji. Historia jest w Supabase. Te migracje startują od zastanego katalogu z audytu; nie są kompletnym bootstrapem pustego projektu. `tests/fixtures/legacy-schema.sql` zachowuje pierwotny eksport wyłącznie na potrzeby testu przejścia ze starego schematu.

Nie wykonuj `db reset --remote`, nie uruchamiaj lokalnego Auth ani `config push` jako sposobu odświeżenia schematu. Eksport nie obejmuje rekordów produktów, SMTP ani ustawień Auth panelu.

## Przegląd brakujących metadanych

`scripts/catalog-review.sql` jest odczytowym raportem produktów z niepewną równoważnością lub sprzedażą. Nie pobiera kont i list. Administrator może uruchomić go w SQL Editor albo przez CLI:

```powershell
supabase db query --remote --read-only --file scripts/catalog-review.sql
```

Sprawdź rzeczywiste etykiety/źródła, zanim połączysz produkty. Marka może być inna, ale istotne cechy i jednostka muszą się zgadzać. Nie mieszaj UHT/świeżego, różnych zawartości tłuszczu ani wariantów z laktozą/bez laktozy. Nie zakładaj sprzedaży luzem tylko dlatego, że zapisano masę 1000 g.

## Wprowadzanie zweryfikowanych danych

Przygotuj JSON z `groups` i/lub `offers`. Poniższy przykład pokazuje format, a nie rzeczywiste identyfikatory i dowody. Wartości należy zastąpić potwierdzonymi danymi przed wykonaniem.

```json
{
  "groups": [{
    "key": "milk-uht-3.2-lactose",
    "base_product_id": 123,
    "name": "Mleko UHT 3,2% · z laktozą",
    "unit": "ml",
    "products": [{ "id": 456, "sale_mode": "package" }]
  }],
  "offers": [{
    "id": 789,
    "regular_price_observed_at": "2026-11-14T10:00:00Z",
    "promo_scope": "nationwide",
    "promo_price_status": "prawdziwa",
    "promo_evidence_url": "https://example.invalid/zastap-rzeczywistym-dowodem",
    "valid_from": "2026-11-14",
    "valid_to": "2026-11-20",
    "promo_rule": {
      "kind": "min_quantity",
      "min_quantity": 3,
      "max_discount_quantity": 6,
      "requires_card": true,
      "requires_activation": true
    }
  }]
}
```

Dozwolone sposoby sprzedaży: `package`, `bulk`, `unknown`. Grupy administracyjne otrzymują klucz `reviewed:…` i znacznik `classification_source='reviewed'`, dzięki czemu automatyczna reguła nie nadpisze decyzji podczas aktualizacji produktu. Cena produktu luzem odnosi się do `quantity_value` i `quantity_unit`; dla ceny za kg zapisujemy 1000 g.

`regular_price_observed_at` oznacza faktyczne potwierdzenie ceny w źródle. Nie zastępuj tej daty czasem pobrania pliku lub migracji. Promocję `nationwide` oznaczaj tylko przy dowodzie dostępności dla wszystkich na określonych warunkach. Oferty indywidualne to `personalized`, nieznane — `unknown`. Daty muszą opisywać rzeczywisty okres promocji.

Reguły:

- `unit`: cena `promo_price` za opakowanie lub jednostkę bazową produktu luzem.
- `min_quantity`: `promo_price` za każde kwalifikujące się opakowanie, po spełnieniu `min_quantity`.
- `bundle`: `bundle_size` opakowań za łącznie `bundle_price`; pozostałe opakowania mają cenę regularną.
- `max_discount_quantity`: maksymalna liczba sztuk z rabatem. Dla `bundle` naliczamy tylko pełne pakiety mieszczące się w limicie.
- `requires_card`, `requires_activation`: wymagania widoczne w UI.

Rabaty liczymy dla konkretnej oferty/SKU. Reguły zależne od łącznej wartości całego koszyka, łączenia różnych SKU lub indywidualnego wykorzystania kuponu nie są automatycznie wnioskowane z tekstu. Jeśli nie da się wiernie opisać warunków obsługiwanym kontraktem, pozostaw promocję jako niepotwierdzoną. Dla luzu stosujemy wyłącznie regułę `unit`; masa nie jest liczbą opakowań.

Generator nie łączy się z bazą i nie zmienia cen:

```powershell
node scripts/catalog-metadata.mjs reviewed.json reviewed.sql
```

Przejrzyj wygenerowaną transakcję, zweryfikuj ID i źródła. Wykonaj ją jako administrator w SQL Editor albo `supabase db query --remote --file reviewed.sql`. Zwykły użytkownik aplikacji nie ma prawa zapisywać katalogu. Transakcja wycofa się po błędnym ID, niezgodnej jednostce lub naruszeniu ograniczeń. Zachowaj zweryfikowany plik z dowodami jako historię administracyjnego importu; nie publikuj sekretów.

## Testy SQL i kontrola chmury

`npm.cmd run test:db` resetuje schematy **wyłącznie** w osobnym kontenerze `smartcart-pg17-check` i wymaga tego kontenera. Nie przyjmuje URL zdalnej bazy. Przykładowe utworzenie jednorazowego środowiska:

```powershell
docker run --name smartcart-pg17-check -e POSTGRES_PASSWORD=smartcart-local-test -p 127.0.0.1:55440:5432 -d public.ecr.aws/supabase/postgres:17.11.0.003
npm.cmd run test:db
docker rm -f smartcart-pg17-check
```

Poczekaj, aż Postgres będzie gotowy przed uruchomieniem testu. To test migracji, nie dodatkowy lokalny Supabase z Auth. Dodatkowo można podać `SMARTCART_CHECK_INVENTORY` wskazujące lokalny raport katalogu o formacie użytym w audycie; test nie pobiera go samodzielnie.

`scripts/verify-cloud.sql` wykonuje kontrolę katalogu jako istniejące potwierdzone konto w jawnej transakcji `BEGIN READ ONLY … ROLLBACK`. Wymaga administratora z prawem przełączania ról; tryb `db query --read-only` CLI używa ograniczonej roli, która nie może wykonać tego przełączenia. Uruchom `supabase db query --remote --file scripts/verify-cloud.sql`; wynik nie zawiera kont ani prywatnych list. Osobno `node scripts/check-anonymous.mjs` sprawdza odmowę publicznego REST, korzystając wyłącznie z publicznej konfiguracji `.env.local`.
