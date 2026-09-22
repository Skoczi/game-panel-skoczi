# Etap 4 — API integracyjne v1

Wersja 2.0.49, lokalnie. Etap zakończony lokalnie. Panel oraz agent wymagają wspólnej aktualizacji przed wdrożeniem.

## Dostęp

Menu konta → **API tokens**. Nazwa, termin 1–365 dni, konkretne serwery i potrzebne operacje. Scope: `servers.read`, `resources.read`, `backups.read`, `backups.create`, `operations.read`. Tworzenie kopii w formularzu dołącza odczyt jej statusu. Uprawnienia nie są domyślnie rozszerzane na przyszłe serwery.

Losowy sekret `gpp_` ma 256 bitów i pojawia się wyłącznie po utworzeniu. Baza przechowuje SHA-256 sekretu. Lista pokazuje nazwę, zakres, wygaśnięcie, ostatnie użycie i unieważnienie; nie zwraca sekretu ani skrótu. Unieważnienie wymaga potwierdzenia. Po utracie odpowiedzi tworzenia UI wymaga odświeżenia listy; nie ponawia zapisu automatycznie. Sekret nie trafia do pamięci przeglądarki poza stanem otwartego formularza.

Zarządzanie `/api/api-tokens` wymaga sesji panelu. API bearer nie działa na zwykłych endpointach panelu i nie może tworzyć innych tokenów. Każde żądanie v1 sprawdza aktywność konta, wygaśnięcie/unieważnienie tokenu, scope, serwer i aktualne uprawnienia właściciela. Usunięcie członkostwa odbiera dostęp również tokenowi; nie ma tokena z nieograniczonym uprawnieniem root.

## Kontrakt

[OpenAPI v1](openapi-v1.json) jest kontraktem zaimplementowanych endpointów:

| Metoda i ścieżka | Zakres |
|---|---|
| GET `/api/v1/servers` | Lista dostępnych serwerów |
| GET `/api/v1/servers/{id}` | Wybrany rekord inwentaryzacji |
| GET `/api/v1/servers/{id}/resources` | Zasoby i czas obserwacji |
| GET `/api/v1/servers/{id}/backups` | Metadane backupów |
| POST `/api/v1/servers/{id}/backups` | Utworzenie kopii Native, odpowiedź 202 |
| GET `/api/v1/operations/{id}` | Status własnej operacji backupu |

ID serwera jest globalnym UUID z floty, nie lokalnym numerem runtime. Listy mają `limit` 1–100 (domyślnie 50), `after` i `nextCursor`. Czas jest w UTC ISO 8601. Każda odpowiedź zawiera `requestId`, także w `X-Request-ID`, oraz `Cache-Control: no-store`. Błędy mają `error.code` i `error.message`.

API nie obejmuje restore, terminala, zapisu plików, instalacji ani użytkowników. Działa na panelu; połączenia z agentem są podpisane i delegowane do jednego runtime z minimalnym uprawnieniem. Token klienta nie trafia do agenta. Brak przekierowań, czas żądania do agenta do 15 s, limit odpowiedzi 16 KiB (lista backupów 1 MiB / 2000 wpisów).

## Zasoby

Próbka runtime jest ważna 35 s. CPU: vCPU; RAM i dysk: bajty; procenty dotyczą przyznanych limitów. Brak aktualnej próbki daje `resources: null`, nie zero. `observedAt` oznacza złożenie próbki; pomiar dysku ma osobny cache. Status inwentaryzacji także ma czas obserwacji. Zegary panelu i agenta muszą być zsynchronizowane. Starszy agent bez endpointu zasobów zwraca w API 503.

## Backup i ponowienia

`Idempotency-Key` jest wymagany: 16–128 liter ASCII, cyfr, podkreśleń lub myślników; UUID jest poprawny. Panel zapisuje operację przed wysłaniem żądania. Ten sam token + klucz + efektywna nazwa i serwer zwracają tę samą operację. Inna treść pod tym samym kluczem daje 409. Po restarcie niedokończone wysłanie zostaje oznaczone `uncertain`, nigdy automatycznie ponowione. Rekordy deduplikacji pozostają w bazie.

