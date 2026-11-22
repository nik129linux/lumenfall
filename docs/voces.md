# Voces del juego

El juego reproduce **un archivo de audio por línea de texto**. Si el archivo no existe, la línea
se lee en silencio como antes, así que se pueden ir agregando de a poco.

## Dónde van los archivos

```
assets/voices/es/<clave>.mp3     (también vale .wav)
assets/voices/en/<clave>.mp3
```

El nombre del archivo es la **clave** de la tabla de abajo. Ejemplo: la primera línea del prólogo
va en `assets/voices/es/pr1a.mp3`. Con el juego en español se usa la carpeta `es`; con `L` (cambiar
idioma) se usa `en`. Lo único obligatorio es el español.

Cada audio debe ser **solo esa línea**, sin silencio largo al inicio. Al pasar a la siguiente línea
o saltar la escena, la voz se corta sola.

## Cómo generarlas con Gemini

Una grabación por línea, con el mismo "personaje" en todas las de ese hablante. Pide a Gemini
(texto a voz) algo así, cambiando la dirección según el hablante:

> Lee en español, en tono {dirección}, sin añadir palabras: "{texto}"

| Hablante | Dirección sugerida |
|---|---|
| Narrador | voz cálida y pausada de cuentacuentos, algo grave, misterio suave |
| Anciano | voz de viejo mercader, amable en la superficie y con algo siniestro debajo, lenta |
| Kael | voz joven, cansada y seria, contenida |
| Ul Burjo | voz grave y burlona, seductora, con calma amenazante |
| El Paciente | voz profunda y lenta, melancólica, casi un susurro cansado |

Las comillas « » del texto no se leen: pide la frase sin ellas.

## Líneas

| Clave | Hablante | Español | Inglés |
|---|---|---|---|
| pr1a | Narrador | En lo profundo del bosque, una aldea guardaba la Brasa. | Deep in the forest, a village kept the Ember. |
| pr1b | Narrador | Su luz no calentaba casas. Mantenía vivo todo el bosque. | Its light did not warm houses. It kept the whole forest alive. |
| pr2a | Narrador | Cada raíz, cada hoja, cada criatura bebía de ella. | Every root, every leaf, every creature drank from it. |
| pr2b | Narrador | Kael, el guardián de la aldea, la vigilaba cada noche. | Kael, the village warden, watched over it every night. |
| deal1a | Anciano | Buenas noches, guardián. ¿Otra noche larga? | Good evening, warden. Another long night? |
| deal1b | Kael | ¿Quién eres? Nadie pasa por este camino. | Who are you? No one walks this path. |
| deal2a | Anciano | Solo un viejo mercader. Y tú, un muchacho cansado de cuidar una luz que no es suya. | Just an old merchant. And you, a boy tired of guarding a light that isn't his. |
| deal2b | Anciano | Mira. Oro, joyas... y hay mucho más. Riqueza sin fin. | Look. Gold, jewels... and there is so much more. Endless wealth. |
| deal3a | Kael | ¿Y qué quieres a cambio? | And what do you want in return? |
| deal3b | Anciano | Casi nada. Que mires hacia otro lado esta noche. Solo una noche. | Almost nothing. Look the other way tonight. Just one night. |
| deal3c | Kael | ...Una noche. | ...One night. |
| th1a | Narrador | Esa noche, el anciano entró al santuario. | That night, the old man entered the shrine. |
| th1b | Anciano | Gracias, guardián. Con esta luz, el Antiguo despertará. | Thank you, warden. With this light, the Ancient One will wake. |
| th2a | Narrador | La Brasa se apagó. El bosque empezó a morir. | The Ember went out. The forest began to die. |
| th2b | Kael | Fue mi culpa. Voy a traerla de vuelta. | This was my fault. I will bring it back. |
| cs3a | Narrador | Ul Burjo abrió la puerta sin cerradura. | Ul Burjo opened a door that had no lock. |
| cs3b | Ul Burjo | Te prometí riqueza infinita. Solo faltaba el precio. | I promised you infinite wealth. I only forgot the price. |
| cs3c | Narrador | Detrás de él, algo despertó y el aire se puso naranja. | Behind him something woke, and the air turned orange. |
| cs4a | Narrador | El Paciente abre la mano. La linterna cae al suelo. | The Patient One opens his hand. The lantern hits the ground. |
| cs4b | El Paciente | Llevo tanto tiempo esperando la luz que ya no sé apagarla. | I have waited so long for the light that I no longer remember how to put it out. |
| cs4c | Narrador | Kael apagó la espada. En la oscuridad, solo quedó su respiración. | Kael put out his sword. In the dark, only his breathing remained. |
| cs5a | Narrador | La Brasa era pequeña. Había viajado muy lejos para caber en una mano. | The Ember was small. It had travelled very far to fit in one hand. |
| cs5b | Narrador | Kael la levantó y la devolvió al pueblo que la había perdido. | Kael lifted it and gave it back to the village that had lost it. |
| cs5c | Narrador | El verde volvió primero a las hojas. Después a las piedras. | The green came back to the leaves first. Then to the stone. |
| cs5d | Narrador | Nadie supo el nombre que el viejo había llevado antes. | No one ever learned the name the old man had worn. |
| cs5e | Narrador | Eso tampoco importó. La luz había vuelto a casa. | It did not matter. The light had come home. |

Son 26 líneas en total.

## Probar una cutscene sin jugar todo

Con el juego abierto: `index.html?cutscene=prologue` (también `theft`, `reveal`, `waking`, `return`).
