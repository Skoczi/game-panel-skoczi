# Game Panel · Skoczi Edition

Fork [OVHcloud Game Panel](https://github.com/ovh/game-panel) 1.5.0. Aktualna wersja kodu: **1.5.0-skoczi.9 (preview)**, w stopce **v1.5.0 · Revision 9**. Nie jest to oficjalne wydanie OVHcloud. Skoczi jest autorem zmian forka, nie projektu bazowego.

## Co zmieniłem?

- **Game Servers**: jedna lista przypisanych serwerów ze wszystkich lokalizacji. Użytkownik otwiera serwer, a panel automatycznie łączy go z właściwym agentem — bez wyboru node’a. Administrator nadaje uprawnienia przy serwerze w **Access**. [Zasady dostępu](FLEET.md).
- **Nodes**: infrastruktura wyłącznie dla administratorów root. Osobne środowiska wykonawcze, pliki i alokacje IP/portów; bez automatycznej migracji. Panel i agenty wymagają aktualizacji do Revision 8 dla dostępu zwykłych użytkowników. [Instalacja i ograniczenia](NODES.md).

- Wybór IPv4 hosta przy każdym mapowaniu TCP/UDP.
- Osobne zakresy dozwolonych portów TCP i UDP dla każdego IP.
- Zakładka **Settings** dla głównego administratora: IP, aliasy, zakresy portów i podgląd przypisanych serwerów.
- Przełączniki Follow Us i Trustpilot oraz stopka Game Panel · Skoczi Edition z wersją, rewizją i odnośnikiem do projektu OVHcloud.
- Ten sam port może działać na różnych IP. Nakładające się przypisania są odrzucane.
- Kilka mapowań jednego portu kontenera nie nadpisuje się nawzajem.
- Lista serwerów i kopiowanie adresu pokazują wybrane IP gry.
- Telemetria nowych instalacji jest domyślnie wyłączona.
- Aktualizacje są ręczne; informacje o wydaniach pochodzą z tego repozytorium.

[Changelog](../../CHANGELOG-SKOCZI.md) · [Mapa zmian względem OVH](CHANGES.md)

## IP i porty

Główny administrator ustawia reguły w **Nodes → Node settings → IP allocations** przy wybranym node, również Local. Globalne Settings służy do wyglądu panelu i logowania. Dodaj IP, alias i osobne zakresy TCP/UDP, włącz ograniczenie publikowanych portów i zapisz. Ten sam adres jest rezerwowany tylko dla jednego node w panelu. Zajętego IP lub portu nie można usunąć z puli bez wcześniejszej zmiany przypisania serwera. Zapis działa bez restartu backendu. Brak potwierdzenia od agenta zachowuje rezerwacje; przycisk **Retry pending save** ponawia tę samą operację. Szczegóły i ograniczenia: [Settings](SETTINGS.md#cross-node-ownership).

Przy pierwszym uruchomieniu nowej wersji reguły są importowane z `/opt/gamepanel/deploy/.env`. Później źródłem ustawień jest baza panelu — zmiana `.env` nie nadpisze zapisanych reguł. Przykład importu używa adresów dokumentacyjnych:

```dotenv
GAMEPANEL_IP_PORTS='{"192.0.2.10":{"tcp":"27015-27030,28015","udp":"27015-27030"},"192.0.2.11":{"udp":"28015-28020"}}'
```

Ta konfiguracja pozwala wystawić TCP `27015–27030` i `28015` oraz UDP `27015–27030` na pierwszym IP. Drugie IP pozwala wyłącznie na UDP `28015–28020`. Hostowy `8080` jest zabroniony. Port wewnątrz kontenera może być inny, np. `8080`.

Po ustawieniu reguł wybór konkretnego IP jest obowiązkowy. Backend odrzuca niedozwolone mapowania również przy bezpośrednich żądaniach API oraz przy tworzeniu, starcie, restarcie i odtwarzaniu kontenera przez panel. Brak protokołu w regule oznacza zakaz jego użycia. Błędna konfiguracja nie przełącza panelu na nieograniczony dostęp.

`GAMEPANEL_IP_PORTS` przy imporcie zastępuje listę `GAMEPANEL_BIND_IPS`. Bez niego zachowany jest tryb starszej wersji. Aby wymuszać zakresy, włącz **Restrict published ports to these allocations** w Settings.

W sekcji **Appearance** można ukryć Follow Us oraz Trustpilot. Numer wersji w stopce pochodzi z pakietu aplikacji. Ustawienia przetrwają restart; zapis drugiej sesji administratora nie nadpisze po cichu nowszych zmian. [Opis Settings i API](SETTINGS.md).

Instrukcja wdrożenia, odpowiedź API i przykłady: [IP i zakresy portów](ADDITIONAL-IPS.md).

## Instalacja

Zacznij od [instrukcji instalacji](INSTALLATION.md) na osobnej maszynie testowej. Standardowy instalator używa Traefika i portów **80/443** — nie integruje się automatycznie z istniejącym reverse proxy.

Adresy IP muszą być już skonfigurowane w systemie. Panel nie tworzy interfejsów, tras ani reguł firewalla. Zmiana zakresów nie zatrzymuje działających kontenerów; bezpośrednie polecenia Dockera i jego automatyczny restart nie przechodzą przez walidację panelu. Reguły są wspólne dla użytkowników, nie przypisane do konkretnych kont.

Backend ma dostęp administracyjny do Dockera. [Ograniczenia](LIMITATIONS.md) · [Testy](DEVELOPMENT.md)

## Autorstwo

Oryginał: [ovh/game-panel](https://github.com/ovh/game-panel). Licencja Apache 2.0 i autorstwo OVH są zachowane. Zmiany Skoczi mają oddzielny changelog. Nie dodawaj do repozytorium konfiguracji produkcyjnej, baz, kluczy ani logów z sekretami.

## Personalizacja w .4

W **Settings → Branding & login page** zmienisz nazwę panelu, podtytuł, logo, opis logowania i stopkę. Logo można wgrać jako PNG/JPEG/WebP (do 256 KiB) lub podać link HTTPS. W **Appearance** wyłączysz aktualności, Follow Us i Trustpilot. Podgląd pokazuje zmiany przed zapisem; zapis nie wymaga przebudowy ani restartu.

**Login page theme** ustawia jasny lub ciemny ekran logowania albo dopasowuje go do systemu odwiedzającego. Nie zmienia osobistego motywu panelu po zalogowaniu. Po aktualizacji pozostaje dotychczasowy jasny wariant, dopóki administrator nie wybierze innego.

Te pola są publiczne również przed zalogowaniem. Nie wpisuj sekretów. Aktualizacja zachowuje wcześniejsze adresy, porty i przełączniki. Powrót z .4 do .3 wymaga również kopii bazy sprzed aktualizacji. [Szczegóły](SETTINGS.md).
