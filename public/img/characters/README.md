Retratos de personajes.

Nombra cada fichero como el `id` del personaje (ver `server/characterData.js`)
más su extensión, por ejemplo `luffy.jpg`. Después añade la entrada
correspondiente en el objeto `PORTRAITS` de `server/characterData.js`:

```js
const PORTRAITS = {
  luffy: 'luffy.jpg',
};
```

Cualquier personaje sin entrada aquí sigue mostrando su cartel de iniciales
automáticamente — no hace falta tener las 40 imágenes para empezar a usar esto.
