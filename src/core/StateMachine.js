// Explicit game state machine for the scenario. Every session follows the
// same structured sequence; transitions outside the table are rejected, so
// the required sequence cannot be skipped by accident.
//
//   MENU -> CINEMATIC_INTRO -> EMERGENCY -> CONTROL_TRANSFER
//        -> RECOVERY -> DIVERSION -> APPROACH -> LANDING -> RESULT
//   (PAUSED can be entered from the cinematic and gameplay states; a
//   go-around returns APPROACH / LANDING to DIVERSION)

export const STATE = Object.freeze({
  MENU: 'MENU',
  CINEMATIC_INTRO: 'CINEMATIC_INTRO',
  EMERGENCY: 'EMERGENCY',
  CONTROL_TRANSFER: 'CONTROL_TRANSFER',
  RECOVERY: 'RECOVERY',
  DIVERSION: 'DIVERSION',
  APPROACH: 'APPROACH',
  LANDING: 'LANDING',
  RESULT: 'RESULT',
  PAUSED: 'PAUSED',
});

export const CINEMATIC_STATES = ['CINEMATIC_INTRO', 'EMERGENCY', 'CONTROL_TRANSFER'];
export const FLIGHT_STATES = ['RECOVERY', 'DIVERSION', 'APPROACH', 'LANDING'];

const RESTART = ['CINEMATIC_INTRO', 'MENU'];
const ALLOWED = {
  MENU: ['CINEMATIC_INTRO'],
  CINEMATIC_INTRO: ['EMERGENCY', 'PAUSED', ...RESTART],
  EMERGENCY: ['CONTROL_TRANSFER', 'PAUSED', ...RESTART],
  CONTROL_TRANSFER: ['RECOVERY', 'PAUSED', ...RESTART],
  RECOVERY: ['DIVERSION', 'LANDING', 'RESULT', 'PAUSED', ...RESTART],
  DIVERSION: ['APPROACH', 'LANDING', 'RESULT', 'PAUSED', ...RESTART],
  APPROACH: ['LANDING', 'DIVERSION', 'RESULT', 'PAUSED', ...RESTART], // DIVERSION = go-around
  LANDING: ['RESULT', 'DIVERSION', 'PAUSED', ...RESTART],
  RESULT: RESTART,
  PAUSED: [...CINEMATIC_STATES, ...FLIGHT_STATES, ...RESTART],
};

export class StateMachine {
  constructor(initial, onChange) {
    this.current = initial;
    this.previous = null;
    this.onChange = onChange;
  }

  is(...states) {
    return states.includes(this.current);
  }

  get inCinematic() {
    return CINEMATIC_STATES.includes(this.current);
  }

  get inFlight() {
    return FLIGHT_STATES.includes(this.current);
  }

  go(next, data) {
    if (next === this.current) return true;
    if (!ALLOWED[this.current]?.includes(next)) {
      console.warn(`[state] blocked ${this.current} -> ${next}`);
      return false;
    }
    const from = this.current;
    this.previous = from;
    this.current = next;
    this.onChange?.(from, next, data);
    return true;
  }
}
