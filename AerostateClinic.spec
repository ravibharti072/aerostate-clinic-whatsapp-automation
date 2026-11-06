# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, collect_submodules
import os

block_cipher = None

datas = [
    ('frontend/dist', 'frontend/dist'),
    ('clinic.db', '.'),
    ('.env.example', '.'),
    ('version.json', '.'),
]
if os.path.exists('app_icon.ico'):
    datas.append(('app_icon.ico', '.'))

datas += collect_data_files('webview')

hiddenimports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.wsproto_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'passlib.handlers.bcrypt',
    'bcrypt',
    'sqlalchemy.dialects.sqlite',
    'reportlab',
    'pydantic',
    'pydantic_settings',
    'email_validator',
    'packaging',
    'packaging.version',
    'httpx',
    'clr',
    'pythonnet',
    'webview',
    'webview.platforms.winforms',
]
hiddenimports += collect_submodules('app')
hiddenimports += collect_submodules('webview')

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'scipy'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='AerostateClinic',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Windowed mode: NO black console prompt window!
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='app_icon.ico' if os.path.exists('app_icon.ico') else None,
)
