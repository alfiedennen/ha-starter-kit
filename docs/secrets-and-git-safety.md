# Secrets and git safety

Your Home Assistant config deserves version control — it's the only sane way
to answer "what changed before this broke?" and to survive a dead disk. But a
smart-home config is also a uniquely dangerous thing to leak. This page is the
discipline that lets you have both.

## Why this matters more than you think

A leaked **Home Assistant long-lived access token is full control of your
house**. Not "someone can see my light bulbs" — someone can: unlock your smart
lock, open your garage, disable your alarm automations, watch your presence
sensors to learn exactly when the house is empty, read a year of location
history, and pull your camera snapshots. A leaked config *without* tokens is
still a burglar's brochure: your lat/long, device inventory, lock model, and
daily schedule encoded as automations.

Public git repos are scraped by bots within **seconds** of a push. There is no
"I'll remove it in a minute" — by the minute, it's harvested. Treat any secret
that touches a pushed commit as compromised, permanently.

## secrets.yaml discipline

Home Assistant natively supports a `/config/secrets.yaml` file; any YAML value
can be replaced with a reference:

```yaml
# configuration.yaml
http:
  ...
recorder:
  db_url: !secret recorder_db_url
```

```yaml
# secrets.yaml — NEVER committed
recorder_db_url: "mysql://user:password@192.168.1.x:3306/homeassistant?charset=utf8mb4"
wifi_ssid: "MyNetwork"
wifi_password: "hunter2-but-better"
```

Rules:

- **Everything sensitive goes through `!secret`** — passwords, tokens, API
  keys, and also the quieter ones people forget: latitude/longitude, Wi-Fi
  SSID, internal hostnames, URLs with embedded credentials, webhook IDs
  (a webhook ID *is* a credential — anyone who has it can fire the webhook).
- Every kit component's README lists the secret keys it expects; start from
  `base/secrets.yaml.example`, which collects them all with placeholder
  values. The example file is committed; the real one never is.
- ESPHome has its own `secrets.yaml` in the ESPHome folder — same rules.
- Don't paste real secret values into chats, screenshots, forum posts, or bug
  reports. Redact first; the number of tokens leaked via "here's my log"
  screenshots is not small.

## .gitignore — deny by default

The safest stance for a config repo is: **ignore everything, allowlist what
you've reviewed**. At minimum, the kit's shipped `.gitignore` excludes:

```gitignore
secrets.yaml
*.env
.env*
.storage/          # HA's internal registry — contains auth tokens and credentials
*.dbetc            # databases, tokens, backups...
backups/
*.token
token.json
```

`.storage/` deserves emphasis: it looks like boring internal state, but it
contains **auth sessions, refresh tokens and integration credentials**.
Committing it is equivalent to committing your password. Never version it.

## Wire up the secret scanner as a pre-commit hook

The kit ships `scripts/check-secrets.py` — a zero-dependency regex scan of
your **staged diff** for a dozen secret formats (long-lived JWTs, private
keys, `Bearer` headers, cloud API key shapes, password-looking assignments).
It's a seatbelt, not a substitute for the discipline above — but it has caught
real slips.

Wire it so it runs on every commit:

```bash
# from your config repo root
mkdir -p .githooks
cat > .githooks/pre-commit <<'EOF'
#!/bin/sh
exec python scripts/check-secrets.py
EOF
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

Notes:

- `git config core.hooksPath` is **per-clone** — re-run it on every fresh
  clone of the repo. Put that instruction in your repo's README so
  future-you does it.
- Emergency bypass is `git commit --no-verify`. The correct number of times
  to use it is approximately zero.
- If your git host offers push-time secret scanning, turn it on as a second
  net; if it doesn't (some free plans), a CI job running the same script on
  push is a cheap backstop.

## If a secret ever lands in git history

It happens. The order of operations is the thing people get wrong:

1. **ROTATE FIRST.** Revoke the token / change the password / re-issue the
   key *immediately* — before any history surgery. History rewriting takes
   time, does nothing about clones and scrapes that already happened, and a
   half-done rewrite gives false comfort. Once rotated, the leaked value is
   worthless and the pressure is off.
   - HA long-lived tokens: your profile → Security → delete the token, issue
     a new one, update every consumer (and restart services that load it from
     an env file — a rotated token isn't picked up until they reload it).
   - Wi-Fi PSK in history: yes, that means changing the Wi-Fi password —
     tedious with many IoT devices, which is an excellent reason to never
     leak it in the first place.
2. **Then rewrite history** with [`git filter-repo`](https://github.com/newren/git-filter-repo)
   (the maintained successor to filter-branch) to remove the file or string
   from every commit, and force-push.
3. **Understand the blast radius of the rewrite**: every commit SHA changes
   from the earliest affected commit onwards. Every clone and fork must be
   re-cloned (not pulled — pulling merges the old history straight back in).
   If anyone else works from the repo, coordinate before force-pushing.
4. **Verify**: clone fresh into a temp dir and grep the full history
   (`git log -p | grep -i <fragment>`) to confirm it's gone.

And then have a quiet word with yourself about how it got past the hook —
usually the answer is a file pattern the `.gitignore` didn't cover, which is
fixable in one line.
