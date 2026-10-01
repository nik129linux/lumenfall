// Every piece of player-facing text in the game. Nothing else is allowed to
// hardcode a string: gameplay code calls t('key'), so switching language is a
// single re-render rather than a hunt through the source.
//
// Spanish is the default because that is the game's original language.

export const STRINGS = {
  es: {
    // ---- title / menu
    title: 'LUMENFALL',
    subtitle: 'La caída de la luz',
    newGame: 'Nueva partida',
    continueGame: 'Continuar',
    difficulty: 'Dificultad',
    diffEasy: 'Fácil',
    diffNormal: 'Normal',
    diffHard: 'Difícil',
    language: 'Idioma',
    controls: 'Controles',
    back: 'Volver',
    start: 'Comenzar',
    quit: 'Salir del juego',

    // ---- controls panel
    ctlMove: 'Mover',
    ctlJump: 'Saltar',
    ctlAttack: 'Atacar',
    ctlDash: 'Esquivar',
    ctlRotate: 'Girar el nivel',
    ctlPause: 'Pausa',
    ctlLang: 'Cambiar idioma',
    ctlKeysMove: 'A / D  ·  ← / →',
    ctlKeysJump: 'Espacio  ·  W',
    ctlKeysAttack: 'J  ·  Z',
    ctlKeysDash: 'K  ·  X  ·  Mayús',
    ctlKeysRotate: 'E',
    ctlKeysPause: 'Esc  ·  P',
    ctlKeysLang: 'L',
    ctlRotNote: 'Solo en el Relicario',

    // ---- HUD
    ember: 'Brasa',
    hp: 'Vida',
    dashReady: 'Listo',
    dashCharging: 'Recargando',
    phase: 'Fase',
    rotateHint: 'Gira: E',
    rotateWorld: 'Pulsa E para girar el mundo',
    saveNote: 'Autoguardado',
    paused: 'Pausa',
    resume: 'Reanudar',
    retry: 'Reintentar',
    toTitle: 'Al título',
    youDied: 'Has caído',
    hint: 'Pista',

    // ---- levels
    level1: 'Santuario de la Brasa',
    level2: 'Relicario Corrupto',
    level3: 'Bosque de las Linternas',

    // ---- bosses
    bossStatue: 'Momia de Mármol',
    bossUlBurjo: 'Ul Burjo',
    bossPatient: 'El Paciente',
    bossReveal: 'El Anciano',

    // ---- cutscenes
    cs1Title: 'El Anciano',
    cs1a: '«¿No estás cansado, muchacho? Yo podría cumplir tus sueños.»',
    cs1b: 'Kael no bajó la espada. Nadie lo hace en esa cuesta.',
    cs1c: 'El viejo sonrió con una boca que tenía demasiados dientes.',

    // ---- prologue (narration only, no speaker)
    pr1a: 'En lo profundo del bosque, una aldea guardaba la Brasa.',
    pr1b: 'Su luz no calentaba casas. Mantenía vivo todo el bosque.',
    pr2a: 'Cada raíz, cada hoja, cada criatura bebía de ella.',
    pr2b: 'Kael, el guardián de la aldea, la vigilaba cada noche.',

    // ---- the elder's deal
    spkElder: 'Anciano',
    spkKael: 'Kael',
    deal1a: 'Buenas noches, guardián. ¿Otra noche larga?',
    deal1b: '¿Quién eres? Nadie pasa por este camino.',
    deal2a: 'Solo un viejo mercader. Y tú, un muchacho cansado de cuidar una luz que no es suya.',
    deal2b: 'Mira. Oro, joyas... y hay mucho más. Riqueza sin fin.',
    deal3a: '¿Y qué quieres a cambio?',
    deal3b: 'Casi nada. Que mires hacia otro lado esta noche. Solo una noche.',
    deal3c: '...Una noche.',

    // ---- the theft
    th1a: 'Esa noche, el anciano entró al santuario.',
    th1b: 'Gracias, guardián. Con esta luz, el Antiguo despertará.',
    th2a: 'La Brasa se apagó. El bosque empezó a morir.',
    th2b: 'Fue mi culpa. Voy a traerla de vuelta.',


    cs3Title: 'La Ofrenda',
    cs3a: 'Ul Burjo abrió la puerta sin cerradura.',
    cs3b: '«Te prometí riqueza infinita. Solo faltaba el precio.»',
    cs3c: 'Detrás de él, algo despertó y el aire se puso naranja.',

    cs4Title: 'El Despertar',
    cs4a: 'El Paciente abre la mano. La linterna cae al suelo.',
    cs4b: '«Llevo tanto tiempo esperando la luz que ya no sé apagarla.»',
    cs4c: 'Kael apagó la espada. En la oscuridad, solo quedó su respiración.',

    cs5Title: 'El Regreso',
    cs5a: 'La Brasa era pequeña. Había viajado muy lejos para caber en una mano.',
    cs5b: 'Kael la levantó y la devolvió al pueblo que la había perdido.',
    cs5c: 'El verde volvió primero a las hojas. Después a las piedra.',
    cs5d: 'Nadie supo el nombre que el viejo había llevado antes.',
    cs5e: 'Eso tampoco importó. La luz había vuelto a casa.',

    // ---- ending
    endingTitle: 'FIN',
    endingSub: 'La luz ha vuelto',
    endingCredits: 'LUMENFALL',
    endingRestart: 'Volver a jugar',
    endingTitle2: 'Menú',

    // ---- misc
    loading: 'Cargando',
    skip: 'Saltar',
    pressAny: 'Pulsa cualquier tecla',
    zoneShrine: 'Santuario',
    zoneReliquary: 'Relicario',
    zoneWood: 'Bosque',

    // ---- metrics panel
    menuMetrics: 'Métricas',
    metricsTitle: 'Métricas de partida',
    metricsLevel: 'Nivel',
    metricsStarts: 'Inicios',
    metricsCompletes: 'Completados',
    metricsRate: '% completado',
    metricsDeaths: 'Muertes',
    metricsAvgTime: 'Tiempo medio',
    metricsZones: 'Zonas con más muertes',
    metricsClose: 'Cerrar',
    metricsEmpty: 'Todavía no hay datos. Juega una partida para empezar a registrar métricas.',
  },

  en: {
    title: 'LUMENFALL',
    subtitle: 'The fall of light',
    newGame: 'New game',
    continueGame: 'Continue',
    difficulty: 'Difficulty',
    diffEasy: 'Easy',
    diffNormal: 'Normal',
    diffHard: 'Hard',
    language: 'Language',
    controls: 'Controls',
    back: 'Back',
    start: 'Start',
    quit: 'Quit',

    ctlMove: 'Move',
    ctlJump: 'Jump',
    ctlAttack: 'Attack',
    ctlDash: 'Dash',
    ctlRotate: 'Rotate level',
    ctlPause: 'Pause',
    ctlLang: 'Switch language',
    ctlKeysMove: 'A / D  ·  ← / →',
    ctlKeysJump: 'Space  ·  W',
    ctlKeysAttack: 'J  ·  Z',
    ctlKeysDash: 'K  ·  X  ·  Shift',
    ctlKeysRotate: 'E',
    ctlKeysPause: 'Esc  ·  P',
    ctlKeysLang: 'L',
    ctlRotNote: 'Reliquary only',

    ember: 'Ember',
    hp: 'Health',
    dashReady: 'Ready',
    dashCharging: 'Recharging',
    phase: 'Phase',
    rotateHint: 'Rotate: E',
    rotateWorld: 'Press E to turn the world',
    saveNote: 'Autosaved',
    paused: 'Paused',
    resume: 'Resume',
    retry: 'Retry',
    toTitle: 'To title',
    youDied: 'You fell',
    hint: 'Hint',

    level1: 'Shrine of Ember',
    level2: 'Rotting Reliquary',
    level3: 'Lantern Wood',

    bossStatue: 'Marble Mummy',
    bossUlBurjo: 'Ul Burjo',
    bossPatient: 'The Patient One',
    bossReveal: 'The Elder',

    cs1Title: 'The Elder',
    cs1a: '"Aren\'t you tired, boy? I could grant your every wish."',
    cs1b: 'Kael did not lower his sword. Nobody does, on that slope.',
    cs1c: 'The old man smiled with a mouth that had too many teeth.',

    // ---- prologue (narration only, no speaker)
    pr1a: 'Deep in the forest, a village kept the Ember.',
    pr1b: 'Its light did not warm houses. It kept the whole forest alive.',
    pr2a: 'Every root, every leaf, every creature drank from it.',
    pr2b: 'Kael, the village warden, watched over it every night.',

    // ---- the elder's deal
    spkElder: 'Elder',
    spkKael: 'Kael',
    deal1a: 'Good evening, warden. Another long night?',
    deal1b: 'Who are you? No one walks this path.',
    deal2a: "Just an old merchant. And you, a boy tired of guarding a light that isn't his.",
    deal2b: 'Look. Gold, jewels... and there is so much more. Endless wealth.',
    deal3a: 'And what do you want in return?',
    deal3b: 'Almost nothing. Look the other way tonight. Just one night.',
    deal3c: '...One night.',

    // ---- the theft
    th1a: 'That night, the old man entered the shrine.',
    th1b: 'Thank you, warden. With this light, the Ancient One will wake.',
    th2a: 'The Ember went out. The forest began to die.',
    th2b: 'This was my fault. I will bring it back.',


    cs3Title: 'The Offering',
    cs3a: 'Ul Burjo opened a door that had no lock.',
    cs3b: '"I promised you infinite wealth. I only forgot the price."',
    cs3c: 'Behind him something woke, and the air turned orange.',

    cs4Title: 'The Waking',
    cs4a: 'The Patient One opens his hand. The lantern hits the ground.',
    cs4b: '"I have waited so long for the light that I no longer remember how to put it out."',
    cs4c: 'Kael put out his sword. In the dark, only his breathing remained.',

    cs5Title: 'The Return',
    cs5a: 'The Ember was small. It had travelled very far to fit in one hand.',
    cs5b: 'Kael lifted it and gave it back to the village that had lost it.',
    cs5c: 'The green came back to the leaves first. Then to the stone.',
    cs5d: 'No one ever learned the name the old man had worn.',
    cs5e: 'It did not matter. The light had come home.',

    endingTitle: 'END',
    endingSub: 'The light has returned',
    endingCredits: 'LUMENFALL',
    endingRestart: 'Play again',
    endingTitle2: 'Title screen',

    loading: 'Loading',
    skip: 'Skip',
    pressAny: 'Press any key',
    zoneShrine: 'Shrine',
    zoneReliquary: 'Reliquary',
    zoneWood: 'Wood',

    // ---- metrics panel
    menuMetrics: 'Metrics',
    metricsTitle: 'Run metrics',
    metricsLevel: 'Level',
    metricsStarts: 'Starts',
    metricsCompletes: 'Completes',
    metricsRate: '% complete',
    metricsDeaths: 'Deaths',
    metricsAvgTime: 'Avg time',
    metricsZones: 'Deadliest zones',
    metricsClose: 'Close',
    metricsEmpty: 'No data yet. Play a run to start recording metrics.',
  },
};

export const DEFAULT_LANG = 'es';
