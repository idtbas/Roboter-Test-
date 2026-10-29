# Maker-Werkstatt 3D

Eine realistische 3D-Werkstatt im Browser, in der du echte Maker-Geräte bedienst, als stünden sie vor dir. Gedacht für alle, die das Gefühl haben wollen, einen 3D-Drucker oder Laser zu besitzen, ohne gleich einen zu kaufen.

**Die Regel dabei:** Jedes Gerät lässt sich nur über seine eigenen Bedienelemente steuern. Hat das echte Gerät ein Display mit Drehknopf, bedienst du hier das Display mit dem Drehknopf. Hat es kein Display, steuerst du es wie in echt per Software auf dem Laptop. Zusätzliche „magische“ Knöpfe gibt es nicht.

## Die Geräte

| Gerät | Typ | Bedienung |
|---|---|---|
| **Original Prusa MK4S** | FDM-3D-Drucker, 250 × 210 × 220 mm | 3,5″-Farbdisplay mit Drehknopf, USB-Stick, Netzschalter am Netzteil |
| **Ortur Laser Master 3** | 10-W-Diodenlaser, 400 × 400 mm | kein Display: Netztaster, Schlüsselschalter, Not-Aus, Steuerung per USB vom Laptop (GRBL) |
| **ELEGOO Mars 4 (9K)** | MSLA-Resin-Drucker, 153 × 78 × 175 mm | 3,5″-Touchscreen, USB-Stick, Netzschalter hinten |

### Original Prusa MK4S
- Detailliertes Modell: Aluprofil-Rahmen, Z-Achsen mit Gewindespindeln, Nextruder, Textur-PEI-Federstahlblech, xLCD, Netzteil und Filamentspule.
- Firmware im Stil des Prusa-Buddy-Menüs (Deutsch/Englisch): Drucken, Vorheizen, Filament (laden, entladen, wechseln, spülen), Steuerung (Achsen bewegen, Temperaturen, Auto-Home, Kalibrierungen & Tests), Einstellungen, Info, Tune-Menü während des Drucks, Pause und Stopp.
- Echter G-Code-Interpreter mit Bewegungsplaner (Beschleunigung, Lookahead, Junction Deviation), Heizungs-Thermik mit PID-Regelung, Referenzfahrt, Mesh-Bed-Leveling per Antippen mit der Düse, Filamentwechsel (M600), Kaltextrusionsschutz.
- Das Filament wird in Echtzeit als 3D-Raupe abgelegt, genau dort, wo die Düse gerade druckt.
- **Eigene Dateien:** `.gcode` und `.bgcode` aus PrusaSlicer (Profil MK4/MK4S) sowie STL-Modelle. Für STL ist ein Slicer eingebaut (Perimeter, Infill, Top/Bottom-Schichten, Spiralvase).
- Fertige Drucke nimmst du ab, indem du das Blech abnimmst und es anklickst, damit sich das Teil löst.

### Ortur Laser Master 3
- GRBL-1.1-Emulation: `$$`, `$H`, `$X`, `$J=`, `?`, `!`, `~`, Strg-X, Overrides, Alarme, Soft-Limits, Laser-Modus `M3`/`M4`, Druckluft `M8`.
- Laptop mit der Laser-Software „LaserWerk“: COM-Port verbinden, Konsole für eigene Befehle, Jog-Steuerung, Formen, Text und Bilder (mit Dithering), Material-Vorgaben, Rahmen fahren, Start/Pause/Stopp und Zeitschätzung. Gestreamt wird wie in echt per Zeichenzähl-Protokoll über 115200 Baud.
- Brennsimulation über die Energiedichte: Verfärbung, Abtrag und Durchschneiden hängen von Leistung, Geschwindigkeit, Durchgängen und **Fokus** ab. Dazu kommen Rauch, Funken, das blaue Laserlicht und eine Laserschutzbrille zum Aufsetzen.
- Sieben Materialien: Sperrholz, MDF, Graupappe, Leder, schwarzes Acryl, Schiefer und eloxiertes Aluminium.

### ELEGOO Mars 4
- Bernsteinfarbene UV-Haube, Z-Turm mit Linearschiene, Druckplattform, Resin-Wanne mit FEP-Folie, 7″-Mono-LCD und UV-Licht.
- Echter Belichtungszyklus: Absenken, Wartezeit, Belichtung der Schichtmaske auf dem LCD, Abziehen (Peel), dann die nächste Schicht. Das Bauteil wächst kopfüber an der Plattform.
- Resin einfüllen und verbrauchen, Wanne reinigen, Belichtungstest, Nivellieren und manuelles Bewegen der Z-Achse.
- Nach dem Druck wird das Bauteil entnommen, in IPA gewaschen und mit UV nachgehärtet.

## Zeit

Alles läuft standardmäßig in **Echtzeit**: Ein 20-mm-Würfel braucht etwa eine Viertelstunde, ein Resin-Bauer gut anderthalb Stunden. Oben rechts lässt sich die Zeit bis 100-fach beschleunigen. Die Geräte arbeiten auch weiter, wenn du den Tab verlässt. Beim Zurückkommen wird die verpasste Zeit nachgeholt.

## Bedienung

- **Kamera:** Mit der linken Maustaste auf einer freien Fläche drehst du, mit der rechten Maustaste verschiebst du, mit dem Mausrad zoomst du. Unten findest du die Kamera-Positionen für jedes Gerät.
- **Anfassen:** Alles, was beim Überfahren aufleuchtet, kannst du anklicken.
- **Drehknopf (Prusa):** Mausrad oder Ziehen dreht den Knopf, ein Klick drückt ihn. Alternativ gehen Pfeiltasten und Enter.
- **Laptop (Laser):** Wähle die Kamera „Laptop“ und bediene ihn dann wie einen normalen PC. Getippt wird mit deiner eigenen Tastatur.

## Lokal starten

```bash
npm install
npm run dev      # Entwicklungsserver
npm run build    # Produktions-Build nach dist/
```

## Veröffentlichung über GitHub Pages

Der Workflow `.github/workflows/deploy.yml` baut die Seite bei jedem Push und veröffentlicht sie.

Einmalig musst du Pages einschalten:

1. Öffne im Repository **Settings → Pages**.
2. Wähle unter **Build and deployment → Source** den Eintrag **GitHub Actions**.
3. Pushe danach erneut oder starte den Workflow unter **Actions** von Hand.

Die Seite ist danach unter `https://<benutzername>.github.io/<repository>/` erreichbar.

## Technik

- [three.js](https://threejs.org/) mit WebGL, PBR-Materialien, Image-Based Lighting, weichen Schatten, Ambient Occlusion (GTAO) und Bloom.
- Alle Modelle, Texturen und Geräusche werden prozedural erzeugt. Es gibt keine externen Assets.
- [Clipper](https://sourceforge.net/projects/jsclipper/) für die Polygon-Operationen im Slicer, der in einem Web Worker läuft.
- [Vite](https://vitejs.dev/) als Build-Werkzeug.

## Hinweis

Dies ist ein unabhängiges Fan- und Lernprojekt. Prusa, Original Prusa, Nextruder, Prusament, ORTUR, Laser Master und ELEGOO/Mars sind Marken ihrer jeweiligen Inhaber. Es besteht keine Verbindung zu den Herstellern. Die Geräte sind nach öffentlich bekannten Daten nachgebaut und an manchen Stellen vereinfacht. Die Simulation ersetzt keine Sicherheitsunterweisung: Echte Laser der Klasse 4 und Resin erfordern Schutzausrüstung.
