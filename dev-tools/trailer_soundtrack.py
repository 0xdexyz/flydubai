"""Synthesizes the trailer soundtrack (48 kHz stereo WAV), timed from the
trailer/timeline.json written by src/dev/Trailer.js. numpy only.

    python dev-tools/trailer_soundtrack.py

Layers: opening pad, incident-card pulse and pings, the cutscene (engine hum,
the cut-to-black hit, dive wind + caution chime, cabin murmur, door thud,
tension riser, TAKE CONTROL hit), a driving gameplay ostinato, touchdown
thump + tyre chirp, and a resolving end chord.
"""
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent / 'trailer'
SR = 48000
rng = np.random.default_rng(1073)

tl = json.loads((ROOT / 'timeline.json').read_text())
EV = {e['name']: e['t'] for e in tl['events']}
FRAMES = len(list((ROOT / 'frames').glob('f_*.jpg')))
DUR = FRAMES / tl['fps']
N = int(DUR * SR)
T = np.arange(N) / SR
mix = np.zeros((2, N))

# Cutscene beats (seconds inside the in-game cinematic, see src/game/Cinematic.js)
C0 = EV['cutscene']
cine = lambda s: C0 + s  # noqa: E731
G0 = EV['gameplay']
SHOTS = [G0, G0 + 4.5, G0 + 9.0, G0 + 14.0]  # recover, divert, line up, land
TD = EV.get('touchdown')


def note(n):
    """MIDI note -> Hz."""
    return 440.0 * 2 ** ((n - 69) / 12)


def env(points, t=T):
    xs, ys = zip(*points)
    return np.interp(t, xs, ys, left=ys[0], right=ys[-1])


def band_noise(lo, hi, n=N, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    x = r.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    edge = lambda a, w: np.clip((f - a) / w + 0.5, 0, 1)  # noqa: E731
    mask = edge(lo, max(20, lo * 0.5)) * (1 - edge(hi, hi * 0.5))
    y = np.fft.irfft(X * mask, n)
    return y / (np.sqrt(np.mean(y**2)) + 1e-9)


def tone(freq, t=T, harmonics=6, tilt=1.4, phase=0.0, detune=0.0):
    out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        out += np.sin(2 * np.pi * k * freq * (1 + detune) * t + phase * k) / k**tilt
    return out


def add(sig, pan=0.0, at=0.0, gain=1.0):
    """Add a mono signal (full length when at=0, else a short buffer placed at `at` seconds)."""
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    s = int(at * SR)
    if s >= N:
        return
    seg = sig[: N - s] * gain
    mix[0, s : s + len(seg)] += seg * l
    mix[1, s : s + len(seg)] += seg * r


def add_stereo(left, right, gain=1.0):
    mix[0] += left * gain
    mix[1] += right * gain


def hit(depth=1.0, length=2.2, f0=95, f1=32):
    """Cinematic low boom: falling sine + soft noise transient."""
    t = np.arange(int(length * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.18)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / (length * 0.32))
    click = band_noise(80, 2500, len(t), seed=7) * np.exp(-t / 0.035) * 0.35
    return (body + click) * depth


def kick(length=0.45):
    t = np.arange(int(length * SR)) / SR
    f = 46 + 110 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)


def pluck(freq, length=0.32, bright=5):
    t = np.arange(int(length * SR)) / SR
    return tone(freq, t, harmonics=bright, tilt=1.2) * np.exp(-t / 0.09) * np.minimum(1, t / 0.004)


def chime(freq, length=0.5):
    t = np.arange(int(length * SR)) / SR
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2.01 * t)) * np.exp(-t / 0.14) * np.minimum(1, t / 0.003)


def whoosh(length=1.1, lo=400, hi=5000):
    n = int(length * SR)
    t = np.arange(n) / SR
    y = band_noise(lo, hi, n, seed=int(length * 1000))
    shape = np.sin(np.pi * np.clip(t / length, 0, 1)) ** 2
    return y * shape


def pad(chord, t0, t1, amp, attack=1.5, release=1.5, detune=0.004, harmonics=5):
    e = env([(t0, 0), (t0 + attack, amp), (t1 - release, amp), (t1, 0)])
    lfo = 1 + 0.08 * np.sin(2 * np.pi * 0.23 * T)
    L = np.zeros(N)
    R = np.zeros(N)
    for i, n in enumerate(chord):
        f = note(n)
        L += tone(f, harmonics=harmonics, phase=i * 0.7, detune=-detune)
        R += tone(f, harmonics=harmonics, phase=i * 1.3, detune=detune)
    k = e * lfo / len(chord)
    add_stereo(L * k, R * k)


# --- score -------------------------------------------------------------------------------------
A_MIN = [45, 52, 57, 60, 64]  # A1 E2 A2 C3 E3
F_MAJ = [41, 53, 57, 60, 65]
C_MAJ = [48, 55, 60, 64, 67]
D_MIN = [50, 57, 62, 65, 69]

