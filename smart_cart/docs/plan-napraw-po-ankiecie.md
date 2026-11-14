# Plan napraw po ankiecie — 14 listopada 2026

Dokument zapisuje końcowe odpowiedzi autora projektu z dwóch ankiet przeprowadzonych po [pełnym audycie](stan-projektu.md): 11 ustaleń podstawowych i 6 doprecyzowań.
Ustalenia zostały następnie wdrożone w kodzie i pięciu migracjach wspólnego Supabase. [Raport wykonania](wdrozenie-po-audycie.md) zawiera testy oraz jawne ograniczenia brakujących metadanych. Dalsze rozdziały zachowują uzasadnienie i plan przygotowany przed wdrożeniem; nie są listą nadal niezaimplementowanych funkcji.
Aktualne definicje i kontrakt RPC opisuje [database-context.md](database-context.md).

## Uzgodnienia

| Nr | Temat | Uzgodnione zachowanie |
| --- | --- | --- |
| 1 | Ilości i opakowania | Produkty paczkowane liczymy jako rzeczywisty zakup całych opakowań pokrywających potrzebną ilość. Przykładowo zapotrzebowanie 750 g może wymagać zakupu 2 × 500 g; cena dotyczy pełnych kupowanych opakowań. Produkty luzem mają osobną regułę opisaną w doprecyzowaniu 13. |
| 2 | Dodatkowe sztuki w promocji | Koszyk podstawowy odpowiada potrzebom. Korzystniejszy wariant wymagający większej ilości jest osobną propozycją do wyboru, z wyraźnym oznaczeniem przy porównaniu. |
| 3 | Karty lojalnościowe | Zakładamy, że użytkownik ma kartę/aplikację każdej sieci. Nie dodajemy wyboru kart w profilu. Oferty nadal pokazują wymaganie karty; liczba sztuk, daty i limity pozostają warunkami promocji. |
| 4 | Brak produktu lub ceny | Pokazujemy każdą sieć i jej dostępne produkty. Przy brakującej pozycji informujemy „brak produktu/ceny w bazie danych”. Nie podajemy ceny całego koszyka tej sieci i nie uwzględniamy go przy wyborze najtańszego. |
| 5 | Równoważne produkty i edycja | Domyślnie wybieramy najtańszy równoważny produkt niezależnie od marki, np. mleko 3,2% różnych firm. Użytkownik może później edytować listę, produkt i ilość; podsumowanie przelicza się ponownie. |
| 6 | Ceny estymowane | Nie używamy ich do wyceny. Są traktowane jako brak potwierdzonej ceny, z konsekwencjami dla kompletności całego koszyka jak w punkcie 4. |
| 7 | Dostęp do katalogu | Odczyt produktów i cen wymaga zalogowania. Import i edycja katalogu są administracyjne. Własne listy zakupów wymagają osobnych uprawnień użytkownika. |
| 8 | Wyszukiwanie | Najpierw pokazujemy grupy produktów, np. „Mleko 3,2%”. Po rozwinięciu grupy dostępne są konkretne opakowania i oferty sieci. |
| 9 | Nawigacja po logowaniu | Wracamy do zamierzonego ekranu; bez celu otwieramy Start. Odświeżenie ważnej sesji zachowuje bieżący ekran. Jawne wylogowanie czyści dane i zapamiętany cel. |
| 10 | Anulowanie operacji | Użytkownik może anulować. Blokujemy ponowne wysyłanie i chronimy nowy widok oraz sesję przed spóźnionym wynikiem opuszczonego formularza. Wiadomość już zlecona serwerowi może mimo anulowania dotrzeć. |
| 11 | Środowisko | Pracujemy ze wspólnym Supabase w chmurze. Lokalny CLI służy do schematu i migracji; utrzymywanie dodatkowego lokalnego Supabase nie należy do uzgodnionego zakresu. |

## Doprecyzowania — druga ankieta

