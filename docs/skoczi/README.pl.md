# OVH Game Panel by Skoczi

Fork OVHcloud Game Panel 1.5.0. Aktualna rewizja: **1.5.0-skoczi.2 (preview)**. Nie jest to oficjalne wydanie OVHcloud.

## Co zmieniłem?

- Wybór IPv4 hosta przy każdym mapowaniu TCP/UDP.
- Osobne zakresy dozwolonych portów TCP i UDP dla każdego IP.
- Ten sam port może działać na różnych IP. Nakładające się przypisania są odrzucane.
- Kilka mapowań jednego portu kontenera nie nadpisuje się nawzajem.
- Lista serwerów i kopiowanie adresu pokazują wybrane IP gry.
- Telemetria nowych instalacji jest domyślnie wyłączona.
- Aktualizacje są ręczne; informacje o wydaniach pochodzą z tego repozytorium.

[Changelog](../../CHANGELOG-SKOCZI.md) · [Mapa zmian względem OVH](CHANGES.md)

## IP i porty

Administrator ustawia reguły w `/opt/gamepanel/deploy/.env`. Przykład używa adresów dokumentacyjnych — zastąp je własnymi:

```dotenv
GAMEPANEL_IP_PORTS='{"192.0.2.10":{"tcp":"27015-27030,28015","udp":"27015-27030"},"192.0.2.11":{"udp":"28015-28020"}}'
```

Ta konfiguracja pozwala wystawić TCP `27015–27030` i `28015` oraz UDP `27015–27030` na pierwszym IP. Drugie IP pozwala wyłącznie na UDP `28015–28020`. Hostowy `8080` jest zabroniony. Port wewnątrz kontenera może być inny, np. `8080`.

Po ustawieniu reguł wybór konkretnego IP jest obowiązkowy. Backend odrzuca niedozwolone mapowania również przy bezpośrednich żądaniach API oraz przy tworzeniu, starcie, restarcie i odtwarzaniu kontenera przez panel. Brak protokołu w regule oznacza zakaz jego użycia. Błędna konfiguracja nie przełącza panelu na nieograniczony dostęp.

`GAMEPANEL_IP_PORTS` zastępuje listę `GAMEPANEL_BIND_IPS`. Bez nowej zmiennej zachowane jest stare działanie: lista IP i opcjonalne mapowanie na wszystkie interfejsy. Aby ograniczać porty, trzeba więc **ustawić nową zmienną** i odtworzyć kontener backendu.

Instrukcja wdrożenia, odpowiedź API i przykłady: [IP i zakresy portów](ADDITIONAL-IPS.md).

## Instalacja

Zacznij od [instrukcji instalacji](INSTALLATION.md) na osobnej maszynie testowej. Standardowy instalator używa Traefika i portów **80/443** — nie integruje się automatycznie z istniejącym reverse proxy.

Adresy IP muszą być już skonfigurowane w systemie. Panel nie tworzy interfejsów, tras ani reguł firewalla. Zmiana zakresów nie zatrzymuje działających kontenerów; bezpośrednie polecenia Dockera i jego automatyczny restart nie przechodzą przez walidację panelu. Reguły są wspólne dla użytkowników, nie przypisane do konkretnych kont.

Backend ma dostęp administracyjny do Dockera. [Ograniczenia](LIMITATIONS.md) · [Testy](DEVELOPMENT.md)

## Autorstwo

Oryginał: [ovh/game-panel](https://github.com/ovh/game-panel). Licencja Apache 2.0 i autorstwo OVH są zachowane. Zmiany Skoczi mają oddzielny changelog. Nie dodawaj do repozytorium konfiguracji produkcyjnej, baz, kluczy ani logów z sekretami.
