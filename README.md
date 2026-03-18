# unnie-discord

치지직(Chzzk) 라이브 알림 + YouTube 새 영상 알림 디스코드 봇

## 기능

- **치지직 라이브 알림** — 방송 시작/종료 시 자동 알림 (30초 간격 폴링)
- **YouTube 새 영상 알림** — 새 영상 업로드 시 자동 알림 (3분 간격 RSS 폴링)
- **역할 멘션** — @everyone 또는 특정 역할 핑
- **커스텀 문구** — 알림 메시지, 임베드 제목, 색상, 설명 모두 수정 가능
- **테스트 명령어** — 실제 알림 미리보기

## 슬래시 커맨드

| 커맨드 | 설명 | 권한 |
|--------|------|------|
| `/알림채널` | 현재 채널을 알림 채널로 설정 | 관리자 |
| `/치지직` | 모니터링할 치지직 채널 설정 | 관리자 |
| `/유튜브` | 모니터링할 YouTube 채널 설정 | 관리자 |
| `/핑설정` | 알림 시 멘션할 역할 설정 | 관리자 |
| `/문구설정` | 알림 메시지/제목 문구 수정 | 관리자 |
| `/임베드설정` | 임베드 색상/설명 수정 | 관리자 |
| `/테스트` | 알림 미리보기 전송 | 관리자 |
| `/상태` | 현재 설정 상태 확인 | 모두 |

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

4. Developer Portal > Bot > **Privileged Gateway Intents**:
   - Presence Intent ✅
   - Server Members Intent ✅
   - Message Content Intent ✅

5. 봇 초대 (client_id를 본인 봇 ID로 변경):

```
https://discord.com/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=19456&scope=bot+applications.commands
```

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
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable unnie-bot
sudo systemctl start unnie-bot
```

## 라이선스

[MIT](LICENSE)