| Nr | Temat | Uzgodnione zachowanie |
| --- | --- | --- |
| 12 | Granice zamienników | Zamienniki należą do precyzyjnej grupy o zgodnych istotnych cechach: np. mleko UHT 3,2% odpowiada innemu mleku UHT 3,2%, a produkt bez laktozy innemu bez laktozy. Marka i wielkość opakowania mogą się różnić. |
| 13 | Produkty luzem | Produkty paczkowane liczymy całymi opakowaniami, a sprzedawane luzem według potrzebnej masy i ceny za kilogram. Pokazujemy, że końcowy koszt produktu luzem zależy od faktycznie zważonej ilości. |
| 14 | Zasięg promocji i aktywacja | Uwzględniamy tylko promocje ogólnopolskie/ogólne, o których wiadomo ze źródła, że są dostępne dla wszystkich na podanych warunkach. Taki rabat naliczamy również wtedy, gdy wymaga aktywacji kuponu, i oznaczamy ten obowiązek przy produkcie. Oferty indywidualne wyłączamy z porównania. |
| 15 | Wiek ceny regularnej | Nie ma sztywnego limitu wieku. Używamy ostatniej znanej potwierdzonej ceny regularnej i pokazujemy datę jej potwierdzenia. Ważność promocji nadal zależy od dat początku i końca. |
| 16 | Sieci i placówki | Porównujemy sieci, mapa pomaga znaleźć placówki, a ceny oznaczamy jako dane sieciowe. Nie przedstawiamy ich jako cen potwierdzonych osobno dla konkretnego sklepu na mapie. |
| 17 | Zapis list | Użytkownik ma wiele nazwanych, prywatnych list zapisanych na koncie i dostępnych na różnych urządzeniach. Zapisujemy zawartość, ilości i ręczne wybory; wycenę przeliczamy z dostępnych cen i obowiązujących promocji. |

## Konsekwencje dla porównywarki

### Koszt rzeczywistego zakupu

Obecne `compare_basket(integer[], boolean, boolean)` przyjmuje tylko identyfikatory produktów bazowych. Taka sygnatura nie opisuje zapotrzebowania ilościowego ani ręcznych zmian produktu.
Samo naprawienie `ROUND` nie realizuje ustaleń ankiety. Trzeba przygotować kontrakt pozycji koszyka obejmujący produkt bazowy, potrzebną ilość i jednostkę oraz obsługę ręcznie wybranego wariantu produktu.
Dobór opakowań produktów paczkowanych ma pokrywać zapotrzebowanie i zwracać koszt zakupu oraz kupowaną ilość. Proporcjonalna cena dla medianowej gramatury może być pomocniczą informacją porównawczą, ale nie ceną rzeczywistego koszyka.
Dobór zamienników musi zachowywać istotne cechy produktu i zgodne jednostki; różna marka sama w sobie nie dyskwalifikuje oferty. Nie wolno mieszać gramów, mililitrów i sztuk w jednej kalkulacji bez jawnie uzasadnionej konwersji.

Dla produktu luzem z ceną za kilogram koszt planowany to `potrzebna_masa_g / 1000 × cena_za_kg`, bez dobierania fikcyjnych opakowań.
Przykład testowy: 750 g przy 8 zł/kg daje 6 zł. Jest to kalkulacja dla planowanej masy na podstawie znanej ceny jednostkowej, a nie cena oznaczona w bazie jako `estymowana`.
Wynik zaznacza zależność od faktycznie kupionej masy. Dane muszą jawnie rozróżniać produkt paczkowany od sprzedaży luzem; sama liczba w `quantity_value` nie wystarczy.
Precyzyjne grupy zamienników trzeba sprawdzić względem obecnego słownika produktów bazowych. Nie wolno zakładać, że każda obecna szeroka grupa zapewnia zgodność rodzaju i cech produktu.

### Warunki promocji

Wariant podstawowy i propozycja z dodatkowymi sztukami muszą być rozróżnione w danych wyniku i w interfejsie.
Przy propozycji pokazujemy liczbę opakowań, łączną ilość, nadwyżkę i pełny koszt, tak aby użytkownik wiedział, dlaczego wariant jest korzystniejszy.
Samo obniżenie ceny jednostkowej nie jest równoznaczne z mniejszym całkowitym wydatkiem; przy prezentacji trzeba podać rzeczywistą różnicę kosztu.
Założenie o posiadaniu kart nie zwalnia ze sprawdzania pozostałych warunków, w tym dat, liczby sztuk i limitów.

Do wyceny dopuszczamy promocję z potwierdzonym zasięgiem ogólnym i dostępnością dla wszystkich na podanych warunkach.
Jeżeli taka promocja wymaga aktywowania kuponu w aplikacji sklepu, uwzględniamy jej cenę i pokazujemy przy produkcie informację „Wymaga aktywacji w aplikacji sklepu”. Nie wymagamy w SMARTCART osobnego potwierdzania przez użytkownika, czy aktywował kupon.
Nie stosujemy rabatów indywidualnych, np. wynikających z osobistej oferty na koncie. Same oznaczenia „z aplikacją” lub „z kartą” nie potwierdzają ogólnodostępności; musi to wynikać z danych źródłowych.

Zalecenie wykonawcze: rozpoznawać promocje przez jawne reguły, które da się zweryfikować na podstawie danych. Nieznanych warunków opisowych nie należy automatycznie traktować jako bezwarunkowego rabatu.

### Aktualność cen i poziom porównania

