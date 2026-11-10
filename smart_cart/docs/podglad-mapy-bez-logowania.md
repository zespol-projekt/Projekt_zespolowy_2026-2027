# Lokalny podgląd mapy bez logowania

Instrukcja dla stanu projektu z 10 listopada 2026, przed podłączeniem formularzy
i chronionej nawigacji osoby 2. Pozwala obejrzeć prawdziwy katalog sklepów
**w przeglądarce na tym samym komputerze**, bez konta i zmian w panelu Supabase.
Nie jest to test logowania ani docelowy sposób działania aplikacji.

Samo dodanie tego dokumentu niczego nie wyłącza. Poniższe zmiany wykonujesz
tymczasowo i cofasz po podglądzie. Nie wysyłaj wariantu podglądu do wspólnej wersji.

Zmieniasz tylko dwa pliki: `src/features/stores/useStores.ts` oraz
`server/serwer-mapy.mjs`. Hook będzie korzystał bezpośrednio z `fetch`, dlatego
`fetchCatalog.ts`, klient Supabase i moduł sesji pozostają bez zmian.

## 1. Zatrzymaj procesy i zrób kopię

Zatrzymaj działające Expo oraz serwer sklepów przez **Ctrl+C** w ich terminalach.
Otwórz PowerShell w katalogu `smart_cart` i wykonaj:

```powershell
$mapPreviewBackup = Join-Path (Get-Location).Path '.expo\map-preview-backup'
if (Test-Path -LiteralPath $mapPreviewBackup) {
    throw 'Kopia już istnieje. Najpierw zakończ poprzedni podgląd i zachowaj jego oryginalne pliki.'
}
New-Item -ItemType Directory -Path $mapPreviewBackup | Out-Null
Copy-Item -LiteralPath '.\src\features\stores\useStores.ts' -Destination (Join-Path $mapPreviewBackup 'useStores.ts')
Copy-Item -LiteralPath '.\server\serwer-mapy.mjs' -Destination (Join-Path $mapPreviewBackup 'serwer-mapy.mjs')
```

Kopia zachowuje także zmiany, które nie były jeszcze w commicie. Podczas podglądu
nie dopisuj w tych dwóch plikach innych funkcji — przywrócenie zastąpi je kopią.

## 2. Tymczasowo zmień pobieranie sklepów

Otwórz [useStores.ts](../src/features/stores/useStores.ts).
Zastąp importy na początku pliku następującymi:

```ts
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { parseCatalog, type Catalog } from './model';
```

Pozostaw istniejącą funkcję `storesUrl()` bez zmian.
Całą funkcję `export function useStores()` zastąp poniższą:

```ts
export function useStores() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    setCatalog(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        if (!__DEV__) throw new Error('Podgląd działa tylko w trybie deweloperskim.');
        const url = new URL(storesUrl());
        if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') {
          throw new Error('Podgląd wymaga lokalnego API.');
        }
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = parseCatalog(await response.json());
        if (active && !controller.signal.aborted) setCatalog(data);
      } catch {
        if (active) setError('Nie udało się pobrać sklepów. Sprawdź serwer podglądu i jego adres.');
      } finally {
        clearTimeout(timer);
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  return { catalog, loading, error, retry: () => setAttempt(n => n + 1) };
}
```

W tym wariancie nie ma wymagania `sessionKey` ani pobierania tokenu. Nadal są
walidacja katalogu, timeout, anulowanie i odrzucanie spóźnionych odpowiedzi.

## 3. Dodaj jawny tryb podglądu serwera

Otwórz [serwer-mapy.mjs](../server/serwer-mapy.mjs). Zmieniaj wyłącznie część
uruchamiania serwera na końcu pliku; funkcja `createStoreServer` pozostaje bez zmian.

**A.** Znajdź:

```js
const server=createStoreServer(load,createAccessVerifier());
```

Zastąp przez:

```js
const previewMap = process.argv.includes('--preview-map');
if (previewMap && process.env.NODE_ENV === 'production') {
  throw new Error('Podgląd mapy jest wyłączony w środowisku produkcyjnym.');
}
const server = createStoreServer(
  load,
  previewMap ? async () => ({ ok: true }) : createAccessVerifier(),
);
```

**B.** Znajdź linię:

```js
server.listen(port,'0.0.0.0',()=>{
```

Zastąp przez:

