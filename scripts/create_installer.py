"""
Aerostate Clinic Setup & Installer Builder
Packages the compiled AerostateClinic.exe and necessary runtime files into a clean Windows GUI Setup Installer.
"""

import os
import sys
import shutil
import base64
from pathlib import Path

INSTALLER_SCRIPT = """# -*- coding: utf-8 -*-
import os
import sys
import shutil
import subprocess
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path

def create_windows_shortcut(target_path, shortcut_path, description="Aerostate Clinic", icon_path=None):
    try:
        ps_script = f'''
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("{shortcut_path}")
        $Shortcut.TargetPath = "{target_path}"
        $Shortcut.WorkingDirectory = "{Path(target_path).parent}"
        $Shortcut.Description = "{description}"
        '''
        if icon_path and os.path.exists(icon_path):
            ps_script += f'\\n$Shortcut.IconLocation = "{icon_path}"'
        ps_script += '\\n$Shortcut.Save()'
        subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], creationflags=0x08000000, check=True)
    except Exception as e:
        print(f"Shortcut creation notice: {e}")

class InstallerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Aerostate Clinic - Installation Wizard")
        self.root.geometry("520x420")
        self.root.resizable(False, False)
        self.root.configure(bg="#0a1220")

        # Center on screen
        self.root.eval('tk::PlaceWindow . center')

        # Variables
        default_dir = os.path.join(os.environ.get("LOCALAPPDATA", "C:\\\\"), "Programs", "AerostateClinic")
        self.install_dir_var = tk.StringVar(value=default_dir)
        self.desktop_shortcut_var = tk.BooleanVar(value=True)
        self.start_menu_var = tk.BooleanVar(value=True)
        self.launch_after_var = tk.BooleanVar(value=True)

        self.setup_ui()

    def setup_ui(self):
        # Header banner
        header = tk.Frame(self.root, bg="#13233c", height=80)
        header.pack(fill="x")

        title_lbl = tk.Label(header, text="🏥 Aerostate Clinic System", font=("Segoe UI", 16, "bold"), fg="#ffffff", bg="#13233c")
        title_lbl.pack(anchor="w", padx=25, pady=(15, 2))

        sub_lbl = tk.Label(header, text="Offline-First Clinical Management & WhatsApp System Setup", font=("Segoe UI", 9), fg="#94a3b8", bg="#13233c")
        sub_lbl.pack(anchor="w", padx=25, pady=(0, 15))

        # Body container
        body = tk.Frame(self.root, bg="#0a1220")
        body.pack(fill="both", expand=True, padx=25, pady=20)

        # Destination Label
        tk.Label(body, text="Installation Folder:", font=("Segoe UI", 10, "bold"), fg="#ffffff", bg="#0a1220").pack(anchor="w")

        dir_frame = tk.Frame(body, bg="#0a1220")
        dir_frame.pack(fill="x", pady=(6, 15))

        entry = tk.Entry(dir_frame, textvariable=self.install_dir_var, font=("Segoe UI", 9), bg="#14243b", fg="#ffffff", insertbackground="#ffffff", relief="flat")
        entry.pack(side="left", fill="x", expand=True, ipady=6, padx=(0, 8))

        browse_btn = tk.Button(dir_frame, text="Browse...", font=("Segoe UI", 9), bg="#1e3656", fg="#ffffff", relief="flat", activebackground="#2a4a75", command=self.browse_folder)
        browse_btn.pack(side="right", ipady=2, ipadx=10)

        # Options
        tk.Label(body, text="Setup Options:", font=("Segoe UI", 10, "bold"), fg="#ffffff", bg="#0a1220").pack(anchor="w", pady=(5, 5))

        cb1 = tk.Checkbutton(body, text="Create Desktop Shortcut", variable=self.desktop_shortcut_var, font=("Segoe UI", 9), fg="#e2e8f0", bg="#0a1220", selectcolor="#13233c", activebackground="#0a1220", activeforeground="#ffffff")
        cb1.pack(anchor="w")

        cb2 = tk.Checkbutton(body, text="Create Start Menu Program Folder", variable=self.start_menu_var, font=("Segoe UI", 9), fg="#e2e8f0", bg="#0a1220", selectcolor="#13233c", activebackground="#0a1220", activeforeground="#ffffff")
        cb2.pack(anchor="w")

        cb3 = tk.Checkbutton(body, text="Launch Aerostate Clinic automatically when setup finishes", variable=self.launch_after_var, font=("Segoe UI", 9), fg="#e2e8f0", bg="#0a1220", selectcolor="#13233c", activebackground="#0a1220", activeforeground="#ffffff")
        cb3.pack(anchor="w")

        # Progress bar
        self.progress = ttk.Progressbar(body, orient="horizontal", mode="indeterminate")

        # Status Label
        self.status_lbl = tk.Label(body, text="Ready to install.", font=("Segoe UI", 9), fg="#94a3b8", bg="#0a1220")
        self.status_lbl.pack(anchor="w", pady=(15, 0))

        # Bottom Bar
        footer = tk.Frame(self.root, bg="#0a1220")
        footer.pack(fill="x", side="bottom", padx=25, pady=20)

        cancel_btn = tk.Button(footer, text="Cancel", font=("Segoe UI", 9), bg="#1e293b", fg="#cbd5e1", relief="flat", command=self.root.destroy)
        cancel_btn.pack(side="right", ipadx=12, ipady=4, padx=(8, 0))

        self.install_btn = tk.Button(footer, text="Install Now", font=("Segoe UI", 9, "bold"), bg="#2563eb", fg="#ffffff", relief="flat", activebackground="#1d4ed8", command=self.run_install)
        self.install_btn.pack(side="right", ipadx=16, ipady=4)

    def browse_folder(self):
        chosen = filedialog.askdirectory(initialdir=self.install_dir_var.get())
        if chosen:
            self.install_dir_var.set(os.path.join(chosen, "AerostateClinic"))

    def run_install(self):
        target_dir = self.install_dir_var.get().strip()
        if not target_dir:
            messagebox.showerror("Error", "Please specify an installation folder.")
            return

        self.install_btn.config(state="disabled")
        self.status_lbl.config(text="Installing Aerostate Clinic... Please wait.")
        self.progress.pack(fill="x", pady=(10, 0))
        self.progress.start(10)
        self.root.update()

        try:
            os.makedirs(target_dir, exist_ok=True)
            bundle_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
            src_exe = os.path.join(bundle_dir, "AerostateClinic.exe")
            dst_exe = os.path.join(target_dir, "AerostateClinic.exe")

            if os.path.exists(src_exe):
                shutil.copy2(src_exe, dst_exe)

            # Copy icon, config and seed database if not already present
            for fname in ["app_icon.ico", ".env.example", "clinic.db"]:
                sf = os.path.join(bundle_dir, fname)
                df = os.path.join(target_dir, fname)
                if os.path.exists(sf) and not os.path.exists(df):
                    shutil.copy2(sf, df)

            # Create uninstaller script
            uninstaller_bat = os.path.join(target_dir, "Uninstall.bat")
            with open(uninstaller_bat, "w", encoding="utf-8") as uf:
                uf.write(f'''@echo off
echo ===================================================
echo     Uninstalling Aerostate Clinic System
echo ===================================================
echo.
set /p confirm="Are you sure you want to uninstall Aerostate Clinic? (Y/N): "
if /i not "%confirm%"=="Y" exit /b

taskkill /f /im AerostateClinic.exe >nul 2>&1
timeout /t 1 >nul

del /q "%USERPROFILE%\\\\Desktop\\\\Aerostate Clinic.lnk" >nul 2>&1
rmdir /s /q "%APPDATA%\\\\Microsoft\\\\Windows\\\\Start Menu\\\\Programs\\\\Aerostate Clinic" >nul 2>&1

echo.
echo Application shortcuts removed.
echo To delete data files, please remove: {target_dir}
pause
''')

            icon_path = os.path.join(target_dir, "app_icon.ico")

            # Desktop shortcut
            if self.desktop_shortcut_var.get():
                desktop = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
                if os.path.exists(desktop):
                    create_windows_shortcut(dst_exe, os.path.join(desktop, "Aerostate Clinic.lnk"), "Aerostate Clinic System", icon_path)

            # Start Menu shortcut
            if self.start_menu_var.get():
                start_menu = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Aerostate Clinic")
                os.makedirs(start_menu, exist_ok=True)
                create_windows_shortcut(dst_exe, os.path.join(start_menu, "Aerostate Clinic.lnk"), "Aerostate Clinic System", icon_path)
                create_windows_shortcut(uninstaller_bat, os.path.join(start_menu, "Uninstall Aerostate Clinic.lnk"), "Uninstall Aerostate Clinic")

            self.progress.stop()
            self.progress.pack_forget()
            self.status_lbl.config(text="Installation completed successfully!", fg="#4ade80")
            self.root.update()

            if self.launch_after_var.get() and os.path.exists(dst_exe):
                subprocess.Popen([dst_exe], cwd=target_dir)

            messagebox.showinfo("Success", f"Aerostate Clinic has been installed successfully!\\n\\nLocation: {target_dir}")
            self.root.destroy()
        except Exception as e:
            self.progress.stop()
            self.progress.pack_forget()
            self.status_lbl.config(text=f"Error: {e}", fg="#f87171")
            self.install_btn.config(state="normal")
            messagebox.showerror("Installation Error", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    app = InstallerApp(root)
    root.mainloop()
"""

with open("installer_wizard.py", "w", encoding="utf-8") as f:
    f.write(INSTALLER_SCRIPT)

print("Created installer_wizard.py successfully!")
