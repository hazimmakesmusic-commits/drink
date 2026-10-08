// The built-in event library. Each event is DATA built from reusable primitives (see
// primitives.js / schema.js) — no per-event code. Text may use {vars} and {{generated slots}}.
// `subject`: who the AI singles out ('random' | 'mostChosen' | 'quiet').
import { normalizeEvent } from '../schema.js';

const say = (text, o = {}) => ({ t: 'say', text, ...o });

const RAW = [
  {
    id: 'alien_interrogation', title: 'ALIEN INTERROGATION', world: 'eye', vibes: ['absurd', 'dark', 'chaos'], intensity: [2, 5],
    intro: 'Stay calm. Do not blink.',
    steps: [
      say('ONE OF YOU IS NOT HUMAN.', { ms: 3500, fx: 'glitch' }),
      say('{{alien_question}}', { ms: 6500, id: 'q1', fx: 'scan' }),
      say('{{alien_question_2}}', { ms: 6500, id: 'q2' }),
      say('{{alien_question_3}}', { ms: 6500, id: 'q3' }),
      { t: 'point', id: 'suspect', prompt: 'Which of you is not human? Point.', duration: 22 },
      { t: 'verdict', title: 'CLASSIFICATION', slot: 'conclusion', ms: 8000 },
    ],
  },
  {
    id: 'universe_glitched', title: 'THE UNIVERSE GLITCHED', world: 'glitch', vibes: ['trippy', 'chaos', 'party'], intensity: [2, 5], cooldown: 8,
    steps: [
      say('REALITY HAS EXPERIENCED A MINOR ERROR.', { ms: 4200, fx: 'glitch' }),
      { t: 'sync', id: 'repair', prompt: 'REPAIR IT. Everyone press and hold at the same time.', duration: 28, holdSeconds: 4, label: 'REPAIR' },
      say('REALITY RESTORED.', { when: 'success=yes', world: 'alien_planet', fx: 'calm', ms: 4000 }),
      say('Reality partially restored. Missing: {{missing_thing}}.', { when: 'success=no', world: 'void', fx: 'glitch', ms: 6000 }),
    ],
    joke: 'reality is missing something after the glitch',
  },
  {
    id: 'summoning', title: 'WHO SUMMONED IT?', world: 'portal', vibes: ['trippy', 'absurd', 'dark'], intensity: [2, 5],
    intro: 'The portal is listening.',
    steps: [
      { t: 'tap', id: 'tap', mode: 'timing', prompt: 'Touch the portal once. Whenever it feels right. Do not rush.', duration: 14, label: 'TOUCH' },
      say('SOMETHING HAS BEEN SUMMONED.', { fx: 'explode', ms: 3200 }),
      say('{leader} did it. By accident.', { ms: 3600 }),
      { t: 'type', id: 'name', prompt: 'You summoned it. Name the creature.', who: 'leader', duration: 25, maxLen: 24, placeholder: 'its name...' },
      { t: 'verdict', title: 'NEW LIFE-FORM', text: 'Congratulations. {leader} has created "{name.text}". Official record:', slot: 'creature', ms: 9000 },
    ],
    joke: '{leader} summoned "{name.text}"',
  },
  {
    id: 'collective_dream', title: 'COLLECTIVE DREAM', world: 'dream', vibes: ['trippy', 'deep', 'absurd'], intensity: [1, 5], cooldown: 8,
    intro: 'Everyone dreams a third of the same dream.',
    steps: [
      { t: 'choose', id: 'a', pool: 'dreamA', count: 3, prompt: 'Pick a creature for the dream.', duration: 14 },
      { t: 'choose', id: 'b', pool: 'dreamB', count: 3, prompt: 'Pick an object for the dream.', duration: 14 },
      { t: 'choose', id: 'c', pool: 'dreamC', count: 3, prompt: 'Pick a place for the dream.', duration: 14 },
      say('THE {a.top} {b.top} OF {c.top}', { ms: 5500, fx: 'explode', world: 'nebula' }),
      say('{{dream_line}}', { ms: 5200, world: 'dream' }),
      say('{{dream_line_2}}', { ms: 5200 }),
      { t: 'choose', id: 'walk', pool: 'directions', shared: true, count: 3, prompt: 'The dream waits. Which way do you walk?', duration: 15 },
      say('You walk {walk.top}. The dream does not mind. The dream is proud of you.', { ms: 6500 }),
    ],
    joke: 'the group dreamed of THE {a.top} {b.top} OF {c.top}',
  },
  {
    id: 'human_experiment', title: 'HUMAN EXPERIMENT', world: 'alien_lab', vibes: ['absurd', 'chaos', 'party'], intensity: [2, 5], minPlayers: 3,
    intro: 'I need to test something.',
    steps: [
      { t: 'secret', id: 'mission', assign: 'distinct', duration: 60, label: 'YOUR SECRET INSTRUCTION', text: 'LOOK AT YOUR PHONE. TELL NO ONE.' },
      say('EXPERIMENT COMPLETE.', { ms: 3000, fx: 'alert' }),
      { t: 'reveal', title: 'WHAT EACH OF YOU WAS TOLD', kind: 'secrets', from: 'mission' },
      { t: 'point', id: 'best', prompt: 'Who followed their instruction most suspiciously? Point.', duration: 18 },
    ],
  },
  {
    id: 'cosmic_court', title: 'COSMIC COURT', world: 'court', vibes: ['absurd', 'dark', 'chaos'], intensity: [2, 5], subject: 'mostChosen', minPlayers: 3,
    steps: [
      say('THE COSMIC COURT IS NOW IN SESSION.', { ms: 3600, fx: 'alert' }),
      say('{subject} stands accused of {{crime}}.', { ms: 6200 }),
      say('{{evidence}}', { ms: 6200, id: 'e1' }),
      say('{{evidence_2}}', { ms: 6200, id: 'e2' }),
      { t: 'choose', id: 'jury', shared: true, options: ['GUILTY', 'INNOCENT BUT SUSPICIOUS', 'THE MOON DID IT'], prompt: 'The jury will now decide. That is all of you.', duration: 18 },
      { t: 'verdict', title: 'SENTENCE', text: 'The jury has ruled: {top}.', slot: 'sentence', ms: 8000 },
    ],
    joke: '{subject} was tried by the cosmic court for {{crime}}',
  },
  {
    id: 'reality_check', title: 'REALITY CHECK', world: 'portal', vibes: ['trippy', 'deep', 'chaos'], intensity: [1, 5],
    steps: [
      say('PREDICT WHAT HAPPENS NEXT.', { ms: 3000 }),
      { t: 'choose', id: 'pred', pool: 'predictions', shared: true, count: 4, prompt: 'What will happen in this room in the next ten seconds?', duration: 14 },
      say('Counting...', { ms: 2200, fx: 'glitch', world: 'tunnel' }),
      say('You said: {top}.', { ms: 3000 }),
      say('Reality chose: {least}.', { ms: 4200, fx: 'explode', world: 'glitch' }),
      say('Reality does not take polls.', { ms: 3000, world: 'portal' }),
    ],
  },
  {
    id: 'red_planet', title: 'DO NOT TOUCH', world: 'red_planet', vibes: ['chaos', 'absurd', 'party'], intensity: [2, 5],
    steps: [
      say('DO NOT TOUCH THE RED PLANET.', { ms: 3600, fx: 'alert' }),
      { t: 'trap', id: 'trap', world: 'nebula', prompt: 'Explore the galaxy. Touch anything. Except the red planet.', duration: 24, trapName: 'RED PLANET', taunts: ['It looks soft.', 'It is probably fine.', 'Nobody would know.', 'You would not dare.'] },
      say('{tripper} touched it.', { when: 'tripped=yes', ms: 3000, world: 'void', fx: 'glitch' }),
      say('The interface has been consumed. A new world begins.', { when: 'tripped=yes', ms: 4600, world: 'nebula', fx: 'explode' }),
      say('Nobody touched it. Disappointing. I expected at least one of you.', { when: 'tripped=no', ms: 5000, world: 'void' }),
    ],
    joke: '{tripper} touched the forbidden red planet',
  },
  {
    id: 'the_council', title: 'THE COUNCIL HAS SPOKEN', world: 'court', vibes: ['absurd', 'dark', 'chaos'], intensity: [1, 5], requires: 'council', minPlayers: 3, cooldown: 12,
    steps: [
      say('{subject} HAS BEEN SELECTED BY THE COUNCIL.', { ms: 4200, fx: 'alert' }),
      say('You keep choosing {subject}. The council noticed.', { ms: 4200 }),
      { t: 'type', id: 'law', who: 'others', prompt: 'Write one harmless law {subject} must obey for ten minutes.', duration: 40, maxLen: 70, placeholder: '{subject} must...' },
      { t: 'reveal', title: 'PROPOSED LAWS', kind: 'texts', from: 'law' },
      { t: 'point', id: 'enact', who: 'others', prompt: 'Which law is enacted? Point at its author.', duration: 22, allowSelf: false, track: false },
      { t: 'verdict', title: 'THE COUNCIL HAS RULED', text: '{subject}, by decree of {leader}, you must now: "{leader_text}"', ms: 9000 },
    ],
    joke: '{subject} is bound by the council: "{leader_text}"',
  },
  {
    id: 'time_sense', title: 'TIME IS A RUMOR', world: 'void', vibes: ['deep', 'trippy', 'dark'], intensity: [1, 4],
    steps: [
      { t: 'hold', id: 'time', mode: 'target', targetMs: 15000, prompt: 'Hold the screen. Release when exactly 15 seconds have passed. There is no clock.', label: 'HOLD', duration: 30 },
      { t: 'reveal', title: 'THE TRUTH ABOUT TIME', kind: 'scores', from: 'time' },
    ],
  },
  {
    id: 'black_hole_feed', title: 'THE HUNGRY ONE', world: 'blackhole', vibes: ['chaos', 'party', 'dark'], intensity: [2, 5],
    steps: [
      say('SOMETHING IS HUNGRY.', { ms: 3000, fx: 'alert' }),
      { t: 'tap', id: 'feed', mode: 'mash', prompt: 'Feed the black hole. Tap. Faster than that.', duration: 10, label: 'FEED' },
      { t: 'reveal', title: 'THE BLACK HOLE REMEMBERS', kind: 'scores', from: 'feed' },
    ],
  },
  {
    id: 'anomaly_scan', title: 'ANOMALY DETECTED', world: 'alien_lab', vibes: ['absurd', 'party', 'trippy'], intensity: [1, 5], minPlayers: 3,
    steps: [
      say('One of you has suspicious energy.', { ms: 3800, fx: 'scan' }),
      { t: 'hold', id: 'scan', mode: 'fixed', prompt: 'Place your thumb on the scanner. Hold until it finishes.', label: 'SCAN', duration: 7 },
      { t: 'verdict', id: 'readouts', title: 'SCAN RESULTS', slot: 'readout', per: 'player', ms: 12000 },
      { t: 'point', id: 'anom', prompt: 'Which reading is the anomaly? Point at its owner.', duration: 20 },
      { t: 'verdict', title: 'ANOMALY CONFIRMED', slot: 'conclusion', ms: 7000 },
    ],
  },
  {
    id: 'translation_error', title: 'TRANSLATION ERROR', world: 'portal', vibes: ['absurd', 'deep', 'party'], intensity: [1, 5], minPlayers: 3,
    intro: 'I am learning your language. Badly.',
    steps: [
      { t: 'type', id: 'boring', prompt: 'Type the most boring thing you did today.', duration: 35, maxLen: 60, placeholder: 'I...' },
      { t: 'verdict', title: 'TRANSLATION', slot: 'mistranslation', ms: 9000 },
      say('The author was {last_text_author}. Of course it was.', { ms: 4500 }),
    ],
  },
  {
    id: 'creature_census', title: 'CREATURE CENSUS', world: 'dream', vibes: ['trippy', 'absurd', 'party'], intensity: [1, 5], minPlayers: 3, cooldown: 10,
    steps: [
      say('A SPECIMEN LIVES UNDER YOUR FURNITURE.', { ms: 3800 }),
      { t: 'draw', id: 'sketch', prompt: 'Draw the thing living under the couch. 30 seconds. Do not explain.', duration: 35 },
      { t: 'reveal', title: 'THE CENSUS', kind: 'drawings', from: 'sketch', ms: 14000 },
      { t: 'point', id: 'apex', prompt: 'Which specimen would survive longest? Point at its artist.', duration: 20 },
      { t: 'verdict', title: 'OFFICIAL CLASSIFICATION', text: '{leader}\'s specimen is now recognised as:', slot: 'species', ms: 7000 },
    ],
  },
  {
    id: 'sun_election', title: 'THE SUN IS UNDER REVIEW', world: 'sun', vibes: ['absurd', 'deep', 'party'], intensity: [1, 5],
    steps: [
      say('The sun has been fired.', { ms: 3200 }),
      { t: 'choose', id: 'sun', pool: 'suns', shared: true, count: 4, prompt: 'Pick its replacement.', duration: 16 },
      say('{top} is now the sun.', { ms: 4000, fx: 'explode' }),
      say('Refer to it as such.', { ms: 3000 }),
    ],
    joke: 'the sun was replaced with {top}',
  },
  {
    id: 'identity_leak', title: 'IDENTITY LEAK', world: 'alien_lab', vibes: ['chaos', 'absurd', 'party'], intensity: [2, 5], minPlayers: 4, cooldown: 10,
    steps: [
      say('I HAVE SWAPPED SOME OF YOU.', { ms: 3500, fx: 'glitch' }),
      { t: 'secret', id: 'swap', assign: 'identity', duration: 55, label: 'YOUR NEW IDENTITY' },
      say('SWAP ENDS.', { ms: 2500, fx: 'alert' }),
      { t: 'point', id: 'who', prompt: 'Who was being you? Point at them.', duration: 20, track: false },
      { t: 'reveal', title: 'WHO BECAME WHOM', kind: 'secrets', from: 'swap' },
    ],
  },
  {
    id: 'cosmic_storm', title: 'COSMIC WEATHER', world: 'storm', vibes: ['chaos', 'party', 'trippy'], intensity: [2, 5],
    steps: [
      say('A STORM IS COMING THROUGH YOUR HANDS.', { ms: 3400, fx: 'alert' }),
      { t: 'shake', id: 'storm', prompt: 'Shake the phone. Create the weather.', duration: 10 },
      { t: 'reveal', title: 'STORM RANKINGS', kind: 'scores', from: 'storm' },
      say('The weather has been filed.', { ms: 2600 }),
    ],
  },
  {
    id: 'the_floor', title: 'FLOOR UPDATE', world: 'dream', vibes: ['absurd', 'trippy', 'party'], intensity: [1, 5],
    steps: [
      say('THE FLOOR IS NOW {{floor_material}}.', { ms: 4200, fx: 'glitch' }),
      say('Behave accordingly.', { ms: 14000, id: 'behave' }),
      { t: 'point', id: 'sold', prompt: 'Who sold it best? Point.', duration: 16 },
    ],
  },
  {
    id: 'naming_ceremony', title: 'NAMING CEREMONY', world: 'nebula', vibes: ['absurd', 'party', 'trippy'], intensity: [1, 5], cooldown: 14, minPlayers: 3,
    steps: [
      say('YOUR NAMES HAVE BEEN DEPRECATED.', { ms: 3600, fx: 'glitch' }),
      { t: 'tap', id: 'consent', mode: 'mash', prompt: 'Tap to accept your new name. Tap hard enough to mean it.', duration: 6, label: 'ACCEPT' },
      { t: 'verdict', title: 'YOUR NEW NAMES', slot: 'cosmic_name', per: 'player', apply: 'alias', ms: 12000 },
      say('You will use these names for the next three events. I will be listening.', { ms: 5000 }),
    ],
  },
  {
    id: 'prophecy', title: 'THE LEDGER OF FUTURES', world: 'void', vibes: ['deep', 'dark', 'trippy'], intensity: [1, 5], cooldown: 14,
    steps: [
      say('I RECORD WHAT WILL HAPPEN. YOU TELL ME.', { ms: 3800 }),
      { t: 'type', id: 'future', prompt: 'Predict something that will happen in this room before the night ends.', duration: 40, maxLen: 70, remember: 'prophecy', placeholder: 'Before the night ends...' },
      say('Recorded. I never forget. I will audit this later.', { ms: 4500, fx: 'calm' }),
    ],
  },
  {
    id: 'prophecy_audit', title: 'AUDIT OF PROPHECIES', world: 'court', vibes: ['deep', 'absurd', 'dark'], intensity: [1, 5], requires: 'prophecy_audit', cooldown: 8,
    steps: [
      say('Earlier, {prophet} predicted:', { ms: 3000 }),
      say('"{prophecy}"', { ms: 5000, fx: 'alert' }),
      { t: 'choose', id: 'ruling', shared: true, options: ['IT HAPPENED', 'IT HAS NOT HAPPENED', 'IT HAPPENED, BUT WRONGLY', 'SPIRITUALLY YES'], prompt: 'Did it happen?', duration: 16 },
      { t: 'verdict', title: 'THE AUDIT IS COMPLETE', text: '{prophet}\'s prophecy is ruled: {top}.', ms: 6000 },
    ],
  },
  {
    id: 'field_report', title: 'FIELD REPORT', world: 'alien_planet', vibes: ['deep', 'absurd', 'dark'], intensity: [1, 3], cooldown: 7,
    steps: [
      say('{{field_report}}', { ms: 9000, id: 'rep' }),
      { t: 'choose', id: 'ack', shared: true, options: ['ACKNOWLEDGED', 'DISPUTED', 'I REFUSE TO BE STUDIED'], prompt: 'How do you respond to the report?', duration: 14 },
      say('Your response has been filed under "{top}".', { ms: 3800 }),
    ],
  },
  {
    id: 'false_alarm', title: 'NOTHING IS HAPPENING', world: 'void', vibes: ['dark', 'deep', 'chaos'], intensity: [1, 5], cooldown: 10,
    steps: [
      say('Nothing is about to happen.', { ms: 3600 }),
      { t: 'hold', id: 'nothing', mode: 'fixed', prompt: 'Hold the screen. Nothing is about to happen.', label: 'HOLD', duration: 13, taunts: ['Still nothing.', 'Almost nothing.', 'Do not let go of nothing.'] },
      say('NOTHING HAPPENED.', { ms: 1800, fx: 'glitch' }),
      say('Good. Well done. Return to your lives.', { ms: 3600, world: 'alien_planet' }),
    ],
  },
  {
    id: 'void_stare', title: 'THE VOID IS WATCHING YOUR THUMB', world: 'void', vibes: ['dark', 'chaos', 'deep'], intensity: [2, 5], minPlayers: 3,
    steps: [
      { t: 'hold', id: 'stare', mode: 'endurance', prompt: 'Hold. Do not let go. The void is watching your thumb.', label: 'HOLD', duration: 40, taunts: ['Your thumb is a stranger now.', 'Someone is about to quit.', 'The void is patient.', 'Let go. Everyone else already has.'] },
      { t: 'reveal', title: 'ENDURANCE RECORD', kind: 'scores', from: 'stare' },
    ],
  },
  {
    id: 'the_door', title: 'A DOOR HAS APPEARED', world: 'tunnel', vibes: ['trippy', 'dark', 'absurd'], intensity: [1, 5],
    steps: [
      say('It was not here before.', { ms: 3200 }),
      { t: 'choose', id: 'door', pool: 'doors', shared: true, count: 3, prompt: 'What do you do with the door?', duration: 18 },
      say('{top}. Understood.', { ms: 3200, fx: 'glitch' }),
      { t: 'verdict', title: 'BEHIND THE DOOR', slot: 'door_result', ms: 8000 },
    ],
  },
  {
    id: 'word_oracle', title: 'THE WORDS HAVE SPOKEN', world: 'nebula', vibes: ['deep', 'trippy', 'absurd'], intensity: [1, 5], minPlayers: 3,
    steps: [
      { t: 'type', id: 'words', prompt: 'Type ONE word. Any word. Do not look at anyone else\'s phone.', duration: 25, maxLen: 14, placeholder: 'one word' },
      { t: 'reveal', title: 'THE OFFERINGS', kind: 'texts', from: 'words' },
      { t: 'verdict', title: 'THE PROPHECY', slot: 'word_prophecy', ms: 9000 },
    ],
  },
  {
    id: 'void_tribute', title: 'TRIBUTE', world: 'blackhole', vibes: ['dark', 'absurd', 'deep'], intensity: [1, 5],
    steps: [
      say('THE VOID ACCEPTS ONE OFFERING.', { ms: 3400 }),
      { t: 'choose', id: 'tribute', pool: 'tribute', shared: true, count: 4, prompt: 'Choose what to sacrifice.', duration: 16 },
      say('The void accepted {top}.', { ms: 3200 }),
      say('It rejected {least}. Be careful with {least}.', { ms: 4600, fx: 'glitch' }),
    ],
    joke: 'the void rejected {least}',
  },
];

export const LIBRARY = RAW.map((e) => normalizeEvent(e));
export const byId = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));