```js
server.listen(port, previewMap ? '127.0.0.1' : '0.0.0.0', () => {
```

**C.** W tym samym callbacku otocz istniejącą pętlę wypisującą adresy LAN warunkiem:

```js
if (!previewMap) {
  for (const entries of Object.values(os.networkInterfaces())) for (const i of entries ?? []) {
    if (i.family === 'IPv4' && !i.internal) {
      console.log(`Adres w sieci lokalnej: http://${i.address}:${port}/v1/stores`);
    }
  }
}
```

Bez flagi `--preview-map` serwer nadal sprawdza tokeny. Z flagą przyjmuje żądania
bez logowania i słucha wyłącznie na `127.0.0.1`. Nie wystawiaj go przez tunel
ani przekierowanie portów. Ten wariant nie służy do podglądu na telefonie.

## 4. Uruchom podgląd

Otwórz dwa nowe terminale PowerShell w katalogu `smart_cart`.
Obecne zależności pozostają bez zmian; nie trzeba ponownie instalować projektu.

**Terminal 1 — serwer podglądu:**

```powershell
$env:NODE_ENV='development'
$env:SMARTCART_DATA_PORT='8787'
npm.cmd run server -- --preview-map
```

Otwórz `http://127.0.0.1:8787/v1/stores`. Powinieneś zobaczyć JSON z katalogiem
i `count: 7753`, zamiast błędu `401`.

**Terminal 2 — aplikacja:**

```powershell
$env:EXPO_PUBLIC_STORES_API_URL='http://127.0.0.1:8787/v1/stores'
npm.cmd start -- --localhost --clear
```

Naciśnij **w**, a następnie otwórz zakładkę **Sklepy**. Powinna pojawić się mapa.
Ustawienia powyżej dotyczą tylko tych terminali; nie edytujesz `.env.local`.

Jeśli nie działa:

- `401` z `/v1/stores`: działa zwykły serwer albo nie przekazano `--preview-map`.
- Zajęty port 8787: zatrzymaj poprzedni serwer przed uruchomieniem podglądu.
- JSON działa, ale aplikacja prosi o logowanie: sprawdź podmianę całej funkcji
  `useStores()` i uruchom Expo ponownie. Samo usunięcie jednego warunku nie wystarczy.
- Aplikacja nadal zgłasza błąd danych: sprawdź adres `EXPO_PUBLIC_STORES_API_URL`
  w terminalu Expo i użycie trybu deweloperskiego.
- Katalog działa, ale nie ładuje się sam podkład mapy: potrzebne są internet,
  dostęp do zasobów MapLibre/OpenFreeMap oraz WebGL2 w przeglądarce.

Instrukcja przestanie wystarczać, gdy osoba 2 doda ochronę całej nawigacji.
Po tej integracji do testów używaj właściwego formularza i konta testowego.

## 5. Przywróć wersję z logowaniem

Zatrzymaj oba procesy przez **Ctrl+C** i zamknij ich terminale, żeby usunąć
tymczasowe zmienne środowiskowe. W nowym PowerShell, w `smart_cart`, wykonaj:

```powershell
$mapPreviewBackup = Join-Path (Get-Location).Path '.expo\map-preview-backup'
foreach ($mapPreviewFile in @('useStores.ts', 'serwer-mapy.mjs')) {
    if (!(Test-Path -LiteralPath (Join-Path $mapPreviewBackup $mapPreviewFile))) {
        throw 'Brakuje pełnej kopii. Nie przywracaj pojedynczego pliku.'
    }
}
Copy-Item -LiteralPath (Join-Path $mapPreviewBackup 'useStores.ts') -Destination '.\src\features\stores\useStores.ts' -Force
Copy-Item -LiteralPath (Join-Path $mapPreviewBackup 'serwer-mapy.mjs') -Destination '.\server\serwer-mapy.mjs' -Force
npx.cmd --no-install tsc --noEmit
```

Uruchom ponownie zwykłe `npm.cmd run server` i `npm.cmd start` w dwóch terminalach.
`/v1/stores` bez tokenu powinno ponownie zwracać `401`, a aplikacja wymagać sesji.
Kopię pozostaw do czasu potwierdzenia przywrócenia; nie nadpisuj jej kolejnym podglądem.

Podgląd nie zmienia kont, SMTP ani ustawień Supabase. Docelowa aplikacja nadal
ma wymagać logowania do wszystkich chronionych ekranów.
