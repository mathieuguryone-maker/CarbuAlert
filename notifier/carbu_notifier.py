"""
CarbuAlert - Notifier Windows
Verifie les prix des carburants et envoie des notifications toast.
"""

import json
import os
import sys
import requests
from plyer import notification

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
PRICES_FILE = os.path.join(SCRIPT_DIR, "last_prices.json")
ICON_FILE = os.path.join(SCRIPT_DIR, "..", "icons", "icon128.png")

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


def check_prices():
    config = load_json(CONFIG_FILE)
    if not config:
        print("Erreur: config.json introuvable ou invalide")
        sys.exit(1)

    station_ids = config.get("stationIds", [])
    if not station_ids:
        print("Aucune station configuree")
        return

    names = config.get("stationNames", {})
    ref_id = config.get("referenceStationId")
    ref_id_str = str(ref_id) if ref_id else None

    # Fetch
    try:
        stations = fetch_stations(station_ids)
    except Exception as e:
        print(f"Erreur API: {e}")
        return

    # Load old prices
    old_prices = load_json(PRICES_FILE, {})

    # Build new prices
    new_prices = {}
    for station in stations:
        sid = str(station.get("id", ""))
        prices = {}
        for key in FUEL_KEYS:
            prix_key = f"{key}_prix"
            if station.get(prix_key) is not None:
                prices[prix_key] = station[prix_key]
        new_prices[sid] = prices

    # Detect changes
    changes = []
    ref_prices = new_prices.get(ref_id_str, {}) if ref_id_str else {}

    for station in stations:
        sid = str(station.get("id", ""))
        station_name = names.get(sid) or station.get("adresse") or station.get("ville") or sid

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

                changes.append({
                    "station": station_name,
                    "fuel": FUEL_TYPES[key],
                    "direction": direction,
                    "arrow": arrow,
                    "old": old_r,
                    "new": new_r,
                    "beats_ref": beats_ref,
                    "ref_price": round_price(ref_price) if ref_price else None,
                })

    # Save new prices
    save_json(PRICES_FILE, new_prices)

    if not changes:
        print("Aucun changement de prix detecte")
        return

    # Send notifications
    regular = [c for c in changes if not c["beats_ref"]]
    beats = [c for c in changes if c["beats_ref"]]

    icon_path = ICON_FILE if os.path.exists(ICON_FILE) else None

    if regular:
        lines = []
        for c in regular[:5]:
            lines.append(f"{c['arrow']} {c['fuel']}: {c['old']:.3f} -> {c['new']:.3f} ({c['station']})")
        if len(regular) > 5:
            lines.append(f"... et {len(regular) - 5} autre(s)")
        msg = "\n".join(lines)
        print(f"Notification: {msg}")
        notification.notify(
            title="Carbu Alert - Changement de prix",
            message=msg,
            app_name="CarbuAlert",
            app_icon=icon_path,
            timeout=10,
        )

    if beats:
        lines = []
        for c in beats[:5]:
            lines.append(
                f"\u2193 {c['fuel']}: {c['new']:.3f} < ref {c['ref_price']:.3f} ({c['station']})"
            )
        if len(beats) > 5:
            lines.append(f"... et {len(beats) - 5} autre(s)")
        msg = "\n".join(lines)
        print(f"ALERTE: {msg}")
        notification.notify(
            title="CarbuAlert - Moins cher que votre ref !",
            message=msg,
            app_name="CarbuAlert",
            app_icon=icon_path,
            timeout=30,
        )


if __name__ == "__main__":
    check_prices()
