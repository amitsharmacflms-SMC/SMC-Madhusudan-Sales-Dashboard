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
app.secret_key = "supersecretkey"  # keep secure later

# -------------------------------
# Ensure users table exists
# -------------------------------
def ensure_users_table():
    engine = get_engine()
    query = """
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
        conn.execute(text(query))

ensure_users_table()

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
    if "user" not in session or session.get("role") != "Admin":
        flash("Admin access required.", "danger")
        return redirect(url_for("dashboard"))

# -------------------------------
# LOGIN
# -------------------------------
@app.route("/", methods=["GET", "POST"])
@app.route("/login", methods=["GET", "POST"])
def login():
    """Login using users table or fallback admin."""
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        user = get_user(username)
        if user and check_password_hash(user["password_hash"], password):
            session["user"] = user["user_id"]
            session["role"] = user["role"]
            session["state"] = user.get("state")
            session["manager_name"] = user.get("manager_name")
            session["district"] = user.get("district")
            flash("Login successful.", "success")
            return redirect(url_for("dashboard"))
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
# USER MANAGEMENT (ADMIN)
# -------------------------------
@app.route("/users")
def users_page():
    if "user" not in session or session.get("role") != "Admin":
        flash("Admin access required.", "danger")
        return redirect(url_for("dashboard"))

    engine = get_engine()
    with engine.connect() as conn:
        users = conn.execute(text("SELECT * FROM users ORDER BY id")).fetchall()
        users = [dict(u._mapping) for u in users]

    return render_template("admin.html", users=users, current_year=datetime.utcnow().year)


@app.route("/admin_create_user", methods=["POST"])
def admin_create_user():
    if "user" not in session or session.get("role") != "Admin":
        flash("Admin access required.", "danger")
        return redirect(url_for("dashboard"))

    user_id = request.form["user_id"]
    password = request.form.get("password")
    role = request.form.get("role", "User")
    state = request.form.get("state")
    manager = request.form.get("manager_name")
    district = request.form.get("district")

    password_hash = generate_password_hash(password) if password else None

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO users (user_id, password_hash, role, state, manager_name, district)
            VALUES (:u, :p, :r, :s, :m, :d)
            ON CONFLICT (user_id) DO UPDATE
            SET
                password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
                role = EXCLUDED.role,
                state = EXCLUDED.state,
                manager_name = EXCLUDED.manager_name,
                district = EXCLUDED.district
        """), {
            "u": user_id,
            "p": password_hash,
            "r": role,
            "s": state,
            "m": manager,
            "d": district
        })

    flash(f"User '{user_id}' created or updated successfully.", "success")
    return redirect(url_for("users_page"))


@app.route("/admin_delete_user/<int:user_id>", methods=["POST"])
def admin_delete_user(user_id):
    if "user" not in session or session.get("role") != "Admin":
        flash("Admin access required.", "danger")
        return redirect(url_for("dashboard"))

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM users WHERE id = :id AND user_id != 'admin'"), {"id": user_id})

    flash("User deleted successfully.", "success")
    return redirect(url_for("users_page"))

# -------------------------------
# REGISTER PAGE
# -------------------------------
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        user_id = request.form["user_id"]
        password = request.form["password"]
        role = request.form.get("role", "User")
        state = request.form.get("state")
        manager = request.form.get("manager_name")
        district = request.form.get("district")

        engine = get_engine()
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO users (user_id, password_hash, role, state, manager_name, district)
                VALUES (:u, :p, :r, :s, :m, :d)
                ON CONFLICT (user_id) DO NOTHING
            """), {
                "u": user_id,
                "p": generate_password_hash(password),
                "r": role,
                "s": state,
                "m": manager,
                "d": district
            })
        flash("User registered successfully.", "success")
        return redirect(url_for("login"))
    return render_template("register.html", current_year=datetime.utcnow().year)

# -------------------------------
# GET DATA (with user restriction)
# -------------------------------
@app.route("/get_data/<view_type>")
def get_data(view_type):
    """Return product or SKU data with normalized lowercase column names"""
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        engine = get_engine()
        if view_type not in ["product", "sku"]:
            return jsonify({"error": "Invalid table name"}), 400

        base_query = f"SELECT * FROM {view_type}"
        params = {}

        # Role-based access filtering
        if session.get("role") != "Admin":
            conditions = []
            if session.get("manager_name"):
                conditions.append("manager_name = :m")
                params["m"] = session["manager_name"]
            if session.get("state"):
                conditions.append("state = :s")
                params["s"] = session["state"]
            if session.get("district"):
                conditions.append("district = :d")
                params["d"] = session["district"]
            if conditions:
                base_query += " WHERE " + " AND ".join(conditions)

        df = pd.read_sql(text(base_query), con=engine, params=params).fillna(0)
        df.columns = [c.strip().lower() for c in df.columns]

        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                df[col] = df[col].astype(float).round(0).astype(int)

        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        print("❌ Error loading data:", e)
        return jsonify({"error": str(e)}), 500

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
