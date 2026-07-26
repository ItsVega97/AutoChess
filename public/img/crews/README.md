# Jolly Rogers de las tripulaciones

Aquí van las banderas piratas (Jolly Roger) de cada tripulación. Sustituyen al
emoji que se usa ahora en la Wiki, en el panel de combos de la partida y en las
fichas de personaje.

| Archivo | Tripulación |
|---|---|
| `strawhat.png` | 🏴‍☠️ Sombrero de Paja |
| `whitebeard.png` | 🌊 Piratas de Barbablanca |
| `bigmom.png` | 🍰 Piratas de Big Mom |
| `beast.png` | 🐉 Piratas de las Bestias |
| `redhair.png` | ⚡ Piratas Pelirrojos |
| `blackbeard.png` | 🌑 Piratas de Barbanegra |
| `roger.png` | 👑 Piratas de Roger |
| `baroque.png` | 🕶️ Baroque Works |

## Formato

- **PNG con fondo transparente**, cuadrado. Con 128x128 sobra: en pantalla se ven
  a 16-22 px, y en la Wiki a 26 px.
- El nombre del archivo tiene que ser exactamente el de la tabla (minúsculas).
- Las mayúsculas del nombre dan igual (`Beast.PNG` también vale), pero la
  extensión ha de ser `.png`, `.webp` o `.svg`.

Un emoji sigue apareciendo mientras no esté su imagen, así que se pueden ir
subiendo de una en una.

## De dónde sacarlas

Lo más rápido, desde la raíz del proyecto:

```bash
node tools/fetch-flags.js
```

Busca cada bandera en la [One Piece Wiki en español](https://onepiece.fandom.com/es)
con su API, la descarga aquí con el nombre correcto y te dice cuáles ha cogido.
Si alguna falla o baja la que no es, pásale la URL a mano (clic derecho sobre la
imagen en la wiki → "Copiar dirección de la imagen"):

```bash
node tools/fetch-flags.js beast=https://static.wikia.nocookie.net/.../bandera.png
```

También vale bajarlas a mano y renombrarlas según la tabla de arriba.
