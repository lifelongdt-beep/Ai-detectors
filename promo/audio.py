#!/usr/bin/env python3
"""홍보영상용 비트 합성 (numpy/scipy만 사용). 96 BPM x 8마디 = 정확히 20.0초.
사용법: python3 promo/audio.py  -> promo/out/track.wav
마디 구성(영상 장면과 동기): 1 훅 / 2 레이더(빌드) / 3-4 드롭(시뮬레이터) / 5 브레이크 / 6 드롭 / 7 더블타임 / 8 아웃트로
"""
import numpy as np
from scipy.signal import butter, lfilter
import wave, os

SR = 44100
BPM = 96
BEAT = 60 / BPM            # 0.625 s
STEP = BEAT / 4            # 16분음표 0.15625 s
BAR = BEAT * 4             # 2.5 s
DUR = BAR * 8              # 20.0 s
N = int(SR * DUR)
rng = np.random.default_rng(7)

L = np.zeros(N); R = np.zeros(N)  # 마스터 버스
drums = np.zeros(N)               # 킥/808 사이드체인용 포락선 계산에 쓰는 별도 버스
duck_src = np.zeros(N)

def add(buf, x, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N: return
    x = x[: N - i] * gain
    if buf is None:
        L[i:i+len(x)] += x * (1 - max(0, pan)); R[i:i+len(x)] += x * (1 + min(0, pan))
    else:
        buf[i:i+len(x)] += x

def lp(x, f, order=2): b, a = butter(order, f / (SR/2), 'low'); return lfilter(b, a, x)
def hp(x, f, order=2): b, a = butter(order, f / (SR/2), 'high'); return lfilter(b, a, x)
def bp(x, f1, f2, order=2): b, a = butter(order, [f1/(SR/2), f2/(SR/2)], 'band'); return lfilter(b, a, x)
def tt(d): return np.arange(int(SR * d)) / SR
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

# ---------- 악기 ----------
def kick(d=0.45):
    t = tt(d); f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 7.5) + 0.35 * np.sin(2 * ph) * np.exp(-t * 22)
    click = rng.standard_normal(len(t)) * np.exp(-t * 300) * 0.25
    return np.tanh(1.6 * (x + click))

def snare(d=0.35):
    t = tt(d)
    n = hp(rng.standard_normal(len(t)), 1800) * np.exp(-t * 16)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.6
    return np.tanh(1.4 * (n * 0.9 + tone))

def clap(d=0.3):
    t = tt(d); x = bp(rng.standard_normal(len(t)), 900, 3800)
    env = np.exp(-t * 20)
    for k, off in enumerate([0, 0.011, 0.022]):  # 레이어드 클랩
        i = int(off * SR); seg = np.exp(-np.arange(len(t) - i) / SR * 60) * 0.8; env[i:] += seg
    return np.tanh(x * env * 1.5)

def hat(d=0.06, open_=False):
    d = 0.28 if open_ else d; t = tt(d)
    x = hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * (12 if open_ else 90))
    return x * 0.6

def s808(freq, d=0.9, glide=0.0):
    t = tt(d)
    f = freq * (1 + glide * np.exp(-t * 25))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.minimum(1, t * 400) * np.exp(-t * 2.6)
    return np.tanh(2.2 * x) * 0.9

def pluck(freq, d=0.5):
    t = tt(d); x = 0
    for k, a in enumerate([1, 0.5, 0.33, 0.2, 0.12], 1):
        x = x + a * np.sin(2 * np.pi * freq * k * t + k) * np.exp(-t * (6 + 5 * k))
    return x * np.minimum(1, t * 600) * 0.6

def stab(freqs, d=0.32):
    t = tt(d); x = 0
    for f in freqs:
        for det in (-0.006, 0.0, 0.006):
            ph = 2 * np.pi * f * (1 + det) * t
            x = x + sum(np.sin(h * ph) / h for h in range(1, 9)) * 0.12
    env = np.minimum(1, t * 200) * np.exp(-t * 9)
    return lp(x * env, 2600)

def riser(d, f0=300, f1=9000):
    t = tt(d); n = rng.standard_normal(len(t))
    out = np.zeros(len(t)); seg = 24
    for s in range(seg):  # 컷오프를 올려가며 노이즈를 이어 붙임
        a, b = int(len(t) * s / seg), int(len(t) * (s + 1) / seg)
        fc = f0 * (f1 / f0) ** (s / seg)
        out[a:b] = bp(n[a:b], fc * 0.6, min(fc * 1.6, SR / 2 - 100), 2)
    env = (t / d) ** 2.2
    tone = np.sin(2 * np.pi * np.cumsum(180 * (24 ** (t / d))) / SR) * env * 0.25
    return (out * 6 * env + tone)