Dla ceny regularnej używamy ostatniej znanej wartości ze źródła bez automatycznego odrzucania po 7 lub 30 dniach. Pokazujemy datę potwierdzenia, aby wiek informacji był widoczny.
Data potwierdzenia oznacza datę rzeczywistej obserwacji ceny u źródła. Czas importu lub `updated_at` nie może być przedstawiany jako nowe potwierdzenie, jeśli nie nastąpił ponowny odczyt źródła.
Zalecenie wykonawcze: jeśli stare dane nie pozwalają odtworzyć tej daty, oznaczyć brak daty zamiast ją wymyślać.
Promocje wymagają poprawnego przedziału obowiązywania i nie stają się bezterminowe przez przyjęcie ostatniej znanej ceny regularnej.

Porównanie dotyczy sieci handlowych. Mapa pozostaje katalogiem placówek, bez przypisywania im niepotwierdzonych lokalnych cen i dostępności.
Zalecenie wykonawcze: przy podsumowaniu oznaczyć poziom danych jako sieciowy; otwarcie placówki na mapie nie zmienia automatycznie źródła jej wyceny.

### Kompletność wyceny

Dla każdej sieci wynik musi obejmować status kompletności oraz listę pozycji dostępnych i brakujących.
Gdy nie można wycenić choć jednej wymaganej pozycji, suma całego koszyka jest niedostępna i wynik nie uczestniczy w wyborze najtańszego.
Nie zastępujemy brakującej ceny zerem, ceną z innej sieci ani szacunkiem. Nie przedstawiamy sumy znanych pozycji jako ceny tego koszyka.
Brak danych w bazie nie dowodzi faktycznej niedostępności produktu w sklepie; komunikat wskazuje ograniczenie danych.
Jeżeli żaden koszyk nie jest kompletny, interfejs nie wskazuje zwycięskiej sieci.
Zmiana produktu, ilości lub wybór propozycji promocyjnej powoduje ponowną ocenę kompletności i ceny.

### Prywatne listy na koncie

Użytkownik może tworzyć, nazywać, otwierać i edytować wiele własnych list oraz korzystać z nich po zalogowaniu na różnych urządzeniach.
Zawartość list jest zapisywana w chmurze; wycena jest obliczana z dostępnych cen i obowiązujących promocji zamiast traktowania starej sumy jako aktualnej ceny.
Uprawnienia użytkownika dotyczą własnych list i ich pozycji. Nie dają prawa do edycji globalnego katalogu produktów lub cen.
Obecny eksport nie zawiera tabel list; model ten wymaga migracji, relacji właściciela do konta Auth i polityk RLS także dla pozycji list.

## Plan prac

Kolejność poniżej jest propozycją wykonawczą wynikającą z audytu i uzgodnień, a nie zapisem wdrożonych zmian.

### 1. Kontrakt danych, RPC i uprawnienia

- Przygotować nowy kontrakt koszyka z ilościami i wynikami dla wszystkich sieci. Zachować rozróżnienie kosztu podstawowego, wariantów promocyjnych i braku pełnej wyceny oraz sprzedaży paczkowanej i luzem.
- Naprawić arytmetykę `numeric` w `compare_basket` i zastąpić logikę mediany doborem całych opakowań dla produktów paczkowanych oraz kalkulacją według masy dla sprzedaży luzem.
- Uzupełnić model danych o potrzebne informacje dotyczące sposobu sprzedaży, daty obserwacji ceny i potwierdzonego zasięgu oraz warunków promocji. Zweryfikować precyzję grup zamienników. Nazwy nowych pól i dokładny SQL należy dobrać podczas projektowania migracji.
- Poprawić `search_offers`: złączenie przez `products`, nazwy kolumn i typy zwracane, w tym `BIGINT`. Nie odwoływać się do nieistniejącego `search_tags`; obsługę synonimów trzeba zrealizować jawnie, jeśli będzie potrzebna.
- Zapewnić wyszukiwanie najpierw grup produktów, a następnie ofert i opakowań grupy. Obecna funkcja zwracająca płaską listę ofert nie realizuje tego całego przepływu.
- Dostosować odczyt katalogu i RPC do zalogowanych użytkowników. Usunąć zbędne uprawnienia `anon` i `authenticated`, w tym `TRUNCATE`, oraz uporządkować domyślne uprawnienia nowych obiektów.
- Sprawdzić dostęp przez tabele, widoki i funkcje; sama ukryta zakładka aplikacji nie egzekwuje uprawnień bazy.
- Dodać model wielu nazwanych list oraz ich pozycji, powiązanie właściciela z Auth i RLS ograniczające odczyt oraz edycję do własnych danych. Sprawdzić także próby dostępu do pozycji cudzej listy.
- Przygotować wersjonowane migracje i po zastosowaniu zmian odświeżyć eksport oraz opis schematu. Nie odtwarzać bazy przez destrukcyjne uruchomienie starego skryptu Gemini.

