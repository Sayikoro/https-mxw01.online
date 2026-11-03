#!/usr/bin/env python3
"""
Публикация релиза MXW01 на GitHub (v1.0.57+).

Что делает:
  1. Собирает чистое дерево исходников в work/github-repo/ — из свежего
     download/mxw01-site-source-<версия>.zip (тот же манифест, что в поставке:
     src, public, prisma, scripts, конфиги, versions.md, README-СБОРКА.md).
     Папка .git сохраняется — каждый релиз это обычный коммит поверх истории;
  2. git add -A, коммит «v<версия>»; при ПЕРВОЙ публикации (локальная история
     пуста, а на GitHub уже есть начальный коммит от GitHub) main пушится
     force — история начинается с этого релиза;
  3. пушит main и тег v<версия> в GitHub;
  4. создаёт GitHub Release v<версия> (или обновляет существующий) с заметками
     из секции текущей версии versions.md;
  5. прикрепляет download/mxw01-deploy-kit.zip ассетом (перезалив при повторе).

Переменные окружения:
  GITHUB_TOKEN  — токен с правами «Contents: Read and write» на репозиторий
                  (обязателен; классический или fine-grained);
  GITHUB_REPO   — owner/repo (обязателен);
  GITHUB_DRYRUN — 1 = показать план и заметки релиза, ничего не менять.

Токен нигде не сохраняется: он подставляется только в URL пуша и заголовки
запросов внутри этого процесса; любой вывод с токеном маскируется как ***.

Порядок релиза: правки → site.ts/версия sw/versions.md → сборка
(build-offline.sh → build-static.sh → package-source.py) → этот скрипт.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "work", "github-repo")
SITE_TS = os.path.join(ROOT, "src", "lib", "printer", "site.ts")
VERSIONS_MD = os.path.join(ROOT, "versions.md")
SRC_ZIPS = os.path.join(ROOT, "download", "mxw01-site-source-*.zip")
KIT = os.path.join(ROOT, "download", "mxw01-deploy-kit.zip")
API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"
GIT_NAME = "MXW01 Release Bot"
GIT_EMAIL = "bot@mxw01.local"
TOKEN = ""  # подставляется в main(); нужен для маскировки в ошибках git


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def read_version() -> str:
    m = re.search(r'APP_VERSION\s*=\s*"([0-9.]+)"', open(SITE_TS, encoding="utf-8").read())
    if not m:
        fail("Не найден APP_VERSION в src/lib/printer/site.ts")
    return m.group(1)


def redact(s: str, token: str) -> str:
    return s.replace(token, "***") if token else s


def run(args, cwd=None, ok_codes=(0,)):
    """git/консольная команда; вывод при ошибке маскируется (токен → ***)."""
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if p.returncode not in ok_codes:
        fail(f"{args[0]} … вернул {p.returncode}:\n{redact(p.stderr, TOKEN).strip()}")
    return redact(p.stdout, TOKEN)


def gh(method: str, url: str, token: str, payload=None, raw=None, ctype=None):
    """Запрос к GitHub API; возвращает (код, json|bytes|str)."""
    headers = {
        "User-Agent": "MXW01-updater/1.0",
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
    }
    if ctype:
        headers["Content-Type"] = ctype
    data = None
    if raw is not None:
        data = raw
    elif payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        body = e.read()
        code = e.code
    except OSError as e:
        fail(f"Сеть недоступна ({method} {url.split('github.com')[-1]}): {e}")
    if payload is None and raw is None:
        try:
            return code, json.loads(body)
        except (ValueError, TypeError):
            return code, body.decode("utf-8", "replace")
    return code, None


def release_notes(ver: str) -> str:
    """Секция текущей версии из versions.md (между «### ver» и следующим «###»)."""
    md = open(VERSIONS_MD, encoding="utf-8").read()
    m = re.search(rf"(?ms)^### {re.escape(ver)} .*?$(.*?)(?=^### |\Z)", md)
    if not m:
        fail(f"В versions.md нет секции версии {ver}")
    return f"MXW01 Web Terminal {ver}\n\n{m.group(1).strip()}\n"


def refresh_tree(src_zip: str, dry: bool) -> None:
    """Чистое дерево исходников в work/github-repo/ (.git сохраняется)."""
    if dry:
        print(f"  (dry) распаковал бы {os.path.basename(src_zip)} → {WORK}")
        return
    if not os.path.isdir(os.path.join(WORK, ".git")):
        os.makedirs(WORK, exist_ok=True)
        run(["git", "init", "-b", "main"], cwd=WORK)
        run(["git", "config", "user.name", GIT_NAME], cwd=WORK)
        run(["git", "config", "user.email", GIT_EMAIL], cwd=WORK)
    for entry in os.listdir(WORK):
        if entry == ".git":
            continue
        path = os.path.join(WORK, entry)
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
    with zipfile.ZipFile(src_zip) as z:
        z.extractall(WORK)


def git_commit_and_push(ver: str, repo: str, token: str, dry: bool) -> None:
    tag = f"v{ver}"
    if dry:
        print(f"  (dry) commit «{tag}», push main+{tag} → {repo}")
        return
    # Первый релиз поверх начального коммита GitHub публикуется force:
    # локальная история (из свежего дерева) не содержит «Initial commit».
    had_commits = bool(run(["git", "rev-parse", "--verify", "HEAD"],
                           cwd=WORK, ok_codes=(0, 128)).strip())
    run(["git", "add", "-A"], cwd=WORK)
    if run(["git", "status", "--porcelain"], cwd=WORK).strip():
        run(["git", "-c", f"user.name={GIT_NAME}", "-c", f"user.email={GIT_EMAIL}",
             "commit", "-m", tag], cwd=WORK)
        print(f"  ✓ коммит {tag} создан")
    else:
        print("  · изменений в исходниках нет — коммит не нужен")
    run(["git", "tag", "-f", tag], cwd=WORK)
    url = f"https://x-access-token:{token}@github.com/{repo}.git"
    push_args = ["git", "push"] + (["--force"] if not had_commits else []) + [url, "main"]
    run(push_args, cwd=WORK)
    run(["git", "push", "--force", url, f"refs/tags/{tag}:refs/tags/{tag}"], cwd=WORK)
    print(f"  ✓ push main + {tag} → github.com/{repo}")


def publish_release(ver: str, repo: str, token: str, dry: bool) -> None:
    tag = f"v{ver}"
    notes = release_notes(ver)
    if dry:
        print(f"  (dry) Release {tag} → {repo}, ассет {os.path.basename(KIT)}")
        print("  --- заметки релиза (превью) ---")
        for line in notes.splitlines()[:6]:
            print(f"  | {line}")
        return
    if not os.path.exists(KIT):
        fail("Нет download/mxw01-deploy-kit.zip — сначала соберите кит")
    code, rel = gh("GET", f"{API}/repos/{repo}/releases/tags/{tag}", token)
    if code == 200:
        rel_id = rel["id"]
        gh("PATCH", f"{API}/repos/{repo}/releases/{rel_id}", token,
           payload={"name": tag, "body": notes, "draft": False, "prerelease": False})
        print(f"  ✓ Release {tag} обновлён")
    elif code == 404:
        code, rel = gh("POST", f"{API}/repos/{repo}/releases", token,
                       payload={"tag_name": tag, "name": tag, "body": notes})
        if code not in (201, 200):
            fail(f"Release не создан (код {code}): {json.dumps(rel, ensure_ascii=False)[:300]}")
        rel_id = rel["id"]
        print(f"  ✓ Release {tag} создан")
    else:
        fail(f"Не удалось получить релиз {tag} (код {code})")
    # Ассет: перезалив при повторе
    code, rel = gh("GET", f"{API}/repos/{repo}/releases/tags/{tag}", token)
    for a in rel.get("assets", []):
        if a.get("name") == os.path.basename(KIT):
            gh("DELETE", f"{API}/repos/{repo}/releases/assets/{a['id']}", token)
            print(f"  · старый ассет {a['name']} удалён")
    data = open(KIT, "rb").read()
    up_url = f"{UPLOADS}/repos/{repo}/releases/{rel_id}/assets?name={os.path.basename(KIT)}"
    code, _ = gh("POST", up_url, token, raw=data, ctype="application/zip")
    if code not in (201, 200):
        fail(f"Ассет не загружен (код {code})")
    print(f"  ✓ ассет {os.path.basename(KIT)} ({len(data) // 1024} КБ) прикреплён к {tag}")


def main() -> int:
    global TOKEN
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    repo = os.environ.get("GITHUB_REPO", "").strip()
    dry = os.environ.get("GITHUB_DRYRUN") == "1"
    if not re.match(r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$", repo):
        fail("GITHUB_REPO не задан или не в формате owner/repo")
    if not token and not dry:
        fail("GITHUB_TOKEN не задан (нужен токен с правами Contents: Read and write)")
    TOKEN = token
    # git: не зависать на промпте учетных данных и рвать медленную сеть
    os.environ.setdefault("GIT_TERMINAL_PROMPT", "0")
    os.environ.setdefault("GIT_HTTP_LOW_SPEED_LIMIT", "1000")
    os.environ.setdefault("GIT_HTTP_LOW_SPEED_TIME", "30")
    ver = read_version()
    tag = f"v{ver}"
    print(f"Публикация {tag} → github.com/{repo}" + (" (DRY RUN)" if dry else ""))

    zips = sorted(glob.glob(SRC_ZIPS))
    if not zips:
        fail("Нет download/mxw01-site-source-*.zip — сначала package-source.py")
    src_zip = zips[-1]
    if ver not in os.path.basename(src_zip):
        fail(f"Архив исходников {os.path.basename(src_zip)} не версии {ver} — пересоберите package-source.py")
    print(f"  · дерево: {os.path.basename(src_zip)}")
    refresh_tree(src_zip, dry)
    git_commit_and_push(ver, repo, token, dry)
    publish_release(ver, repo, token, dry)
    print(f"✓ Готово: https://github.com/{repo}/releases/tag/{tag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
