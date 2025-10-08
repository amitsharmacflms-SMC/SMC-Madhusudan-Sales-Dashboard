import os
import pandas as pd
import time
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, session, abort
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

# -----------------------------------------------------------------------------
# Flask setup
# -----------------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = "supersecretkey"

# -----------------------------------------------------------------------------
# PostgreSQL Configuration (Render)
# -----------------------------------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://dashboard_db_h0q1_user:RegcquXmPWdEXRFUxNSysH3FsMuQ5ozg@dpg-d3ilg7be5dus7398abg0-a.singapore-postgres.render.com/dashboard_db_h0q1"
)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# -----------------------------------------------------------------------------
# Database Models
# -----------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))

    def set_password(self, pwd):
        self.password_hash = generate_password_hash(pwd)

    def check_password(self, pwd):
        return check_password_hash(self.password_hash, pwd)


class Product(db.Model):
    __tablename__ = "product"
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))
    party_name = db.Column(db.String(200))
    product = db.Column(db.String(200))
    order_date = db.Column(db.Date)


class SKU(db.Model):
    __tablename__ = "sku"
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))
    party_name = db.Column(db.String(200))
    product = db.Column(db.String(200))
    sku = db.Column(db.String(200))
    order_date = db.Column(db.Date)

# -----------------------------------------------------------------------------
# Initialize database and create admin
# -----------------------------------------------------------------------------
def initialize_database():
    for attempt in range(10):
        try:
            db.create_all()
            print("✅ Tables created or already exist.")

            if not User.query.filter_by(user_id="admin").first():
                admin = User(user_id="admin", role="Admin", state="HQ", manager_name="Amit", district="Central")
                admin.set_password("admin123")
                db.session.add(admin)
                db.session.commit()
                print("✅ Default admin created (admin / admin123)")
            break
        except Exception as e:
            print(f"⏳ Database not ready (attempt {attempt+1}/10). Retrying in 5s...")
            print(e)
            time.sleep(5)

# -----------------------------------------------------------------------------
# Data enrichment
# -----------------------------------------------------------------------------
def enrich_df(df):
    if df is None or df.empty:
        return df
    df = df.copy()
    if "order_date" in df.columns:
        df["ORDER_DATE"] = pd.to_datetime(df["order_date"], errors="coerce")
    elif "ORDER_DATE" in df.columns:
        df["ORDER_DATE"] = pd.to_datetime(df["ORDER_DATE"], errors="coerce")
    else:
        return df

    df["Month"] = df["ORDER_DATE"].dt.strftime("%b-%Y")
    df["Quarter"] = df["ORDER_DATE"].apply(
        lambda d: f"Q{((d.month - 1)//3) + 1} {d.year}" if pd.notna(d) else None
    )
    df["Year"] = df["ORDER_DATE"].dt.year
    return df

# -----------------------------------------------------------------------------
# Comparison logic
# -----------------------------------------------------------------------------
def compare_two_periods(df, date1, date2):
    """Compare two selected months or dates and compute difference column."""
    if df.empty:
        return df

    df["ORDER_DATE"] = pd.to_datetime(df["ORDER_DATE"], errors="coerce")
    df["Month"] = df["ORDER_DATE"].dt.strftime("%b-%Y")

    d1 = df[df["Month"] == date1]
    d2 = df[df["Month"] == date2]

    if d1.empty or d2.empty:
        return pd.DataFrame()

    key_cols = [c for c in df.columns if c not in ["ORDER_DATE", "Month", "Quarter", "Year", "id"]]

    # Aggregate counts per key (you can later replace with VALUE if added)
    g1 = d1.groupby(key_cols).size().reset_index(name=f"Count_{date1}")
    g2 = d2.groupby(key_cols).size().reset_index(name=f"Count_{date2}")

    merged = pd.merge(g1, g2, on=key_cols, how="outer").fillna(0)
    merged["Comparison"] = merged[f"Count_{date2}"] - merged[f"Count_{date1}"]

    return merged

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/")
def home():
    return render_template("login.html", datetime=datetime)

@app.route("/login", methods=["POST"])
def login():
    u = User.query.filter_by(user_id=request.form["user_id"]).first()
    if u and u.check_password(request.form["password"]):
        session["user_id"] = u.user_id
        session["role"] = u.role
        return redirect(url_for("dashboard"))
    flash("Invalid credentials", "danger")
    return redirect(url_for("home"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))

@app.route("/dashboard")
def dashboard():
    if "user_id" not in session:
        return redirect(url_for("home"))

    from sqlalchemy import select

    with db.engine.connect() as connection:
        p_df = pd.read_sql("SELECT * FROM product", connection)
        s_df = pd.read_sql("select * FROM SKU", connection)

    p_df = enrich_df(p_df)
    s_df = enrich_df(s_df)

    # Get available months for dropdown
    months = sorted(p_df["Month"].dropna().unique())

    # Handle comparison
    date1 = request.args.get("date1")
    date2 = request.args.get("date2")
    tab = request.args.get("tab", "Product")

    comparison_df = None
    if date1 and date2:
        base_df = p_df if tab == "Product" else s_df
        comparison_df = compare_two_periods(base_df, date1, date2)

    return render_template(
        "dashboard.html",
        role=session.get("role"),
        active_tab=tab,
        months=months,
        comparison_data=comparison_df.to_dict("records") if comparison_df is not None else [],
    )

@app.route("/admin")
def admin_panel():
    if session.get("role") != "Admin":
        abort(403)
    users = User.query.order_by(User.user_id).all()
    return render_template("admin.html", users=users)

# -----------------------------------------------------------------------------
# Init DB
# -----------------------------------------------------------------------------
with app.app_context():
    try:
        initialize_database()
    except Exception as e:
        print(f"⚠️ Database initialization skipped or failed: {e}")

# -----------------------------------------------------------------------------
# App Runner
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