Przy utracie odpowiedzi ponawiaj wyłącznie z tym samym kluczem. `Location` wskazuje status operacji. 202 oznacza przyjęcie, a nie ukończenie backupu. `outcome_uncertain` wymaga sprawdzenia historii i plików w panelu przed użyciem nowego klucza. Zmiana tokenu tworzy nowy zakres kluczy, dlatego nie należy rotować tokenu pomiędzy ponowieniami tego samego żądania.

Kopia korzysta z istniejących zadań Native: nazwa jest opcjonalna, serwer może działać, archiwum obejmuje `serverfiles`, zapis odbywa się w `data/backups`. Nie ma drugiego silnika backupów. Odczyt operacji wymaga jej właściciela, serwera w zakresie tokenu i aktualnego `backups.create`. Zastąpiony runtime daje 409, niedostępny węzeł 503; API nie zgaduje wyniku.

## Ograniczenie tempa

120 żądań/min na token i 240/min na rzeczywisty adres połączenia. Wspólny reverse proxy dzieli drugi limit. `X-Forwarded-For` klienta nie wpływa na licznik. 429 zawiera `Retry-After`; liczniki są lokalne w pamięci i zerują się po restarcie. Obsługiwana jest jedna aktywna instancja panelu na bazę, zgodnie z obecnym wdrożeniem.

## Przykłady

Zmienne ustaw lokalnie; nie zapisuj sekretu w repozytorium.

```sh
curl --fail-with-body --header "Authorization: Bearer $GAME_PANEL_API_TOKEN" \
  "$GAME_PANEL_URL/api/v1/servers?limit=50"
```

Nadaj stały klucz jednej logicznej operacji i zachowaj go do jej rozstrzygnięcia:

```sh
curl --fail-with-body --include \
  --header "Authorization: Bearer $GAME_PANEL_API_TOKEN" \
  --header "Idempotency-Key: $BACKUP_REQUEST_ID" \
  --header 'Content-Type: application/json' \
  --data '{"name":"Before update"}' \
  "$GAME_PANEL_URL/api/v1/servers/$SERVER_ID/backups"

curl --fail-with-body --header "Authorization: Bearer $GAME_PANEL_API_TOKEN" \
  "$GAME_PANEL_URL/api/v1/operations/$OPERATION_ID"
```

401: nieaktywny token/konto; 403: brak scope; 404: zasób poza dostępem; 409: konflikt klucza, niepewny zapis lub zastąpiony runtime; 429: limit tempa; 503: odczyt/przyjęcie niedostępne. Szczegóły podaje stabilny `error.code`.

## Rollback

Nowe tabele `api_tokens` i `api_operations` powstają na panelu. Nie usuwają istniejących danych. Przed wdrożeniem wymagane są snapshot bazy i danych oraz sparowane obrazy panelu/agenta. Rollback całej pary przywraca wcześniejszy frontend; starszy panel nie oferuje tego API. Nie należy kasować dziennika operacji podczas zwykłego restartu ani odzyskiwania po utracie odpowiedzi.

## Odbiór lokalny — 21.09.2026

143/143 testów backendu, 165/165 testów UI w headless Chromium, build obu aplikacji. Odbiór Linux: 143 testy backendu, 3 testy awarii, 1 pełna integracja panel–agent. Prawdziwe HTTP potwierdziło ograniczenie tokenu do serwera, unieważnienie, zasoby, listę archiwów, ukończony backup Native i brak drugiej kopii po ponowieniu oraz restarcie panelu. Osobne testy sprawdzają niepewny zapis, przerwany dziennik, zmianę runtime i utratę uprawnień. Bez zrzutów ekranu i bez wdrożenia.
