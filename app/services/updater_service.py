import os
import sys
import json
import logging
import asyncio
import tempfile
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

import httpx
try:
    from packaging import version as pkg_version
except ImportError:
    class _FallbackVersion:
        def __init__(self, v_str):
            self.v_str = str(v_str).strip()
            clean = self.v_str.lower().lstrip("v")
            self._parts = []
            for part in clean.split("."):
                digits = "".join(filter(str.isdigit, part))
                self._parts.append(int(digits) if digits else 0)

        def __gt__(self, other):
            if isinstance(other, _FallbackVersion):
                return self._parts > other._parts
            return False

        def __str__(self):
            return self.v_str

    class _PkgVersion:
        @staticmethod
        def parse(v_str):
            return _FallbackVersion(v_str)

    pkg_version = _PkgVersion()

from app.config import settings

logger = logging.getLogger("aerostate_clinic.updater")


class UpdaterService:
    def __init__(self):
        self.current_version: str = getattr(settings, "APP_VERSION", "2.2.5")
        self.last_checked: Optional[datetime] = None
        self.update_available: bool = False
        self.latest_version: Optional[str] = None
        self.release_name: Optional[str] = None
        self.release_notes: Optional[str] = None
        self.download_url: Optional[str] = None
        self.is_downloading: bool = False
        self.download_progress: int = 0  # 0 to 100
        self.last_error: Optional[str] = None

    def get_status(self) -> Dict[str, Any]:
        """Returns the current updater status and cached update information."""
        return {
            "current_version": self.current_version,
            "latest_version": self.latest_version or self.current_version,
            "update_available": self.update_available,
            "release_name": self.release_name,
            "release_notes": self.release_notes,
            "download_url": self.download_url,
            "is_frozen": getattr(sys, "frozen", False),
            "is_downloading": self.is_downloading,
            "download_progress": self.download_progress,
            "last_checked": self.last_checked.isoformat() if self.last_checked else None,
            "last_error": self.last_error,
            "auto_update_enabled": getattr(settings, "AUTO_UPDATE_ENABLED", True),
        }

    def _is_newer(self, remote_ver_str: str, local_ver_str: str) -> bool:
        """Compares two semver version strings safely."""
        try:
            clean_remote = remote_ver_str.lstrip("v").strip()
            clean_local = local_ver_str.lstrip("v").strip()
            return pkg_version.parse(clean_remote) > pkg_version.parse(clean_local)
        except Exception:
            try:
                r_parts = [int(p) for p in clean_remote.split(".") if p.isdigit()]
                l_parts = [int(p) for p in clean_local.split(".") if p.isdigit()]
                return r_parts > l_parts
            except Exception:
                return False

    async def check_for_updates(self) -> Dict[str, Any]:
        """
        Queries the update manifest or GitHub releases API for newer application versions.
        """
        self.last_error = None
        manifest_url = getattr(settings, "UPDATE_MANIFEST_URL", None)
        github_repo = getattr(settings, "UPDATE_GITHUB_REPO", "ravibharti072/aerostate-clinic-whatsapp-automation")

        headers = {
            "User-Agent": f"AerostateClinic/{self.current_version} AutoUpdater",
            "Accept": "application/json",
        }

        found_info = None

        # 1. Try checking the raw manifest first (fast, no rate-limiting)
        if manifest_url:
            try:
                async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
                    resp = await client.get(manifest_url, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        remote_ver = data.get("version")
                        if remote_ver:
                            found_info = {
                                "version": remote_ver,
                                "name": data.get("name", f"AeroState Clinic v{remote_ver}"),
                                "notes": data.get("release_notes", "Bug fixes and performance improvements."),
                                "download_url": data.get("download_url"),
                            }
            except Exception as e:
                logger.debug(f"Update manifest check note: {e}")

        # 2. Fallback to GitHub Releases API if manifest didn't resolve
        if not found_info and github_repo:
            try:
                gh_api_url = f"https://api.github.com/repos/{github_repo}/releases/latest"
                async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
                    resp = await client.get(gh_api_url, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        tag_name = data.get("tag_name", "")
                        remote_ver = tag_name.lstrip("v")
                        
                        # Find matching asset (AerostateClinic.exe)
                        download_url = None
                        for asset in data.get("assets", []):
                            name = asset.get("name", "").lower()
                            if name == "aerostateclinic.exe" or (name.endswith(".exe") and "setup" not in name):
                                download_url = asset.get("browser_download_url")
                                break
                        if not download_url and data.get("assets"):
                            download_url = data["assets"][0].get("browser_download_url")

                        found_info = {
                            "version": remote_ver,
                            "name": data.get("name") or tag_name,
                            "notes": data.get("body", "Release updates and improvements."),
                            "download_url": download_url,
                        }
            except Exception as e:
                logger.debug(f"GitHub release check note: {e}")

        self.last_checked = datetime.utcnow()

        if found_info and found_info["version"]:
            self.latest_version = found_info["version"]
            self.release_name = found_info["name"]
            self.release_notes = found_info["notes"]
            self.download_url = found_info["download_url"]
            self.update_available = self._is_newer(found_info["version"], self.current_version)
            logger.info(
                f"Update check finished: local={self.current_version}, remote={self.latest_version}, update_available={self.update_available}"
            )
        else:
            self.update_available = False
            if not manifest_url and not github_repo:
                self.last_error = "No update server configured."
            else:
                self.last_error = "Unable to connect to update server (offline or server unreachable)."

        return self.get_status()

    async def apply_update(self, custom_download_url: Optional[str] = None) -> Dict[str, Any]:
        """
        Downloads the new executable and executes the hot-swap updater script to restart.
        """
        if self.is_downloading:
            return {"status": "in_progress", "message": "An update download is already in progress."}

        url = custom_download_url or self.download_url
        if not url:
            return {"status": "error", "message": "No download URL available for update."}

        # Security check: Validate URL against trusted official release domains
        from urllib.parse import urlparse
        parsed = urlparse(url)
        allowed_hosts = {
            "github.com",
            "objects.githubusercontent.com",
            "raw.githubusercontent.com",
            "github-releases.githubusercontent.com",
        }
        if parsed.scheme.lower() != "https" or parsed.netloc.lower() not in allowed_hosts:
            logger.warning(f"Blocked untrusted update download URL: {url}")
            return {
                "status": "error",
                "message": "Security policy violation: Updates may only be downloaded over HTTPS from official GitHub release channels.",
            }

        is_frozen = getattr(sys, "frozen", False)
        if not is_frozen:
            return {
                "status": "dev_mode",
                "message": "Running from Python source code. Please pull the latest Git changes (`git pull`) to update.",
                "download_url": url,
            }

        self.is_downloading = True
        self.download_progress = 0
        current_exe = Path(sys.executable).resolve()
        current_pid = os.getpid()

        temp_dir = Path(tempfile.gettempdir())
        temp_exe = temp_dir / f"AerostateClinic_update_{int(datetime.utcnow().timestamp())}.exe"
        updater_bat = temp_dir / f"aerostate_updater_{int(datetime.utcnow().timestamp())}.bat"

        try:
            logger.info(f"Downloading update from {url} to {temp_exe}...")
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                async with client.stream("GET", url) as response:
                    if response.status_code != 200:
                        raise RuntimeError(f"Server responded with HTTP {response.status_code}")

                    total_bytes = int(response.headers.get("content-length", 0))
                    downloaded = 0

                    with open(temp_exe, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            if chunk:
                                f.write(chunk)
                                downloaded += len(chunk)
                                if total_bytes > 0:
                                    self.download_progress = min(99, int((downloaded / total_bytes) * 100))

            self.download_progress = 100
            logger.info(f"Update download complete ({downloaded} bytes). Preparing updater swap script...")

            # Write Windows updater batch script
            bat_content = f"""@echo off
setlocal
set RETRIES=0

:WAIT_LOOP
timeout /t 1 /nobreak >nul
tasklist /FI "PID eq {current_pid}" 2>nul | find /I "{current_pid}" >nul
if not errorlevel 1 (
    set /A RETRIES+=1
    if %RETRIES% LSS 30 goto WAIT_LOOP
    taskkill /F /PID {current_pid} >nul 2>&1
)

copy /Y "{temp_exe}" "{current_exe}" >nul
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    copy /Y "{temp_exe}" "{current_exe}" >nul
)

del /F /Q "{temp_exe}" >nul 2>&1
start "" "{current_exe}"
del "%~f0" >nul 2>&1
exit
"""
            updater_bat.write_text(bat_content, encoding="utf-8")

            # Launch detached batch process
            flags = 0
            if sys.platform == "win32":
                CREATE_NO_WINDOW = 0x08000000
                DETACHED_PROCESS = 0x00000008
                flags = CREATE_NO_WINDOW | DETACHED_PROCESS

            subprocess.Popen(
                ["cmd.exe", "/c", str(updater_bat)],
                creationflags=flags,
                close_fds=True,
            )

            # Schedule clean exit
            async def shutdown_app():
                await asyncio.sleep(1.0)
                os._exit(0)

            asyncio.create_task(shutdown_app())

            return {
                "status": "applying",
                "message": "Update downloaded successfully. The application will restart in a few seconds.",
            }

        except Exception as e:
            self.last_error = f"Update installation failed: {str(e)}"
            logger.error(self.last_error)
            if temp_exe.exists():
                try:
                    temp_exe.unlink()
                except Exception:
                    pass
            return {"status": "error", "message": str(e)}
        finally:
            self.is_downloading = False


# Global singleton updater service
updater_service = UpdaterService()
