import os
import pandas as pd
import time
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, session, abort, send_file
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from io import StringIO

# ---------------------------------------------------------------------
# Flask setup
# ---------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET", "supersecretkey")

# ---------------------------------------------------------------------
# Database config (Render example). Replace DATABASE_URL in env if needed
# ---------------------------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://dashboard_db_h0q1_user:RegcquXmPWdEXRFUxNSysH3FsMuQ5ozg@dpg-d3ilg7be5dus7398abg0-a.singapore-postgres.render.com/dashboard_db_h0q1"
)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# ---------------------------------------------------------------------
# DB models
# ---------------------------------------------------------------------
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
    STATE = db.Column(db.String(100))
    MANAGER_NAME = db.Column(db.String(150))
    DISTRICT = db.Column(db.String(150))
    PARTY_NAME = db.Column(db.String(200))
    PRODUCT = db.Column(db.String(200))
    ORDER_DATE = db.Column(db.Date)
    VALUE = db.Column(db.Float)


class SKU(db.Model):
    __tablename__ = "sku"
    id = db.Column(db.Integer, primary_key=True)
    STATE = db.Column(db.String(100))
    MANAGER_NAME = db.Column(db.String(150))
    DISTRICT = db.Column(db.String(150))
    PARTY_NAME = db.Column(db.String(200))
    PRODUCT = db.Column(db.String(200))
    SKU = db.Column(db.String(200))
    ORDER_DATE = db.Column(db.Date)
    VALUE = db.Column(db.Float)


# ---------------------------------------------------------------------
# initialize DB / import CSVs if present
# ---------------------------------------------------------------------
def initialize_database():
    for attempt in range(6):
        try:
            db.create_all()
            # create default admin
            if not User.query.filter_by(user_id="admin").first():
                admin = User(user_id="admin", role="Admin", state="HQ", manager_name="Amit", district="Central")
                admin.set_password("admin123")
                db.session.add(admin)
                db.session.commit()
                print("Default admin created")
            # import CSVs if present and tables empty
            def parse_date_safe(v):
                try:
                    return pd.to_datetime(v).date()
                except Exception:
                    return None

            product_csv = "data/product.csv"
            sku_csv = "data/sku.csv"

            if os.path.exists(product_csv) and Product.query.count() == 0:
                df = pd.read_csv(product_csv)
                for _, r in df.iterrows():
                    db.session.add(Product(
                        STATE=r.get("STATE"),
                        MANAGER_NAME=r.get("MANAGER_NAME"),
                        DISTRICT=r.get("DISTRICT"),
                        PARTY_NAME=r.get("PARTY_NAME"),
                        PRODUCT=r.get("PRODUCT"),
                        ORDER_DATE=parse_date_safe(r.get("ORDER_DATE")),
                        VALUE=float(r.get("VALUE")) if "VALUE" in r and pd.notna(r.get("VALUE")) else None
                    ))
                db.session.commit()
                print("Imported product.csv")

            if os.path.exists(sku_csv) and SKU.query.count() == 0:
                df = pd.read_csv(sku_csv)
                for _, r in df.iterrows():
                    db.session.add(SKU(
                        STATE=r.get("STATE"),
                        MANAGER_NAME=r.get("MANAGER_NAME"),
                        DISTRICT=r.get("DISTRICT"),
                        PARTY_NAME=r.get("PARTY_NAME"),
                        PRODUCT=r.get("PRODUCT"),
                        SKU=r.get("SKU"),
                        ORDER_DATE=parse_date_safe(r.get("ORDER_DATE")),
                        VALUE=float(r.get("VALUE")) if "VALUE" in r and pd.notna(r.get("VALUE")) else None
                    ))
                db.session.commit()
                print("Imported sku.csv")

            break
        except Exception as e:
            print("DB not ready, retrying...", e)
            time.sleep(3)


with app.app_context():
    initialize_database()


# ---------------------------------------------------------------------
# helpers: formats and aggregations
# ---------------------------------------------------------------------
def enrich_df(df):
    """Ensure ORDER_DATE is datetime and add 'Month', 'Quarter', 'Year' columns."""
    if df is None or df.empty:
        return df
    df = df.copy()
    # normalize column casing if needed
    # we expect columns: STATE, MANAGER_NAME, DISTRICT, PARTY_NAME, PRODUCT, SKU (maybe), ORDER_DATE, VALUE
    if "ORDER_DATE" in df.columns:
        df["ORDER_DATE"] = pd.to_datetime(df["ORDER_DATE"], errors="coerce")
    else:
        # try common alternatives
        for alt in ["order_date", "OrderDate", "Order_Date", "ORDERDATE"]:
            if alt in df.columns:
                df["ORDER_DATE"] = pd.to_datetime(df[alt], errors="coerce")
                break
    # Month format e.g. Jul-2025
    df["Month"] = df["ORDER_DATE"].dt.strftime("%b-%Y")
    # Quarter format e.g. Q1 2025
    df["Quarter"] = df["ORDER_DATE"].dt.to_period("Q").astype(str).apply(
        lambda s: (lambda yq: f"Q{int(yq[1])} {yq[0]}")((s.split("Q")[0], s.split("Q")[1])) if pd.notna(s) else None
    )
    df["Year"] = df["ORDER_DATE"].dt.year
    return df


