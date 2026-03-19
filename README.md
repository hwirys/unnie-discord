# unnie-discord

치지직(Chzzk) 라이브 알림 + YouTube 새 영상 알림 디스코드 봇

## 기능

- **치지직 라이브 알림** — 방송 시작/종료 시 자동 알림 (30초 간격 폴링)
- **YouTube 새 영상 알림** — 새 영상 업로드 시 자동 알림 (3분 간격 RSS 폴링)
- **플랫폼별 역할 멘션** — 치지직/YouTube 각각 다른 역할 핑 설정 가능
- **반응 역할** — 이모지 클릭으로 역할 자동 부여/제거
- **커스텀 문구** — 알림 메시지, 임베드 제목, 색상, 설명 모두 수정 가능
- **굿즈 홍보** — 굿즈 URL과 홍보 문구 설정
- **클립 공유** — 명장면 클립 등록 후 랜덤 재생
- **테스트 명령어** — 실제 알림과 동일한 미리보기

## 슬래시 커맨드

### 알림 설정 (관리자)

| 커맨드 | 설명 |
|--------|------|
| `/알림채널` | 현재 채널을 알림 채널로 설정 |
| `/치지직 <채널>` | 모니터링할 치지직 채널 설정 (ID 또는 URL) |
| `/유튜브 <채널>` | 모니터링할 YouTube 채널 설정 (ID 또는 URL) |
| `/핑설정 <플랫폼> <대상>` | 치지직/YouTube 별도 멘션 역할 설정 |
| `/문구설정 <종류> <문구>` | 알림 메시지/제목 문구 수정 |
| `/임베드설정 <종류>` | 임베드 색상/설명 수정 |
| `/테스트` | 알림 미리보기 전송 |

### 반응 역할 (관리자)

| 커맨드 | 설명 |
|--------|------|
| `/반응역할 <이모지> <역할>` | 이모지-역할 매핑 추가 |
| `/반응역할제거 <이모지>` | 매핑 제거 |
| `/반응역할초기화` | 반응 역할 메시지 삭제 및 초기화 |

### 굿즈 & 클립

| 커맨드 | 설명 | 권한 |
|--------|------|------|
| `/굿즈설정 <url> <제목> <문구>` | 굿즈 URL/문구 설정 | 관리자 |
| `/굿즈` | 굿즈 정보 표시 | 모두 |
| `/클립추가 <제목> <url>` | 클립 등록 | 관리자 |
| `/클립삭제 <번호>` | 클립 삭제 | 관리자 |
| `/클립` | 랜덤 클립 재생 | 모두 |
| `/클립목록` | 전체 클립 리스트 | 모두 |

### 기타

| 커맨드 | 설명 | 권한 |
|--------|------|------|
| `/상태` | 현재 봇 설정 상태 확인 | 모두 |

## 설치

```bash
git clone https://github.com/hwirys/unnie-discord.git
cd unnie-discord
npm install
```

## 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 봇 생성
2. Bot 메뉴에서 토큰 복사
3. `.env` 파일 생성:

```bash
cp .env.example .env
# BOT_TOKEN=your_token_here 입력
```

4. 봇 초대 (`YOUR_BOT_ID`를 본인 봇 Application ID로 변경):

```
https://discord.com/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=268504064&scope=bot+applications.commands
```

권한: 메시지 보내기, 임베드, 반응 추가, 역할 관리

## 실행

```bash
node index.js
```

### systemd 서비스로 실행 (선택)

```ini
# /etc/systemd/system/unnie-bot.service
[Unit]
Description=Unnie Discord Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/unnie-discord
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable unnie-bot
sudo systemctl start unnie-bot
```

## 라이선스

[MIT](LICENSE)
