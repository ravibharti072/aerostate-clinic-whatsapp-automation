"""
CLI Tool to Create or Update the SuperAdmin User
Usage:
    python create_superadmin.py <username> <password> "<full_name>"
Example:
    python create_superadmin.py ravibharti SecurePassword123! "Ravi Bharti"
"""

import sys
import getpass
from app.database import SessionLocal, Base, engine
from app.models import User
from app.security import hash_password


def create_or_update_superadmin(username: str, password: str, name: str = "Super Admin"):
    clean_username = username.strip().lower()
    clean_password = password.strip()

    if len(clean_username) < 3:
        print("[ERROR] Username must be at least 3 characters long.")
        sys.exit(1)

    if len(clean_password) < 8:
        print("[ERROR] Password must be at least 8 characters long for security.")
        sys.exit(1)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        user = db.query(User).filter(User.username == clean_username).first()
        if user:
            user.password_hash = hash_password(clean_password)
            user.role = "SuperAdmin"
            user.name = name.strip() or "Super Admin"
            user.is_active = True
            db.commit()
            print(f"[OK] SuperAdmin '{clean_username}' credentials and role updated successfully!")
        else:
            new_user = User(
                username=clean_username,
                name=name.strip() or "Super Admin",
                password_hash=hash_password(clean_password),
                role="SuperAdmin",
                is_active=True,
            )
            db.add(new_user)
            db.commit()
            print(f"[OK] SuperAdmin '{clean_username}' created successfully!")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        u = sys.argv[1]
        p = sys.argv[2]
        n = sys.argv[3] if len(sys.argv) > 3 else "Clinic SuperAdmin"
    else:
        print("--- SuperAdmin Initialization ---")
        u = input("Enter SuperAdmin Username: ").strip()
        p = getpass.getpass("Enter Secure Password (min 8 characters): ").strip()
        n = input("Enter Full Name [Clinic SuperAdmin]: ").strip() or "Clinic SuperAdmin"

    create_or_update_superadmin(u, p, n)
