# app.py (patched)
import os
from datetime import datetime
import pandas as pd
from flask import (
    Flask, render_template, request,
    redirect, url_for, session, flash, jsonify
)
from sqlalchemy import text
from werkzeug.security import generate_password_hash, check_password_hash
from database import get_engine

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "supersecretkey")  # set securely in prod



# Ensure users table and admin exist
# -------------------------------
def ensure_users_table():
    engine = get_engine()

    create_table_query = """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'User',
        state TEXT,
        manager_name TEXT,
        district TEXT
    );
    """

    with engine.begin() as conn:
        # 1️⃣ Create table if missing
        conn.execute(text(create_table_query))

        # 2️⃣ Ensure UNIQUE constraint on user_id
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'users_user_id_unique'
                ) THEN
                    ALTER TABLE users
                    ADD CONSTRAINT users_user_id_unique UNIQUE (user_id);
                END IF;
            END$$;
        """))

        # 3️⃣ Ensure default admin user exists
        admin_user = conn.execute(text("SELECT * FROM users WHERE user_id = 'admin'")).fetchone()
        if not admin_user:
            from werkzeug.security import generate_password_hash
            conn.execute(text("""
                INSERT INTO users (user_id, password_hash, role)
                VALUES ('admin', :pw, 'Admin')
            """), {"pw": generate_password_hash("smc123")})
            print("✅ Default admin user created (admin / smc123)")





# -------------------------------
# Helper functions
# -------------------------------
def get_user(user_id):
    engine = get_engine()
    with engine.connect() as conn:
        q = text("SELECT * FROM users WHERE user_id = :uid")
        res = conn.execute(q, {"uid": user_id}).fetchone()
        return dict(res._mapping) if res else None

def require_admin():
    """
    Helper to be used in route handlers. If not admin, returns a redirect response.
    If OK, returns None.
    """
    if "user" not in session or session.get("role") != "Admin":
        flash("Admin access required.", "danger")
        return redirect(url_for("dashboard"))
    return None

# -------------------------------
# LOGIN
# -------------------------------
@app.route("/", methods=["GET", "POST"])
@app.route("/login", methods=["GET", "POST"])
def login():
    """Login using users table or fallback admin."""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        user = get_user(username)
        if user and check_password_hash(user["password_hash"], password):
            session["user"] = user["user_id"]
            session["role"] = user.get("role", "User")
            session["state"] = user.get("state")
            session["manager_name"] = user.get("manager_name")
            session["district"] = user.get("district")
            flash("Login successful.", "success")
            return redirect(url_for("dashboard"))
        # fallback admin (keeps your original quick-login)
        elif username == "admin" and password == "smc123":
            session["user"] = "admin"
            session["role"] = "Admin"
            flash("Login successful (fallback admin).", "success")
            return redirect(url_for("dashboard"))
        else:
            flash("Invalid Username or Password.", "danger")

    return render_template("login.html", current_year=datetime.utcnow().year)

# -------------------------------
# LOGOUT
# -------------------------------
@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.", "success")
    return redirect(url_for("login"))

# -------------------------------
# DASHBOARD
# -------------------------------
@app.route("/dashboard")
def dashboard():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("dashboard.html", current_year=datetime.utcnow().year)

# -------------------------------
# -------------------------------
# USER MANAGEMENT (ADMIN) — AJAX VERSION
# -------------------------------

@app.route("/users")
def users_page():
    """Render Admin User Management Dashboard"""
    if "user" not in session or session.get("role") != "Admin":
        flash("Admin access required.", "danger")
        return redirect(url_for("dashboard"))

    return render_template("admin.html", current_year=datetime.utcnow().year)


# ====== AJAX APIs ======

@app.route("/admin_api/list_users")
def api_list_users():
    """Return JSON list of all users"""
    if "user" not in session or session.get("role") != "Admin":
        return jsonify({"error": "Unauthorized"}), 403

    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM users ORDER BY id")).fetchall()
        users = [dict(r._mapping) for r in rows]
    return jsonify(users)


@app.route("/admin_api/create_or_update", methods=["POST"])
def api_create_or_update_user():
    """Create or update a user from admin panel"""
    if "user" not in session or session.get("role") != "Admin":
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(force=True)
    user_id = data.get("user_id", "").strip()
    password = data.get("password", "")
    role = data.get("role", "User")
    state = data.get("state")
    manager = data.get("manager_name")
    district = data.get("district")

    if not user_id:
        return jsonify({"error": "User ID required"}), 400

    engine = get_engine()
    # Check if user exists
    with engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM users WHERE user_id = :u"), {"u": user_id}
        ).fetchone() is not None

    # If new user and no password provided
    if not exists and not password:
        return jsonify({"error": "Password is required for new user"}), 400

    password_hash = generate_password_hash(password) if password else None

    # Create / update user record
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO users (user_id, password_hash, role, state, manager_name, district)
                VALUES (:u, :p, :r, :s, :m, :d)
                ON CONFLICT (user_id) DO UPDATE
                SET
                    password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
                    role = EXCLUDED.role,
                    state = EXCLUDED.state,
                    manager_name = EXCLUDED.manager_name,
                    district = EXCLUDED.district
            """),
            {
                "u": user_id,
                "p": password_hash,
                "r": role,
                "s": state,
                "m": manager,
                "d": district,
            },
        )

    return jsonify({"success": True, "message": f"User '{user_id}' saved successfully."})


@app.route("/admin_api/delete/<int:user_id>", methods=["DELETE"])
def api_delete_user(user_id):
    """Delete user record"""
    if "user" not in session or session.get("role") != "Admin":
        return jsonify({"error": "Unauthorized"}), 403

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM users WHERE id = :id AND user_id != 'admin'"),
            {"id": user_id},
        )

    return jsonify({"success": True, "message": "User deleted successfully."})

# -------------------------------
# HEALTH CHECK
# -------------------------------
@app.route("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}

# -------------------------------
# MAIN
# -------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Starting Flask on port {port}")
    app.run(host="0.0.0.0", port=port, debug=True)