def impact(d=1.8):
    t = tt(d)
    boom = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 2.2) + 28) / SR) * np.exp(-t * 2.4)
    air = lp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 5) * 0.5
    return np.tanh(1.8 * (boom + air))

def scratch(d=0.5):
    t = tt(d); f = 400 + 900 * np.sin(2 * np.pi * 5 * t) * np.exp(-t * 3)
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.4 + bp(rng.standard_normal(len(t)), 600, 5000) * 0.5
    return x * np.exp(-t * 4) * np.minimum(1, t * 100)

# ---------- 편곡 ----------
S = lambda bar, step: bar * BAR + step * STEP
CHORDS = [  # A단조 4코드: Am - F - C - G (MIDI)
    ([57, 60, 64, 67], 33),  # Am7, 루트 A1
    ([53, 57, 60, 64], 29),  # Fmaj7, 루트 F1
    ([48, 55, 60, 64], 36),  # Cmaj7, 루트 C2
    ([55, 59, 62, 65], 31),  # G7sus, 루트 G1
]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]  # 플럭 아르페지오 순서 (코드톤 인덱스)

for bar in range(8):
    chord, root = CHORDS[bar % 4]
    full = bar in (2, 3, 5, 6)           # 풀 드럼 마디
    drop = bar in (2, 3, 5, 6, 7)
    # --- 킥 / 808
    if bar == 0:
        kicks = [0]
    elif bar == 1:
        kicks = [0, 10]
    elif bar == 4:
        kicks = [0, 8]                   # 브레이크: 하프타임
    elif bar == 7:
        kicks = [0]                      # 아웃트로: 첫 박만
    else:
        kicks = [0, 7, 10] if bar % 2 == 0 else [0, 6, 10, 14]
    for s in kicks:
        add(drums, kick(), S(bar, s), 1.0); add(duck_src, kick(0.2), S(bar, s))
    if bar >= 1:
        for k, s in enumerate(kicks):  # 808 은 킥 위치에 얹고 루트/5도로 변주
            f = midi(root + (7 if (bar % 2 and k == len(kicks) - 1 and len(kicks) > 2) else 0))
            add(None, s808(f, 0.95 if k == 0 else 0.5, glide=0.5), S(bar, s), 0.85)
    else:
        add(None, s808(midi(root), 2.0, glide=0.4), S(bar, 0), 0.7)
    # --- 스네어 + 클랩 (2, 4박)
    if bar in (2, 3, 5, 6):
        for s in (4, 12):
            add(drums, snare(), S(bar, s), 0.85); add(drums, clap(), S(bar, s), 0.7)
    elif bar == 4:
        add(drums, snare(), S(bar, 8), 0.7); add(drums, clap(), S(bar, 8), 0.6)
    elif bar == 6 or bar == 7:
        pass
    # 빌드업 스네어 롤 (2마디 끝)
    if bar == 1:
        for k in range(16):
            t = S(1, 8) + k * STEP / 2 * (1 - k * 0.025)
            add(drums, snare(0.15), t, 0.25 + 0.04 * k)
    if bar == 6:  # 7마디 끝 롤 -> 아웃트로 임팩트
        for k in range(24):
            add(drums, snare(0.12), S(6, 8) + k * STEP / 3, 0.2 + 0.03 * k)
    # --- 하이햇
    if bar == 0:
        steps = [(s, 0.3) for s in (4, 12)]
    elif bar == 1:
        steps = [(s, 0.35 + 0.02 * s) for s in range(0, 16, 2)]
    elif bar == 4:
        steps = [(s, 0.25) for s in range(0, 16, 4)]
    elif bar == 7:
        steps = [(s, 0.4) for s in (4, 8, 12)]
    else:
        steps = [(s, 0.55 if s % 4 == 0 else 0.35 if s % 2 == 0 else 0.22) for s in range(16)]
    for s, v in steps:
        add(drums, hat(), S(bar, s), v, pan=(-0.2 if s % 4 else 0.2))
    if bar in (2, 3, 5, 6):
        add(drums, hat(open_=True), S(bar, 14), 0.45)
        if bar % 2 == 1:  # 트랩 롤 (32분)
            for k in range(6): add(drums, hat(0.04), S(bar, 12) + k * STEP / 3, 0.18 + 0.05 * k)
    if bar == 5:      # 더블타임 느낌: 6마디 16분 하이햇 + 32분 롤 강화
        for k in range(8): add(drums, hat(0.04), S(bar, 14) + k * STEP / 4, 0.25)
    # --- 코드 스탭 / 플럭 아르페지오
    freqs = [midi(n) for n in chord]
    if bar in (1, 2, 3, 5, 6, 7):
        for s in ((0, 6, 10) if bar != 7 else (0,)):
            add(None, stab(freqs), S(bar, s), 0.22 if bar != 7 else 0.3, pan=0.1)
    if bar in (2, 3, 5, 6):
        for k in range(16):
            if k % 2 == 1 or bar in (3, 6):
                n = chord[ARP[k % 8] % 4] + 12 + (12 if k % 8 == 7 else 0)
                add(None, pluck(midi(n)), S(bar, k), 0.16 + (0.04 if k % 4 == 0 else 0), pan=(0.3 if k % 2 else -0.3))
    if bar == 4:  # 브레이크: 느린 벨 3음
        for k, n in enumerate([chord[2] + 24, chord[1] + 24, chord[3] + 24]):
            add(None, pluck(midi(n), 1.2), S(bar, k * 4 + 2), 0.28, pan=0.0)

