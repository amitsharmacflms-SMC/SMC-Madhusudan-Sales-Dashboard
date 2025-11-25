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
app.secret_key = os.environ.get("FLASK_SECRET", "supersecretkey")  # secure this in prod


# -------------------------------
# Ensure users table and default admin
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
        conn.execute(text(create_table_query))
        # unique constraint (safe check)
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
        admin_user = conn.execute(text("SELECT * FROM users WHERE user_id = 'admin'")).fetchone()
        if not admin_user:
            conn.execute(text("""
                INSERT INTO users (user_id, password_hash, role)
                VALUES ('admin', :pw, 'Admin')
            """), {"pw": generate_password_hash("smc123")})
            print("✅ Default admin created (admin / smc123)")


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
    return None


# -------------------------------
# LOGIN
# -------------------------------
@app.route("/", methods=["GET", "POST"])
@app.route("/login", methods=["GET", "POST"])
def login():
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
            return redirect(url_for("sales_levels"))

        elif username == "admin" and password == "smc123":
            session["user"] = "admin"
            session["role"] = "Admin"
            flash("Login successful (fallback admin).", "success")
            return redirect(url_for("sales_levels"))

        else:
            flash("Invalid Username or Password.", "danger")

    return render_template("login.html", current_year=datetime.utcnow().year)


# -------------------------------
# SALES LEVEL SELECTION PAGE
# -------------------------------
@app.route("/sales_levels")
def sales_levels():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("sales_levels.html", current_year=datetime.utcnow().year)


# -------------------------------
# DASHBOARDS
# -------------------------------
@app.route("/dashboard")
def dashboard():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("dashboard.html", current_year=datetime.utcnow().year)


@app.route("/dashboard/stock")
def dashboard_stock():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("stock_dashboard.html")


@app.route("/dashboard/daily_sale")
def dashboard_daily_sale():
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("daily_sale_dashboard.html")


@app.route("/dashboard/plant")
def dashboard_plant():
    """Tab 1 → Plant → Depot / Direct (ERP Dashboard)"""
    if "user" not in session:
        return redirect(url_for("login"))
    return render_template("lighthouse_dashboard.html", current_year=datetime.utcnow().year)


@app.route("/comparison_new1")
def comparison():
    if "user" not in session:
        return redirect(url_for("login"))
    try:
        return render_template("comparison_new1.html", current_year=datetime.utcnow().year)
    except Exception as e:
        import traceback
        print("❌ Error rendering comparison page:", e)
        traceback.print_exc()
        return f"<pre>{traceback.format_exc()}</pre>", 500


@app.route("/dashboard/ss")
def dashboard_ss():
    if "user" not in session:
        return redirect(url_for("login"))
    return """
    <script>
    alert('🚧 SS → Distributor / Sub Distributor dashboard is under process.');
    window.location.href='/sales_levels';
    </script>
    """


# -------------------------------
# LOGOUT
# -------------------------------
@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.", "success")
    return redirect(url_for("login"))


# -------------------------------
# ADMIN MANAGEMENT
# -------------------------------
@app.route("/admin_api/list_users")
def api_list_users():
    if "user" not in session or session.get("role") != "Admin":
        return jsonify({"error": "Unauthorized"}), 403
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, user_id, role, state, manager_name, district FROM users ORDER BY id")).fetchall()
        users = [dict(r._mapping) for r in rows]
    return jsonify(users)


@app.route("/admin_api/create_or_update", methods=["POST"])
def api_create_or_update_user():
    if "user" not in session or session.get("role") != "Admin":
        return jsonify({"error": "Unauthorized"}), 403
    try:
        data = request.get_json() or {}
        user_id = data.get("user_id", "").strip()
        password = data.get("password", "")
        role = data.get("role", "User")
        state = data.get("state")
        manager = data.get("manager_name")
        district = data.get("district")

        if not user_id:
            return jsonify({"success": False, "message": "User ID is required."})

        password_hash = generate_password_hash(password) if password else None
        engine = get_engine()
        with engine.begin() as conn:
            if password_hash:
                conn.execute(text("""
                    INSERT INTO users (user_id, password_hash, role, state, manager_name, district)
                    VALUES (:u, :p, :r, :s, :m, :d)
                    ON CONFLICT (user_id) DO UPDATE
                    SET password_hash = EXCLUDED.password_hash,
                        role = EXCLUDED.role,
                        state = EXCLUDED.state,
                        manager_name = EXCLUDED.manager_name,
                        district = EXCLUDED.district
                """), {"u": user_id, "p": password_hash, "r": role, "s": state, "m": manager, "d": district})
            else:
                conn.execute(text("""
                    INSERT INTO users (user_id, password_hash, role, state, manager_name, district)
                    VALUES (:u, (SELECT password_hash FROM users WHERE user_id = :u), :r, :s, :m, :d)
                    ON CONFLICT (user_id) DO UPDATE
                    SET role = EXCLUDED.role,
                        state = EXCLUDED.state,
                        manager_name = EXCLUDED.manager_name,
                        district = EXCLUDED.district
                """), {"u": user_id, "r": role, "s": state, "m": manager, "d": district})
        return jsonify({"success": True, "message": f"User '{user_id}' saved successfully."})
    except Exception as e:
        app.logger.exception("❌ Error in create_or_update_user:")
        return jsonify({"success": False, "message": str(e)}), 500


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


