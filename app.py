import os
import time
import pandas as pd
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, session, abort, send_file
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import select

# -----------------------------------------------------------------------------
# Flask Setup
# -----------------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = "supersecretkey"

# -----------------------------------------------------------------------------
# PostgreSQL Configuration
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
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))
    party_name = db.Column(db.String(200))
    product = db.Column(db.String(200))
    order_date = db.Column(db.Date)
    value = db.Column(db.Float)


class SKU(db.Model):
    __tablename__ = "sku"
    id = db.Column(db.Integer, primary_key=True)
    state = db.Column(db.String(100))
    manager_name = db.Column(db.String(150))
    district = db.Column(db.String(150))
    party_name = db.Column(db.String(200))
    product = db.Column(db.String(200))
    sku = db.Column(db.String(200))
    order_date = db.Column(db.Date)
    value = db.Column(db.Float)

# -----------------------------------------------------------------------------
# Initialize DB
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

            print("✅ Database initialized successfully.")
            break
        except Exception as e:
            print(f"⏳ Database not ready (attempt {attempt+1}/10): {e}")
            time.sleep(5)

# -----------------------------------------------------------------------------
# Analytics Helpers
# -----------------------------------------------------------------------------
def build_summary_table(df):
    if df.empty:
        return pd.DataFrame()
    df["order_date"] = pd.to_datetime(df["order_date"])
    df["Quarter"] = df["order_date"].dt.to_period("Q").astype(str)
    df["Month"] = df["order_date"].dt.strftime("%b-%y")
    df["Year"] = df["order_date"].dt.year

    group_cols = ["state", "manager_name", "district", "product"]
    summary = []
    for (state, manager, district, product), g in df.groupby(group_cols):
        q_avg = g.groupby("Quarter")["value"].mean().to_dict()
        quarters = sorted(q_avg.keys())
        comp = None
        q1 = q2 = None
        if len(quarters) >= 2:
            q1, q2 = quarters[-2], quarters[-1]
            comp = q_avg[q2] - q_avg[q1]
        summary.append({
            "STATE": state,
            "MANAGER NAME": manager,
            "DISTRICT": district,
            "PRODUCT": product,
            "AVG Q1": q_avg.get(q1),
            "AVG Q2": q_avg.get(q2),
            "COMPARISON": comp
        })
    return pd.DataFrame(summary)

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/")
def home():
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login():
    u = User.query.filter_by(user_id=request.form["user_id"]).first()
    if u and u.check_password(request.form["password"]):
        session["user_id"] = u.user_id
        session["role"] = u.role
        flash(f"Welcome, {u.user_id}!", "success")
        return redirect(url_for("dashboard"))
    flash("Invalid credentials", "danger")
    return redirect(url_for("home"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))


@app.route("/dashboard", methods=["GET"])
def dashboard():
    if "user_id" not in session:
        return redirect(url_for("home"))

    with db.engine.connect() as connection:
        p_df = pd.read_sql(select(Product), connection)
        s_df = pd.read_sql(select(SKU), connection)

    selected_month = request.args.get("month", "")
    selected_year = request.args.get("year", "")
    tab = request.args.get("tab", "product")

    df = p_df if tab == "product" else s_df
    if not df.empty:
        df["order_date"] = pd.to_datetime(df["order_date"])
        if selected_month:
            df = df[df["order_date"].dt.strftime("%b-%y") == selected_month]
        if selected_year:
            df = df[df["order_date"].dt.year.astype(str) == selected_year]

    summary_df = build_summary_table(df)
    all_months = sorted(df["order_date"].dt.strftime("%b-%y").unique()) if not df.empty else []
    all_years = sorted(df["order_date"].dt.year.unique()) if not df.empty else []

    return render_template(
        "dashboard.html",
        summary=summary_df.to_dict("records"),
        months=all_months,
        years=all_years,
        selected_month=selected_month,
        selected_year=selected_year,
        active_tab=tab,
    )


@app.route("/export", methods=["GET"])
def export_data():
    tab = request.args.get("tab", "product")
    with db.engine.connect() as connection:
        df = pd.read_sql(select(Product if tab == "product" else SKU), connection)
    if df.empty:
        flash("No data available to export!", "warning")
        return redirect(url_for("dashboard", tab=tab))

    month = request.args.get("month", "")
    year = request.args.get("year", "")
    if not df.empty:
        df["order_date"] = pd.to_datetime(df["order_date"])
        if month:
            df = df[df["order_date"].dt.strftime("%b-%y") == month]
        if year:
            df = df[df["order_date"].dt.year.astype(str) == year]

    path = f"/tmp/{tab}_export.csv"
    df.to_csv(path, index=False)
    return send_file(path, as_attachment=True, download_name=f"{tab}_data.csv")


@app.route("/admin")
def admin_panel():
    if session.get("role") != "Admin":
        abort(403)
    users = User.query.order_by(User.user_id).all()
    return render_template("admin.html", users=users)

# -----------------------------------------------------------------------------
# Initialize Database
# -----------------------------------------------------------------------------
with app.app_context():
    try:
        initialize_database()
    except Exception as e:
        print(f"⚠️ Database init failed: {e}")

# -----------------------------------------------------------------------------
# Run
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
