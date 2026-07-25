`three.module.min.js` es Three.js r160, copiado tal cual de
`node_modules/three/build/three.module.min.js`.

Va incluido en el repo (en vez de cargarse desde un CDN) para que el juego
no dependa de un tercero: carga más rápido, funciona en redes que bloquean
CDNs, y no se rompe si el CDN cambia o cae.

Para actualizarlo:

```bash
npm install three@<version>
cp node_modules/three/build/three.module.min.js public/vendor/three.module.min.js
npm uninstall three
```
