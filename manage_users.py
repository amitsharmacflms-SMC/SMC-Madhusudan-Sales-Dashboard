from werkzeug.security import generate_password_hash
from sqlalchemy import text
from database import get_engine


def add_or_update_user(user_id, password, role="User"):
    """
    Adds or updates a user in the existing users table.
    Uses your actual column names: user_id, password_hash, role.
    """
    engine = get_engine()
    hashed_pw = generate_password_hash(password)

    query = text("""
        INSERT INTO users (user_id, password_hash, role)
        VALUES (:user_id, :password_hash, :role)
        ON CONFLICT (user_id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
    """)

    with engine.begin() as conn:
        conn.execute(query, {
            "user_id": user_id,
            "password_hash": hashed_pw,
            "role": role
        })
    
    print(f"✅ User '{user_id}' added/updated successfully with role '{role}'.")


def list_users():
    """Show all users currently in the table."""
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(text("SELECT id, user_id, role FROM users ORDER BY id"))
        rows = result.fetchall()
        if not rows:
            print("⚠️ No users found in the database.")
        for row in rows:
            # ✅ Fix: Convert using _mapping instead of dict(row)
            print(dict(row._mapping))


if __name__ == "__main__":
    # 👇 Add your admin user
    add_or_update_user("admin1", "admin1", "admin")

    # Optional: print all users
    print("\nCurrent users:")
    list_users()