# -------------------------------
@app.route("/get_data/<view_type>")
def get_data(view_type):
    if "user" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    try:
        engine = get_engine()
        
        # 1. Define allowed tables and their specific column names for filtering
        #    Format: 'table_name': {'session_key': 'database_column_name'}
        #    Update the values on the right side to match your actual Database Columns
        table_config = {
            "product": {
                "manager": "manager_name", 
                "state": "state", 
                "district": "district"
            },
            "sku": {
                "manager": "manager_name", 
                "state": "state", 
                "district": "district"
            },
            "lighthouse_sales": {
                "manager": "manager_name", 
                "state": "state", 
                "district": "district"
            },
            "stock_data": {
                # CHECK YOUR DB: Is it 'manager_name' or just 'manager'? 
                # Is it 'state' or 'zone'?
                "manager": "manager_name", 
                "state": "state", 
                "district": "district" 
            },
            "daily_sale": {
                # CHECK YOUR DB: daily_sale might use 'sales_officer' instead of 'manager_name'
                "manager": "manager_name", 
                "state": "state", 
                "district": "district"
            }
        }

        if view_type not in table_config:
            return jsonify({"error": "Invalid table name"}), 400

        # Get column mapping for the current view
        col_map = table_config[view_type]
        
        base_query = f"SELECT * FROM {view_type}"
        params = {}

        # 2. Apply Dynamic Filters based on the Mapping
        if session.get("role") != "Admin":
            conditions = []
            
            # Filter by Manager
            if session.get("manager_name"):
                # Uses the specific column name defined in table_config
                db_col = col_map.get("manager", "manager_name") 
                conditions.append(f"{db_col} = :m")
                params["m"] = session["manager_name"]
            
            # Filter by State
            if session.get("state"):
                db_col = col_map.get("state", "state")
                conditions.append(f"{db_col} = :s")
                params["s"] = session["state"]
            
            # Filter by District
            if session.get("district"):
                db_col = col_map.get("district", "district")
                conditions.append(f"{db_col} = :d")
                params["d"] = session["district"]

            if conditions:
                base_query += " WHERE " + " AND ".join(conditions)

        # Debugging: Print query to console to verify logic
        app.logger.info(f"Executing Query: {base_query} | Params: {params}")

        df = pd.read_sql(text(base_query), con=engine, params=params).fillna(0)
        
        # Clean up column names
        df.columns = [c.strip().lower() for c in df.columns]
        
        for col in df.columns:
            if pd.api.types.is_numeric_dtype(df[col]):
                df[col] = df[col].astype(float).round(0)
                
        return jsonify(df.to_dict(orient="records"))

    except Exception as e:
        if "lighthouse_sales" in view_type:
            return jsonify({"error": "Lighthouse data missing in database."}), 404
        app.logger.exception(f"Error loading data for {view_type}")
        return jsonify({"error": str(e)}), 500

# -------------------------------
# STOCK DATABASE API (NEW)
# -------------------------------
@app.route("/api/get_stock_data")
def get_stock_data_api():
    engine = get_engine()
    df = pd.read_sql("SELECT * FROM stock_data", engine)

    # Clean column names
    df.columns = [c.strip().lower() for c in df.columns]

    # Convert NaN to 0
    df = df.fillna(0)

    # Convert all numeric columns to proper float/int
    for col in ["opening", "qty_recd", "qty_sale", "closing"]:
        if col in df.columns:
            df[col] = df[col].astype(float)

    return jsonify(df.to_dict(orient="records"))


# -------------------------------
# DAILY SALE DATABASE API (NEW)
# -------------------------------
@app.route("/api/get_daily_sale")
def get_daily_sale_api():
    engine = get_engine()
    df = pd.read_sql("SELECT * FROM daily_sale", engine)

    df.columns = [c.strip().lower() for c in df.columns]

    # Replace NaN
    df = df.fillna(0)

    # Make sure quantity is numeric
    if "quantity" in df.columns:
        df["quantity"] = df["quantity"].astype(float)

    return jsonify(df.to_dict(orient="records"))


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
    try:
        ensure_users_table()
    except Exception as e:
        print("⚠️ User table init failed:", e)
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Starting Flask on port {port}")
    app.run(host="0.0.0.0", port=port, debug=True)
