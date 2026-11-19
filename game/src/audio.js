// Sound: a pocket WebAudio synth — no audio files, every noise made from oscillators
// at the moment it is needed. An engine hum that follows the car's speed, a two-tone
// police siren while the heat is on, and little one-shot bleeps for pickups, punches
// and mission payouts. The context is only created on the first user gesture (the
// Start button), which is what browser autoplay policies ask for; M mutes everything.
// Every call is wrapped so that a machine with no audio at all simply plays silent.

export function createAudio() {
  let ac = null;
  let master = null;
  let muted = false;
  let engine = null; // { osc, gain } — created lazily, gain ridden by update()
  let siren = null; // { osc, gain } — same treatment

  /** Create (or wake) the context. Call from a click handler, never on page load. */
  function unlock() {
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (err) {
      ac = null; // No audio on this machine: the game carries on without it.
    }
  }

  /** One short synthesized note. slide bends the pitch across the note's life. */
  function tone(freq, { type = 'sine', dur = 0.15, vol = 0.2, at = 0, slide = null } = {}) {
    if (!ac || muted) return;
    try {
      const t0 = ac.currentTime + at;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (err) { /* a failed bleep is not worth a crashed frame */ }
  }

  /** A crate changes hands: two bright notes, up a fifth. */
  function chime() {
    tone(880, { dur: 0.12, vol: 0.16 });
    tone(1318, { dur: 0.18, vol: 0.14, at: 0.07 });
  }

  /** A job is done and paid: a tidy three-note jingle. */
  function jingle() {
    tone(523.25, { dur: 0.22, vol: 0.17 });
    tone(659.25, { dur: 0.22, vol: 0.17, at: 0.11 });
    tone(783.99, { dur: 0.34, vol: 0.17, at: 0.22 });
  }

  /** The clock beat the player: two low notes, stepping down. */
  function fail() {
    tone(392, { dur: 0.2, vol: 0.14 });
    tone(311.1, { dur: 0.32, vol: 0.14, at: 0.14 });
  }

  /** A fist lands: a short low thump that bends downward. */
  function thud() {
    tone(95, { type: 'triangle', dur: 0.12, vol: 0.3, slide: 45 });
  }

  function makeEngine() {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    return { osc, gain };
  }

  function makeSiren() {
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 750;
    // A slow LFO swings the tone between the two wail pitches.
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.55;
    const swing = ac.createGain();
    swing.gain.value = 170;
    lfo.connect(swing);
    swing.connect(osc.frequency);
    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    lfo.start();
    return { osc, gain };
  }

  /**
   * Per-frame sound direction: the engine hums while the player drives (pitch and
   * volume follow speed), the siren wails while a police unit is on the street with
   * stars showing. Everything else is silence.
   */
  function update({ driving, speedRatio, pursued }) {
    if (!ac) return;
    try {
      if (!engine) engine = makeEngine();
      if (!siren) siren = makeSiren();
      const t = ac.currentTime;
      const engineLevel = driving && !muted ? 0.045 : 0;
      engine.gain.gain.setTargetAtTime(engineLevel, t, 0.12);
      engine.osc.frequency.setTargetAtTime(55 + speedRatio * 115, t, 0.1);
      const sirenLevel = pursued && !muted ? 0.026 : 0;
      siren.gain.gain.setTargetAtTime(sirenLevel, t, 0.25);
    } catch (err) { /* keep the frame alive even if the graph is unhappy */ }
  }

  /** Flip the master mute. Returns the new muted state. */
  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  return {
    unlock,
    chime,
    jingle,
    fail,
    thud,
    update,
    toggleMute,
    get muted() { return muted; },
  };
}