### 2. Nawigacja i formularze konta

- Zachować cel wejścia i bieżący ekran podczas odświeżenia sesji, bez chwilowego udostępnienia chronionych danych osobie bez sesji.
- Czyścić cel i dane przy wylogowaniu; nie przywracać stanu poprzedniego użytkownika po zmianie konta.
- Poprawić edycję emaila na potwierdzeniu rejestracji, aby zmiana dotyczyła rzeczywistego procesu rejestracji, a nie tylko pola widoku.
- Dodać prezentację wyniku ponownej wysyłki, stan oczekiwania i odliczanie; rzeczywiste limity nadal egzekwuje Supabase.
- Zapewnić bezpieczne anulowanie i odrzucanie spóźnionych wyników również na poziomie sesji.
- Poprawić powrót z recovery: tryb logowania, czyszczenie pól i zakończenie sesji odzyskiwania.
- Obsłużyć wynik błędu wylogowania w profilu.

Te naprawy formularzy wynikają z audytu. Ankieta ustaliła szczegółowo zachowanie anulowania i nawigacji, a pozostałe pozycje pozostają zaleceniami technicznymi z raportu.

### 3. Ekrany produktów i koszyka

- Podłączyć wyszukiwanie grup i rozwijanie ofert do poprawionego kontraktu bazy.
- Umożliwić podawanie potrzebnej ilości i jednostki, edycję pozycji oraz ponowne przeliczanie.
- Pokazywać każdą sieć, dostępne pozycje i braki; nie wyceniać całego niekompletnego koszyka.
- Dodać jawne propozycje promocji wymagających dodatkowego zakupu oraz oznaczenia wymagania karty i aktywacji ogólnodostępnego kuponu.
- Pokazywać datę potwierdzenia ceny regularnej i poziom danych sieciowych; dla produktów luzem informować o zależności kosztu od rzeczywistej masy.
- Dodać wiele nazwanych list prywatnych na koncie i ich odczyt na różnych urządzeniach; po otwarciu lub edycji przeliczać podsumowanie z dostępnych danych.
- Rozróżnić edycję własnej listy od edycji globalnego katalogu produktów i cen.

Ekrany produktów, koszyka i ulubionych są obecnie puste. Ankieta określa zachowanie porównywarki i listy, ale nie jest kompletną specyfikacją wszystkich pozostałych modułów.

### 4. Diagnostyka, narzędzia i weryfikacja

- Rozróżnić w komunikatach sklepu problem połączenia, sesji i danych bez ujawniania tokenów ani szczegółów konfiguracji.
- Uporządkować oznaczenie `supabase/config.toml` jako konfiguracji lokalnej, która nie reprezentuje ustawień Auth chmury. Nie uruchamiać na tej podstawie dodatkowego lokalnego Auth w bieżącym zakresie.
- Skonfigurować ESLint; nieistniejący skrypt `reset-project` usunąć albo zastąpić narzędziem o określonej funkcji.
- Dostosować testy do aktualnego UI i naprawić pięć nieudanych scenariuszy Playwright.
- Sprawdzić nowe reguły na przypadkach: różne opakowania i zgodne jednostki, sprzedaż luzem, zgodne i niezgodne cechy zamienników, promocje z dodatkowymi sztukami, ogólnodostępne kupony do aktywacji, odrzucanie ofert indywidualnych, wymaganie karty, brak danych, ceny estymowane i ponowna wycena po edycji.
- Sprawdzić użycie starej potwierdzonej ceny regularnej z widoczną datą, wygaśnięcie promocji, oznaczenie danych jako sieciowych oraz dostęp właściciela i brak dostępu innego konta do zapisanych list na różnych urządzeniach.
- Sprawdzić uprawnienia przed logowaniem i po logowaniu, dostęp administracyjny, anulowanie, spóźnione odpowiedzi, recovery oraz zachowanie trasy.
- Zachować przechodzące testy aplikacji i danych; po zmianach ponowić TypeScript, testy przeglądarkowe, pakowanie i ręczny odbiór na urządzeniach.

## Punkt wyjścia i kryteria odbioru

Punkt wyjścia z audytu: 82/82 testy Node aplikacji, 37/37 testy danych, TypeScript i kontrola 7753 placówek zaliczone; Playwright 12/17.
RPC `compare_basket` i `search_offers` mają potwierdzone błędy wykonania. Te wyniki nie zmieniły się przez zapisanie niniejszego planu.

Naprawy można uznać za odebrane po potwierdzeniu uzgodnionego działania, przejściu odpowiednich testów, sprawdzeniu dostępu do danych oraz uaktualnieniu schematu i dokumentacji.
Przykłady cen i ilości z ankiety są scenariuszami testowymi, nie rzeczywistymi ofertami sklepów.