# ---------- FX ----------
add(None, scratch(), S(0, 0) , 0.35)
add(None, riser(BAR * 0.9), S(1, 0) + BAR * 0.1 + 0.0, 0.5)            # 2마디: 빌드 라이저
add(None, riser(BEAT * 1.5), BAR * 4 - BEAT * 1.5, 0.45)                 # 5마디 직전
add(None, riser(BEAT * 2), BAR * 7 - BEAT * 2, 0.5)                      # 8마디 직전
for t, g in [(0, 0.7), (BAR * 2, 1.0), (BAR * 4, 0.7), (BAR * 5, 0.9), (BAR * 6, 0.9), (BAR * 7, 1.1)]:
    add(None, impact(), t, g * 0.55)
for t in (BAR * 1, BAR * 3 + BEAT * 2):                                  # 컷 포인트 짧은 잡음 스윕
    add(None, hp(rng.standard_normal(int(SR * 0.25)), 3000) * np.exp(-tt(0.25) * 12) * 0.3, t, 1.0)

# ---------- 믹스 / 마스터 ----------
# 킥 사이드체인: 킥 포락선만큼 L/R(808,스탭,플럭) 볼륨을 눌러준다
env = np.abs(duck_src); env = lp(env, 12, 1); env = env / (env.max() + 1e-9)
duck = 1 - 0.55 * np.clip(env * 1.4, 0, 1)
Lm = L * duck + drums * 0.95
Rm = R * duck + drums * 0.95
# 에코(딜레이) - 스탭/플럭에 공간감
def echo(x, t, fb, n):
    y = x.copy(); d = int(t * SR)
    for k in range(1, n + 1):
        y[d*k:] += x[: N - d*k] * (fb ** k)
    return y
sendL = echo(R * duck, BEAT * 0.75, 0.38, 3) - R * duck
sendR = echo(L * duck, BEAT * 0.5, 0.38, 3) - L * duck
Lm += sendL * 0.5; Rm += sendR * 0.5
# 끝 페이드(마지막 0.25s) + 정규화
fade = np.ones(N); k = int(SR * 0.25); fade[-k:] = np.linspace(1, 0, k)
Lm *= fade; Rm *= fade
# 소프트 리미터: 드라이브로 평균 음량을 올리고, 샘플 피크를 -1.7 dBFS 이하로 제한(트루피크 여유, 최종 muxing에서 loudnorm으로 -14 LUFS / TP -1.5 맞춤)
drive = 2.4
Lm = np.tanh(Lm * drive / np.abs(Lm).max()); Rm = np.tanh(Rm * drive / np.abs(Rm).max())
peak = max(np.abs(Lm).max(), np.abs(Rm).max())
Lm *= 0.72 / peak; Rm *= 0.72 / peak
out = np.stack([Lm, Rm], 1)
pcm = (np.clip(out, -1, 1) * 32767).astype('<i2')
os.makedirs('promo/out', exist_ok=True)
with wave.open('promo/out/track.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print(f'OK  {DUR:.2f}s  peak {np.abs(out).max():.2f}  rms {np.sqrt((out**2).mean()):.3f}')
