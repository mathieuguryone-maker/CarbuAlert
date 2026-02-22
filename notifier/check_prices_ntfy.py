"""
CarbuAlert - Price checker with ntfy.sh notifications.
Designed to run in GitHub Actions on a cron schedule.
"""

import json
import os
import sys
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
PRICES_FILE = os.path.join(SCRIPT_DIR, "last_prices.json")

API_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/records"
)

FUEL_TYPES = {
    "gazole": "Gazole",
    "sp95": "SP95",
    "sp98": "SP98",
    "e10": "E10",
    "e85": "E85",
    "gplc": "GPLc",
}

FUEL_KEYS = list(FUEL_TYPES.keys())

NTFY_URL = "https://ntfy.sh"


def load_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fetch_stations(ids):
    """Fetch stations from the API, batching by 20."""
    all_stations = []
    batch_size = 20
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        id_list = ",".join(str(x) for x in batch)
        params = {"where": f"id in ({id_list})", "limit": str(len(batch))}
        resp = requests.get(API_URL, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        all_stations.extend(data.get("results", []))
    return all_stations


def round_price(price):
    return round(price * 1000) / 1000


def send_ntfy(topic, title, message, priority="3", tags="fuelpump"):
    """Send a notification via ntfy.sh."""
    resp = requests.post(
        f"{NTFY_URL}/{topic}",
        data=message.encode("utf-8"),
        headers={
            "Title": title,
            "Priority": priority,
            "Tags": tags,
        },
        timeout=10,
    )
    resp.raise_for_status()
    print(f"  -> ntfy sent (priority {priority})")


def check_prices():
    # Get ntfy topic from env (GitHub secret)
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("Error: NTFY_TOPIC environment variable not set")
        sys.exit(1)

    config = load_json(CONFIG_FILE)
    if not config:
        print("Error: config.json not found or invalid")
        sys.exit(1)

    station_ids = config.get("stationIds", [])
    if not station_ids:
        print("No stations configured")
        return

    names = config.get("stationNames", {})
    ref_id = config.get("referenceStationId")
    ref_id_str = str(ref_id) if ref_id else None

    # Fetch current prices
    try:
        stations = fetch_stations(station_ids)
    except Exception as e:
        print(f"API error: {e}")
        return

    # Load previous prices
    old_prices = load_json(PRICES_FILE, {})

    # Build new prices map
    new_prices = {}
    for station in stations:
        sid = str(station.get("id", ""))
        prices = {}
        for key in FUEL_KEYS:
            prix_key = f"{key}_prix"
            if station.get(prix_key) is not None:
                prices[prix_key] = station[prix_key]
        new_prices[sid] = prices

    # Detect price changes
    changes = []
    ref_prices = new_prices.get(ref_id_str, {}) if ref_id_str else {}

    for station in stations:
        sid = str(station.get("id", ""))
        station_name = (
            names.get(sid)
            or station.get("adresse")
            or station.get("ville")
            or sid
        )

        if sid not in old_prices:
            continue

        for key in FUEL_KEYS:
            prix_key = f"{key}_prix"
            old_val = old_prices[sid].get(prix_key)
            new_val = new_prices.get(sid, {}).get(prix_key)

            if old_val is None or new_val is None:
                continue

            old_r = round_price(old_val)
            new_r = round_price(new_val)

            if old_r != new_r:
                direction = "hausse" if new_r > old_r else "baisse"
                arrow = "\u2191" if new_r > old_r else "\u2193"

                beats_ref = False
                ref_price = None
                if ref_id_str and sid != ref_id_str:
                    ref_price = ref_prices.get(prix_key)
                    if ref_price is not None and new_r < round_price(ref_price):
                        beats_ref = True

                changes.append(
                    {
                        "station": station_name,
                        "fuel": FUEL_TYPES[key],
                        "direction": direction,
                        "arrow": arrow,
                        "old": old_r,
                        "new": new_r,
                        "beats_ref": beats_ref,
                        "ref_price": round_price(ref_price) if ref_price else None,
                    }
                )

    # Save new prices
    save_json(PRICES_FILE, new_prices)

    if not changes:
        print("No price changes detected")
        return

    # Split into regular changes and ref-beating changes
    regular = [c for c in changes if not c["beats_ref"]]
    beats = [c for c in changes if c["beats_ref"]]

    # Send regular price change notification
    if regular:
        lines = []
        for c in regular[:5]:
            lines.append(
                f"{c['arrow']} {c['fuel']}: {c['old']:.3f} \u2192 {c['new']:.3f} ({c['station']})"
            )
        if len(regular) > 5:
            lines.append(f"... et {len(regular) - 5} autre(s)")
        msg = "\n".join(lines)
        print(f"Regular notification: {msg}")
        send_ntfy(
            topic,
            title="CarbuAlert - Changement de prix",
            message=msg,
            priority="3",
            tags="fuelpump",
        )

    # Send ref-beating alert (higher priority)
    if beats:
        lines = []
        for c in beats[:5]:
            lines.append(
                f"\u2193 {c['fuel']}: {c['new']:.3f} < ref {c['ref_price']:.3f} ({c['station']})"
            )
        if len(beats) > 5:
            lines.append(f"... et {len(beats) - 5} autre(s)")
        msg = "\n".join(lines)
        print(f"REF ALERT: {msg}")
        send_ntfy(
            topic,
            title="CarbuAlert - Moins cher que votre ref !",
            message=msg,
            priority="5",
            tags="warning,fuelpump",
        )


if __name__ == "__main__":
    check_prices()
