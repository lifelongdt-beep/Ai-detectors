# 인스타 릴스 홍보영상 (1080x1920, 30fps, 20초)

실제 시뮬레이터 엔진(`sim/engine.js`)으로 3D 교실을 렌더링하고, 96 BPM 비트를 직접 합성해 입힌다.
프레임은 시간 t의 순수 함수이므로 병렬 렌더링해도 결과가 같다.

```bash
pip install numpy scipy
python3 promo/audio.py                                   # 비트 합성 -> promo/out/track.wav
PLAYWRIGHT_PATH=$(npm root -g)/playwright \
  node promo/render.mjs --workers 4                      # 프레임 -> promo/out/frames/*.jpg (약 35초)
ffmpeg -framerate 30 -i promo/out/frames/%04d.jpg -i promo/out/track.wav \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 256k \
  -af loudnorm=I=-14:TP=-1.5:LRA=11 -shortest -movflags +faststart promo/out/ai-detectors-reels.mp4
```
구성(마디=2.5초): 1 훅 / 2 레이더 / 3-4 3D 시뮬레이터 / 5 히트맵 / 6 수치 / 7 키워드 / 8 CTA.
폰트: Black Han Sans (SIL OFL, `fonts/blackhan/LICENSE`). 화면의 수치는 모두 시뮬레이션 값이며 영상에 면책 문구를 넣었다.