# Opener + incident card: wide minor pad, then a ticking pulse while the route draws.
I0 = EV['incident']
pad(A_MIN, 0.0, I0 + 1.5, 0.26, attack=2.5, release=2.0)
pad(F_MAJ, I0 + 0.5, C0 + 0.6, 0.21, attack=1.5, release=1.2)
add(whoosh(1.2), at=I0 - 0.6, gain=0.18)
for i, t in enumerate(np.arange(I0 + 2.4, C0 - 0.3, 0.5)):
    add(pluck(note(69 if i % 4 else 76), 0.18, 3), at=t, gain=0.11, pan=0.3 if i % 2 else -0.3)
add(chime(note(81)), at=I0 + 4.3, gain=0.22)  # emergency marker
add(chime(note(84)), at=I0 + 4.5, gain=0.16)
add(chime(note(76)), at=I0 + 5.3, gain=0.2)  # Tabuk lights up
add(chime(note(81)), at=I0 + 5.45, gain=0.14)

# Cutscene: engine hum throughout, calm pad during cruise.
END_CINE = EV['turn']
hum = band_noise(40, 260, seed=11) * 0.6 + np.sin(2 * np.pi * 92 * T) * 0.25 + np.sin(2 * np.pi * 184.5 * T) * 0.1
hum_env = env([(C0, 0), (C0 + 1.0, 0.11), (cine(8.65), 0.11), (cine(8.72), 0.0), (cine(9.1), 0.0), (cine(9.6), 0.12),
               (cine(20.6), 0.13), (cine(21.0), 0.07), (cine(45.0), 0.08), (END_CINE, 0.1), (G0, 0.08), (DUR - 6.5, 0.08), (DUR - 5, 0)])
add(hum * hum_env)
pad([57, 64, 69, 72], C0, cine(8.7), 0.17, attack=1.2, release=0.05)

# 05:21 — the attack happens off screen during the cut to black: one deep hit, a ringing tone.
add(hit(1.0, 3.0), at=cine(8.72), gain=0.6)
t = np.arange(int(3.5 * SR)) / SR
add(np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 1.1) * np.minimum(1, t / 0.02), at=cine(8.75), gain=0.025)

# The dive: wind, low rumble, caution chime, rising string cluster.
wl = band_noise(250, 3200, seed=21)
wr = band_noise(250, 3200, seed=22)
wind_env = env([(cine(9.1), 0), (cine(11.6), 0.06), (cine(13), 0.09), (cine(17.5), 0.11), (cine(20.4), 0.08), (cine(21.0), 0.03), (cine(28), 0.02), (cine(30), 0)])
add_stereo(wl * wind_env, wr * wind_env)
rumble = band_noise(25, 120, seed=23)
add(rumble * env([(cine(9.1), 0), (cine(11.8), 0.15), (cine(20.4), 0.13), (cine(21.2), 0.05), (cine(29), 0.05), (cine(30), 0)]))
for t0 in np.arange(cine(12.4), cine(20.4), 1.1):  # master caution, two tones
    add(chime(note(83), 0.3), at=t0, gain=0.07, pan=-0.2)
    add(chime(note(79), 0.3), at=t0 + 0.28, gain=0.07, pan=0.2)
pad([45, 46, 52, 57, 58], cine(9.4), cine(20.8), 0.1, attack=3.0, release=0.6, detune=0.01)

# Cabin: murmur and a heartbeat pulse that speeds up toward the door.
ml = band_noise(250, 1600, seed=31)
mr = band_noise(250, 1600, seed=32)
syll = 0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 2.3 * T + 2 * np.sin(2 * np.pi * 0.37 * T)))
m_env = env([(cine(20.4), 0), (cine(21.2), 0.06), (cine(28), 0.07), (cine(33.4), 0.1), (cine(42), 0.08), (cine(45.2), 0.02), (cine(46), 0)])
add_stereo(ml * syll * m_env, mr * syll[::-1] * m_env)
pad([45, 52, 57, 60], cine(20.6), cine(45.4), 0.11, attack=2.0, release=0.4)
beat = cine(21.0)
while beat < cine(45.2):
    progress = (beat - cine(21.0)) / 24.0
    gap = 0.95 - 0.5 * progress  # quickens
    add(kick(), at=beat, gain=0.3 + 0.25 * progress)
    add(kick(), at=beat + 0.22, gain=0.16 + 0.12 * progress)
    beat += gap