def compute_group_avgs(df, key_cols):
    """Compute quarter and year averages by group (key_cols). Returns two DataFrames."""
    if df is None or df.empty:
        return pd.DataFrame(), pd.DataFrame()
    # Quarter avg
    qavg = (
        df.dropna(subset=["Quarter", "VALUE"])
          .groupby(key_cols + ["Quarter"], dropna=True)["VALUE"]
          .mean()
          .reset_index(name="Quarter_Avg")
    )
    yavg = (
        df.dropna(subset=["Year", "VALUE"])
          .groupby(key_cols + ["Year"], dropna=True)["VALUE"]
          .mean()
          .reset_index(name="Year_Avg")
    )
    return qavg, yavg


def prev_quarter_label(qlabel):
    """Given label 'Q2 2025' returns previous quarter string 'Q1 2025' etc."""
    try:
        parts = qlabel.split()
        qnum = int(parts[0].lstrip("Q"))
        year = int(parts[1])
    except Exception:
        return None
    if qnum > 1:
        return f"Q{qnum-1} {year}"
    else:
        return f"Q4 {year-1}"


# ---------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------
@app.route("/")
def home():
    # always show login page first
    return render_template("login.html", current_year=datetime.utcnow().year)


@app.route("/login", methods=["POST"])
def login():
    user = User.query.filter_by(user_id=request.form.get("user_id")).first()
    if user and user.check_password(request.form.get("password")):
        session["user_id"] = user.user_id
        session["role"] = user.role
        flash(f"Welcome {user.user_id}", "success")
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

    # load both tables into pandas
    try:
        p_df = pd.read_sql_table("product", con=db.engine)
    except Exception:
        p_df = pd.DataFrame()

    try:
        s_df = pd.read_sql_table("sku", con=db.engine)
    except Exception:
        s_df = pd.DataFrame()

    p_df = enrich_df(p_df) if not p_df.empty else pd.DataFrame()
    s_df = enrich_df(s_df) if not s_df.empty else pd.DataFrame()

    # unify columns and show both product & sku in tabbed UI
    # For filters: gather Month + Quarter values from both tables
    months = set()
    quarters = set()
    for df in (p_df, s_df):
        if df is None or df.empty:
            continue
        months.update([m for m in df["Month"].dropna().unique()])
        quarters.update([q for q in df["Quarter"].dropna().unique()])

    # Build filter list: prefix with "M:" for months, "Q:" for quarters so selection is unambiguous
    filter_options = []
    # sort months by date (attempt parse)
    try:
        month_sorted = sorted([m for m in months if m], key=lambda x: datetime.strptime(x, "%b-%Y"))
    except Exception:
        month_sorted = sorted([m for m in months if m])
    for m in month_sorted:
        filter_options.append(("M:" + m, m))
    # sort quarters by year/quarter
    def quarter_sort_key(q):
        try:
            qnum, yr = q.split()
            return (int(yr), int(qnum.lstrip("Q")))
        except Exception:
            return (9999, 9)
    quarter_sorted = sorted([q for q in quarters if q], key=quarter_sort_key)
    for q in quarter_sorted:
        filter_options.append(("Q:" + q, q))

    # get selected filter from querystring
    selected = request.args.get("date_filter", None)  # e.g. "M:Jul-2025" or "Q:Q2 2025"
    active_tab = request.args.get("tab", "product")  # "product" or "sku"

    # prepare outputs
    display_rows = pd.DataFrame()
    qavg_merge = pd.DataFrame()
    yavg_merge = pd.DataFrame()

    # Choose DF to display based on tab
    df = p_df if active_tab == "product" else s_df

    # key columns for grouping (both product and sku) - preserve ordering
    key_cols = ["STATE", "MANAGER_NAME", "DISTRICT", "PARTY_NAME", "PRODUCT"]
    if "SKU" in df.columns:
        key_cols = key_cols + ["SKU"]

    # compute group averages across the whole DF (quarter & year)
    qavg_df, yavg_df = compute_group_avgs(df, key_cols)

    # If a filter is selected, filter rows accordingly
    if selected:
        if selected.startswith("M:"):
            sel = selected[2:]
            filtered = df[df["Month"] == sel].copy()
            # also determine quarter for this month (most rows will have same quarter)
            sel_quarters = filtered["Quarter"].dropna().unique()
            sel_quarter = sel_quarters[0] if len(sel_quarters) > 0 else None
        elif selected.startswith("Q:"):
            sel_quarter = selected[2:]
            filtered = df[df["Quarter"] == sel_quarter].copy()
        else:
            filtered = df.copy()
            sel_quarter = None
    else:
        # default: show latest month if exists, otherwise latest quarter, otherwise all
        if month_sorted:
            latest_month = month_sorted[-1]
            selected = "M:" + latest_month
            filtered = df[df["Month"] == latest_month].copy()
            sel_quarter = filtered["Quarter"].dropna().unique()[0] if not filtered.empty else None
        elif quarter_sorted:
            latest_q = quarter_sorted[-1]
            selected = "Q:" + latest_q
            filtered = df[df["Quarter"] == latest_q].copy()
            sel_quarter = latest_q
        else:
            filtered = df.copy()
            sel_quarter = None

    # Merge quarter & year averages into filtered rows by group + quarter/year
    if not filtered.empty:
        # attach Quarter_Avg for selected quarter using key columns + Quarter
        if sel_quarter is not None and not qavg_df.empty:
            # create key for merge
            merge_cols_q = key_cols + ["Quarter"]
            filtered = filtered.merge(
                qavg_df[qavg_df["Quarter"] == sel_quarter],
                how="left",
                on=merge_cols_q
            )
            # Quarter_Avg column now present
        else:
            # If no selected quarter, don't attach Quarter_Avg (fill with NaN)
            filtered["Quarter_Avg"] = pd.NA

        # attach Year_Avg for the year of the selected rows
        # If filtered has Year values:
        if "Year" in filtered.columns and not yavg_df.empty:
            merge_cols_y = key_cols + ["Year"]
            filtered = filtered.merge(
                yavg_df,
                how="left",
                on=merge_cols_y
            )
        else:
            filtered["Year_Avg"] = pd.NA

        # Comparison: Quarter_Avg for sel_quarter minus previous quarter avg
        if sel_quarter and not qavg_df.empty:
            prev_q = prev_quarter_label(sel_quarter)
            if prev_q:
                prev_q_df = qavg_df[qavg_df["Quarter"] == prev_q][key_cols + ["Quarter_Avg"]]
                prev_q_df = prev_q_df.rename(columns={"Quarter_Avg": "Prev_Quarter_Avg"})
                filtered = filtered.merge(prev_q_df, how="left", on=key_cols)
                # compute comparison
                filtered["COMPARISON"] = filtered["Quarter_Avg"] - filtered.get("Prev_Quarter_Avg")
            else:
                filtered["Prev_Quarter_Avg"] = pd.NA
                filtered["COMPARISON"] = pd.NA
        else:
            filtered["Prev_Quarter_Avg"] = pd.NA
            filtered["COMPARISON"] = pd.NA

    # Prepare display_rows as list of dicts for Jinja
    if not filtered.empty:
        # keep columns in original order plus our added summary columns
        add_cols = ["Month", "Quarter", "Year", "Quarter_Avg", "Prev_Quarter_Avg", "COMPARISON", "Year_Avg"]
        cols = [c for c in df.columns] + [c for c in add_cols if c not in df.columns]
        # ensure we only include cols that actually exist
        cols = [c for c in cols if c in filtered.columns]
        display_rows = filtered[cols].fillna("").to_dict(orient="records")
    else:
        display_rows = []

    return render_template(
        "dashboard.html",
        role=session.get("role"),
        product_count=len(p_df) if p_df is not None else 0,
        sku_count=len(s_df) if s_df is not None else 0,
        filter_options=filter_options,
        selected=selected,
        display_rows=display_rows,
        active_tab=active_tab,
        current_year=datetime.utcnow().year
    )


