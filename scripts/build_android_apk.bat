@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   Aerostate Clinic - Android APK Build Tool
echo ===================================================

cd /d "%~dp0\..\frontend"

echo [1/4] Building Vite React Web Assets...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Web build failed.
    exit /b %ERRORLEVEL%
)

echo [2/4] Syncing assets to native Android project...
call npx cap sync android
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Capacitor sync failed.
    exit /b %ERRORLEVEL%
)

echo [3/4] Compiling Native Android APK with Gradle...
if not defined JAVA_HOME (
    if exist "C:\Users\Ravi\.jdks\jbr-21.0.11" (
        set "JAVA_HOME=C:\Users\Ravi\.jdks\jbr-21.0.11"
    ) else if exist "C:\Program Files\Android\Android Studio\jbr" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    )
)

cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Gradle APK assembly failed.
    exit /b %ERRORLEVEL%
)

cd ..\..
copy /y "frontend\android\app\build\outputs\apk\debug\app-debug.apk" "aerostate-clinic-debug.apk" >nul

echo ===================================================
echo [SUCCESS] Android APK created successfully!
echo Path: %~dp0..\aerostate-clinic-debug.apk
echo ===================================================
pause
