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

    cs2Title: 'El Robo',
    cs2a: 'El Anciano no pidió permiso. Tomó la Brasa del pueblo',
    cs2b: 'y la cargó hacia el norte, donde algo muy antiguo respiraba.',
    cs2c: 'Kael siguió el hueco que dejaba la luz al apagarse.',

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

    cs2Title: 'The Theft',
    cs2a: 'The Elder did not ask. He took the village Ember',
    cs2b: 'and carried it north, where something very old was breathing.',
    cs2c: 'Kael followed the hole the light left as it went out.',

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
  },
};

export const DEFAULT_LANG = 'es';