@app.route("/export_csv")
def export_csv():
    if "user_id" not in session:
        abort(403)
    tab = request.args.get("tab", "product")
    date_filter = request.args.get("date_filter")
    df = pd.read_sql_table("product", con=db.engine) if tab == "product" else pd.read_sql_table("sku", con=db.engine)
    df = enrich_df(df)
    if date_filter:
        if date_filter.startswith("M:"):
            sel = date_filter[2:]
            df = df[df["Month"] == sel]
        elif date_filter.startswith("Q:"):
            sel = date_filter[2:]
            df = df[df["Quarter"] == sel]
    # convert to CSV in memory and send
    csv_buffer = StringIO()
    df.to_csv(csv_buffer, index=False)
    csv_buffer.seek(0)
    return send_file(
        StringIO(csv_buffer.getvalue()),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"{tab}_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    )


# ------------------------
# Admin routes (kept minimal)
# ------------------------
@app.route("/admin")
def admin_panel():
    if session.get("role") != "Admin":
        abort(403)
    users = User.query.order_by(User.user_id).all()
    return render_template("admin.html", users=users)


@app.route("/admin/create", methods=["POST"])
def admin_create_user():
    if session.get("role") != "Admin":
        abort(403)
    uid = request.form["user_id"].strip()
    pwd = request.form["password"].strip()
    role = request.form.get("role", "User")
    if not uid or not pwd:
        flash("User ID and Password required!", "danger")
        return redirect(url_for("admin_panel"))
    if User.query.filter_by(user_id=uid).first():
        flash("User exists", "danger")
        return redirect(url_for("admin_panel"))
    u = User(user_id=uid, role=role)
    u.set_password(pwd)
    db.session.add(u)
    db.session.commit()
    flash("User created", "success")
    return redirect(url_for("admin_panel"))


# ---------------------------------------------------------------------
# run
# ---------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
