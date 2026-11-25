# LUMENFALL — video de presentación

**Proyecto de:** Nico, Juanda y Mario
**Presentación a cargo de:** Mario (MarioZaMu)
**Juego:** <https://lumenfall.acompana-mobile.workers.dev>

[▶ Ver el video](Lumenfall-presentacion.mp4) · 5:00 · 1920×1080 · 30 fps · H.264 + AAC · 38 MB

Recorrido completo por el juego: historia, los tres niveles, los tres jefes, el
final, la IA adaptativa y cómo se hizo. Está pensado para que quien presenta
hable encima; entre **0:18 y 0:31** suenan las voces del propio juego y no hay
que decir nada.

## Qué se ve

| Tiempo | Escena |
|---|---|
| 0:00–0:14 | Apertura: título y menú |
| 0:14–0:36 | Historia: prólogo, el trato del anciano y el robo de la Brasa |
| 0:36–1:20 | Nivel 1, con los controles en pantalla |
| 1:20–1:48 | Jefe 1, la Momia de Mármol |
| 1:48–2:26 | Nivel 2 y el cambio de mundo con `E` |
| 2:26–3:00 | Jefe 2, Ul Burjo |
| 3:00–3:34 | Nivel 3 y El Paciente |
| 3:34–3:52 | Final |
| 3:52–4:22 | Por dentro: IA adaptativa, hitboxes (`?hitbox=1`) y métricas |
| 4:22–4:48 | Tarjetas: tecnología, arte y números |
| 4:48–5:00 | Cierre con créditos y enlace del juego |

## Cómo está hecho

- Grabado desde el build de `master` (`ae443fc`), con los mismos archivos que el
  juego desplegado. Un bot pulsa las teclas reales; el reloj del navegador avanza
  cuadro a cuadro, así que el resultado es exacto y repetible.
- Música ambiental original, sonidos generados con el propio `js/core/audio.js` y
  las voces de `assets/voices/es/`.
- Esta es la versión ligera. La de máxima calidad (139 MB) supera el límite de
  100 MB por archivo de GitHub y no está en el repositorio.