add(hit(0.6, 1.6, 80, 40), at=cine(29.5), gain=0.5)  # door opens
add(whoosh(1.6, 300, 3000), at=cine(32.6), gain=0.14)
add(hit(0.5, 1.4, 70, 38), at=cine(42.9), gain=0.35)  # door shuts
riser_t0, riser_t1 = cine(40.5), cine(45.4)
rs = band_noise(800, 7000, seed=41)
add(rs * env([(riser_t0, 0), (riser_t1 - 0.05, 0.12), (riser_t1, 0)]))
seg_t = T[(T >= riser_t0) & (T < riser_t1)] - riser_t0
f_r = note(57) * 2 ** (seg_t / (riser_t1 - riser_t0) * 1.0)
riser_tone = np.sin(2 * np.pi * np.cumsum(f_r) / SR) * (seg_t / (riser_t1 - riser_t0)) ** 2
add(riser_tone, at=riser_t0, gain=0.1)

# TAKE CONTROL
TC = cine(45.4)
add(hit(1.0, 3.2, 110, 30), at=TC, gain=0.85)
pad([45, 57, 64, 69, 72, 76], TC, END_CINE + 1.0, 0.16, attack=0.02, release=1.0, harmonics=7)

# "Now you're the off-duty pilot" card: low drone and two heartbeats.
pad([45, 52, 57], END_CINE, G0 + 0.8, 0.12, attack=0.3, release=0.6)
add(kick(), at=END_CINE + 0.5, gain=0.4)
add(kick(), at=END_CINE + 0.72, gain=0.22)
add(kick(), at=END_CINE + 1.6, gain=0.4)
add(kick(), at=END_CINE + 1.82, gain=0.22)

# Gameplay: driving ostinato in A minor, chord changes per shot.
BPM = 112
step = 60 / BPM / 4
end_play = (TD + 1.0) if TD else EV['end'] - 1.0
seq = [45, 45, 57, 45, 52, 45, 55, 45, 45, 45, 57, 45, 60, 45, 59, 55]
prog = [A_MIN, F_MAJ, D_MIN, F_MAJ]
i = 0
t0 = G0
while t0 < end_play:
    add(pluck(note(seq[i % 16]), 0.22, 6), at=t0, gain=0.11, pan=-0.15)
    if i % 4 == 0:
        add(kick(), at=t0, gain=0.42)
    if i % 8 == 4:
        add(band_noise(1500, 9000, int(0.12 * SR), seed=i) * np.exp(-np.arange(int(0.12 * SR)) / SR / 0.035), at=t0, gain=0.06)
    i += 1
    t0 += step
for k, s in enumerate(SHOTS):
    e = SHOTS[k + 1] if k + 1 < len(SHOTS) else end_play
    pad(prog[k], s, e + 0.4, 0.085, attack=0.3, release=0.5)
    add(whoosh(0.7, 600, 7000), at=s - 0.35, gain=0.1)

# Touchdown: thump, tyre chirps, then the resolve.
if TD:
    add(hit(0.7, 1.2, 70, 38), at=TD, gain=0.55)
    for dt, g in ((0.0, 0.16), (0.09, 0.1)):
        n = int(0.22 * SR)
        add(band_noise(1800, 6000, n, seed=int(dt * 100) + 5) * np.exp(-np.arange(n) / SR / 0.06), at=TD + dt, gain=g)
    rumble2 = band_noise(30, 400, seed=51)
    add(rumble2 * env([(TD, 0), (TD + 0.1, 0.12), (EV['end'], 0.04), (EV['end'] + 1, 0)]))
    pad(C_MAJ, TD + 0.3, EV['end'] + 0.6, 0.18, attack=0.8, release=0.6)

# End card: wide major resolve with a soft high shimmer.
E0 = EV['end']
pad([48, 55, 60, 64, 67, 72], E0, DUR, 0.26, attack=0.6, release=1.6, harmonics=6)
add(hit(0.6, 3.0, 90, 30), at=E0 + 0.1, gain=0.45)
for k, n in enumerate([72, 76, 79, 84]):
    add(chime(note(n), 1.6), at=E0 + 0.6 + k * 0.18, gain=0.06, pan=-0.4 + k * 0.27)

# --- master: small room reverb, soft clip, normalize, fades -----------------------------------
ir_n = int(1.6 * SR)
ir_t = np.arange(ir_n) / SR
for ch in range(2):
    ir = np.random.default_rng(90 + ch).standard_normal(ir_n) * np.exp(-ir_t / 0.45)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt(np.sum(ir**2))
    L = 1 << int(np.ceil(np.log2(N + ir_n)))
    wet = np.fft.irfft(np.fft.rfft(mix[ch], L) * np.fft.rfft(ir, L), L)[:N]
    mix[ch] = mix[ch] + wet * 0.22

mix = np.tanh(mix * 1.6) / 1.6
mix *= 0.89 / np.max(np.abs(mix))
fade = np.minimum(1, np.minimum(T / 0.3, (DUR - T) / 1.0))
mix *= np.clip(fade, 0, 1)

pcm = (mix.T * 32767).astype('<i2')
with wave.open(str(ROOT / 'soundtrack.wav'), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'soundtrack.wav  {DUR:.2f}s  frames={FRAMES}  events={EV}')
