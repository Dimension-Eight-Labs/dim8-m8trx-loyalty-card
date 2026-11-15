#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright © 2026 Dimension Eight Labs LLC
"""
Splits an oversized M8TRX backup (.m8trx) into smaller backups that M8TRX
can restore one at a time.

Why: M8TRX always exports a complete wallet, but one restore accepts at most
60 MiB of decoded images, 1000 cards and a 96 MiB file (see BACKUP_LIMITS in
src/features/backup/backupFormat.ts). This tool divides the cards between
several ordinary, independently valid backup files that each stay within all
of those limits. It never splits the JSON at byte offsets and never changes a
card: every card record is copied unchanged (ID, barcode value and format,
timestamps, notes, base64 image bytes), and only `order` and `cards` differ
between parts. `format`, `version`, `exportedAt` and `app` are copied from
the original.

Cards keep their wallet order: part 1 holds the first cards in the original
`order`, part 2 the next ones, and so on. Restoring the parts in numeric
order therefore rebuilds the original order after any existing cards.

Validation: the input is checked against the same rules as M8TRX's restore
parser (parseBackup in src/features/backup/backupFormat.ts and the card and
barcode rules it calls): format and version, `exportedAt` and `app` metadata,
unique IDs, an `order` naming every card once, store names, tile colours,
optional category icons, timestamps, generated-barcode formats and values (including EAN/UPC check
digits), field lengths, strict base64 whose decoded length matches
`byteLength`, and image signatures. Where the app's rule depends on the
browser (Date.parse) or the app accepts something it never writes (a backup
without `exportedAt`/`app`), this tool is deliberately stricter, so it can
refuse a hand-edited file but never write a part that M8TRX rejects. If any
card is invalid, or a single card can never fit a part (for example an image
over 4 MiB), the tool stops without writing anything. Every part is
re-validated before any file is written, existing files are never
overwritten, and if writing fails part-way the parts already written by this
run are removed.

Requirements: Python 3.9+ standard library only.

Usage:
    python3 scripts/split-m8trx-backup.py BACKUP.m8trx [--output-dir DIR]
        [--max-image-mib N] [--max-cards N]

Writes BACKUP-part-01-of-03.m8trx, ... into DIR (default: the input file's
directory). --max-image-mib and --max-cards can only make parts smaller
than the standard restore limits, never larger. --print-limits prints the
standard limits as JSON (used by the tests to keep this file in step with
the app).

Exit status: 0 on success, 1 for an invalid or unsplittable backup or an
output conflict, 2 for usage errors.
"""
import argparse
import base64
import binascii
import datetime
import json
import math
import os
import re
import sys

# ---- Standard restore limits -------------------------------------------------
# Must equal BACKUP_LIMITS in src/features/backup/backupFormat.ts;
# src/test/node/splitBackup.node.test.ts checks that they do.
MIB = 1024 * 1024
LIMITS = {
    "fileBytes": 96 * MIB,
    "cards": 1000,
    "imageBytes": 4 * MIB,
    "totalImageBytes": 60 * MIB,
    "idLength": 128,
    "notesLength": 10_000,
    "valueLength": 4096,
    "detectedLength": 4096,
    "timestampLength": 64,
}
STORE_NAME_LENGTH = 80
FORMAT_ID = "m8trx-backup"
FORMAT_VERSION = 1
CARD_SCHEMA_VERSION = 2
EXTENSION = ".m8trx"

# Image types M8TRX stores, with their file signatures (as in backupFormat.ts).
IMAGE_SIGNATURES = {
    "image/png": bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    "image/jpeg": bytes([0xFF, 0xD8, 0xFF]),
    "image/webp": b"RIFF",  # plus "WEBP" at offset 8
    "image/gif": b"GIF8",
}
# Patterns are always applied with fullmatch(): in Python, `$` also matches
# before a trailing newline, unlike JavaScript's `$`.
BASE64_RE = re.compile(r"[A-Za-z0-9+/]*={0,2}")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

# Tile colour palette ids (TILE_COLORS in src/features/cards/tileColors.ts).
TILE_COLOR_IDS = frozenset(
    ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "brown", "slate", "white"]
)

# Optional category icon ids (CARD_ICON_IDS in src/features/cards/cardIcons.ts,
# app 0.6.0). A card without "icon" means None; a present value must be one of
# these exact strings (null or any other value is rejected, as by the app).
CARD_ICON_IDS = frozenset(["fitness", "grocery", "fuel", "hardware", "food", "coffee", "retail", "events"])

# Characters JavaScript's String.prototype.trim() removes (WhiteSpace and
# LineTerminator in ECMAScript). Python's str.strip() uses a different set
# (it keeps U+FEFF and strips U+001C..U+001F and U+0085), so store names are
# trimmed with exactly this set to match validateStoreName in card.ts.
JS_TRIM_CHARS = (
    "\t\n\v\f\r          "
    "        　﻿"
)

# Generated-barcode rules (FORMAT_SPECS in src/features/barcodes/formats.ts):
# format -> (character pattern or None, maximum length) for free-form formats,
# or -> GS1 digit count for check-digit formats. Lengths are UTF-16 units.
_DIGITS_RE = re.compile(r"[0-9]+")
_ASCII_RE = re.compile(r"[\x00-\x7f]+")
_CODE39_RE = re.compile(r"[0-9A-Z \-.$/+%]+")
FREE_FORM_FORMATS = {
    "code128": (_ASCII_RE, 80),
    "code39": (_CODE39_RE, 60),
    "qrcode": (None, 1000),
    "pdf417": (None, 500),
    "datamatrix": (None, 500),
    "azteccode": (None, 500),
}
GS1_FORMATS = {"ean13": 13, "upca": 12, "ean8": 8}

# Timestamps: the app requires Date.parse() to succeed, which depends on the
# browser. This tool accepts only the ECMAScript Date Time String Format
# (what M8TRX writes via toISOString, e.g. 2026-11-14T18:00:00.000Z), with a
# real calendar date and time, which every conforming engine parses: a date
# (YYYY, YYYY-MM or YYYY-MM-DD), or a full date followed by THH:mm[:ss[.sss]]
# and an optional Z or +HH:mm / -HH:mm offset.
TIMESTAMP_RE = re.compile(
    r"(?P<year>[0-9]{4})(?:-(?P<month>[0-9]{2})(?:-(?P<day>[0-9]{2})"
    r"(?:T(?P<hour>[0-9]{2}):(?P<minute>[0-9]{2})(?::(?P<second>[0-9]{2})(?:\.[0-9]{3})?)?"
    r"(?:Z|[+-](?P<zh>[0-9]{2}):(?P<zm>[0-9]{2}))?)?)?)?"
)


class BackupError(Exception):
    """An invalid input, an unsplittable card, or an output problem."""


# ---- Validation (mirrors parseBackup in backupFormat.ts) ------------------------


def _reject_duplicate_keys(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise BackupError(f"duplicate JSON key {key!r}")
        obj[key] = value
    return obj


def _sniff(data):
    for mime, signature in IMAGE_SIGNATURES.items():
        if data.startswith(signature):
            if mime == "image/webp" and data[8:12] != b"WEBP":
                continue
            return mime
    return None


def _js_length(value):
    """Length in UTF-16 code units, as JavaScript's String.length counts it."""
    return len(value.encode("utf-16-le")) // 2


def _bounded(value, max_length):
    return isinstance(value, str) and _js_length(value) <= max_length


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _is_timestamp(value):
    """A timestamp parseBackup accepts on any engine (see TIMESTAMP_RE)."""
    if not _bounded(value, LIMITS["timestampLength"]):
        return False
    match = TIMESTAMP_RE.fullmatch(value)
    if match is None:
        return False
    fields = match.groupdict()
    try:
        datetime.date(int(fields["year"]), int(fields["month"] or 1), int(fields["day"] or 1))
    except ValueError:
        return False
    if fields["hour"] is not None:
        if int(fields["hour"]) > 23 or int(fields["minute"]) > 59 or int(fields["second"] or 0) > 59:
            return False
    if fields["zh"] is not None and (int(fields["zh"]) > 23 or int(fields["zm"]) > 59):
        return False
    return True


def _js_trim(value):
    return value.strip(JS_TRIM_CHARS)


def _gs1_check_digit(body):
    """GS1 mod-10 check digit (gs1CheckDigit in formats.ts); `body` excludes it."""
    total = 0
    for i, char in enumerate(reversed(body)):
        total += int(char) * (3 if i % 2 == 0 else 1)
    return (10 - total % 10) % 10


def _barcode_value_error(barcode_format, value):
    """Mirrors validateBarcodeValue in formats.ts; None when the value is acceptable."""
    if value == "":
        return "is empty"
    if barcode_format in GS1_FORMATS:
        digits = GS1_FORMATS[barcode_format]
        if not _DIGITS_RE.fullmatch(value) or len(value) != digits:
            return f"must be exactly {digits} digits"
        if int(value[-1]) != _gs1_check_digit(value[:-1]):
            return "has a wrong check digit"
        return None
    pattern, max_length = FREE_FORM_FORMATS[barcode_format]
    if pattern is not None and not pattern.fullmatch(value):
        return f"contains characters {barcode_format} cannot encode"
    if _js_length(value) > max_length:
        return f"is longer than {max_length} characters"
    return None


def validate_metadata(doc):
    """
    `exportedAt` and `app`, which every part copies from the original. M8TRX
    always writes both; its parser treats them as informational, but this
    tool requires them to be well formed so it never copies damaged metadata
    into the parts.
    """
    if not _is_timestamp(doc.get("exportedAt")):
        raise BackupError("backup has a missing or invalid exportedAt timestamp")
    app = doc.get("app")
    if not isinstance(app, dict):
        raise BackupError("backup has missing or invalid app metadata")
    for key in ("name", "version"):
        value = app.get(key)
        if not isinstance(value, str) or value == "" or CONTROL_RE.search(value):
            raise BackupError(f"backup has an invalid app.{key}")


def validate_card(card, index):
    """Checks one card record and returns its decoded image size (0 if none)."""
    where = f"card #{index + 1}"
    if not isinstance(card, dict):
        raise BackupError(f"{where} is not an object")
    schema_version = card.get("schemaVersion")
    if not isinstance(schema_version, (int, float)) or isinstance(schema_version, bool) or schema_version != CARD_SCHEMA_VERSION:
        raise BackupError(f"{where} has an unsupported schemaVersion")
    card_id = card.get("id")
    if not _bounded(card_id, LIMITS["idLength"]) or card_id == "" or CONTROL_RE.search(card_id):
        raise BackupError(f"{where} has an invalid or too-long id")
    where = f"card {card_id!r}"
    # validateStoreName: non-empty and at most 80 characters after JS trim().
    name = card.get("storeName")
    if not isinstance(name, str) or _js_trim(name) == "" or _js_length(_js_trim(name)) > STORE_NAME_LENGTH:
        raise BackupError(f"{where} has an invalid storeName")
    color = card.get("color")
    if not isinstance(color, str) or color not in TILE_COLOR_IDS:
        raise BackupError(f"{where} has an invalid tile color {color!r}")
    if "icon" in card:
        icon = card["icon"]
        if not isinstance(icon, str) or icon not in CARD_ICON_IDS:
            raise BackupError(f"{where} has an unsupported category icon {icon!r}")
    if "notes" in card and not _bounded(card["notes"], LIMITS["notesLength"]):
        raise BackupError(f"{where} has notes longer than {LIMITS['notesLength']} characters")
    if not _is_timestamp(card.get("createdAt")) or not _is_timestamp(card.get("updatedAt")):
        raise BackupError(f"{where} has an invalid timestamp")

    barcode = card.get("barcode")
    if not isinstance(barcode, dict):
        raise BackupError(f"{where} has no barcode")
    kind = barcode.get("kind")
    if kind == "text":
        value = barcode.get("value")
        if not _bounded(value, LIMITS["valueLength"]) or value == "":
            raise BackupError(f"{where} has an invalid barcode value")
        return 0
    if kind == "generated":
        barcode_format, value = barcode.get("format"), barcode.get("value")
        if not isinstance(barcode_format, str) or (barcode_format not in GS1_FORMATS and barcode_format not in FREE_FORM_FORMATS):
            raise BackupError(f"{where} has an unsupported barcode format {barcode_format!r}")
        if not _bounded(value, LIMITS["valueLength"]):
            raise BackupError(f"{where} has an invalid barcode value")
        problem = _barcode_value_error(barcode_format, value)
        if problem is not None:
            raise BackupError(f"{where} has an invalid {barcode_format} barcode value: it {problem}")
        return 0
    if kind != "image":
        raise BackupError(f"{where} has an unknown barcode kind")

    mime, length, data = barcode.get("mimeType"), barcode.get("byteLength"), barcode.get("data")
    if not isinstance(mime, str) or mime not in IMAGE_SIGNATURES:
        raise BackupError(f"{where} has an unsupported image type")
    if not _is_int(length) or length <= 0:
        raise BackupError(f"{where} has an invalid image byteLength")
    if length > LIMITS["imageBytes"]:
        raise BackupError(
            f"{where} has a {length}-byte image, over the {LIMITS['imageBytes']}-byte per-image limit; "
            "no part containing it could be restored"
        )
    if not isinstance(data, str) or len(data) != math.ceil(length / 3) * 4 or not BASE64_RE.fullmatch(data):
        raise BackupError(f"{where} has malformed image data")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise BackupError(f"{where} has malformed image data") from None
    if len(raw) != length:
        raise BackupError(f"{where} image data does not match its byteLength")
    sniffed = _sniff(raw)
    if sniffed is not None and sniffed != mime:
        raise BackupError(f"{where} image bytes do not match its mimeType")
    for key in ("detectedValue", "detectedFormat"):
        if key in barcode and not _bounded(barcode[key], LIMITS["detectedLength"]):
            raise BackupError(f"{where} has an invalid {key}")
    return length


def validate_backup(doc, limits=None):
    """
    Validates a parsed backup. With `limits`, also enforces the restore
    limits (used for output parts); the input itself may exceed them.
    Returns the cards in `order` sequence with their decoded image sizes.
    """
    if not isinstance(doc, dict) or doc.get("format") != FORMAT_ID:
        raise BackupError("not an M8TRX backup")
    version = doc.get("version")
    if not _is_int(version) or version < 1:
        raise BackupError("invalid backup version")
    if version > FORMAT_VERSION:
        raise BackupError(f"backup version {version} is newer than this tool supports ({FORMAT_VERSION})")
    validate_metadata(doc)
    cards, order = doc.get("cards"), doc.get("order")
    if not isinstance(cards, list) or not isinstance(order, list):
        raise BackupError("backup has no cards/order arrays")

    by_id = {}
    for index, card in enumerate(cards):
        size = validate_card(card, index)
        if card["id"] in by_id:
            raise BackupError(f"duplicate card id {card['id']!r}")
        by_id[card["id"]] = (card, size)
    if len(order) != len(by_id) or len(set(o for o in order if isinstance(o, str))) != len(order):
        raise BackupError("order does not name every card exactly once")
    if any(not isinstance(o, str) or o not in by_id for o in order):
        raise BackupError("order does not name every card exactly once")
    ordered = [by_id[card_id] for card_id in order]

    if limits is not None:
        if len(ordered) > limits["cards"]:
            raise BackupError("part has too many cards")
        if sum(size for _, size in ordered) > limits["totalImageBytes"]:
            raise BackupError("part has too much image data")
    return ordered


# ---- Splitting ----------------------------------------------------------------


def _encode(value):
    """Compact UTF-8 JSON bytes, as the app writes it. Strings round-trip exactly."""
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except UnicodeEncodeError:
        # A lone UTF-16 surrogate in a string; it can't be written as UTF-8 unchanged.
        raise BackupError("backup contains text that is not valid Unicode") from None


def _encoded_size(value):
    return len(_encode(value))


def _reject_constant(name):
    # Python accepts NaN/Infinity; JSON (and M8TRX) do not.
    raise BackupError(f"invalid JSON value {name}")


def _loads(text):
    return json.loads(text, object_pairs_hook=_reject_duplicate_keys, parse_constant=_reject_constant)


def split(doc, limits):
    """Returns the part documents. Greedy, in wallet order: each part is as full as the limits allow."""
    ordered = validate_backup(doc)
    # Metadata is copied unchanged (validate_backup has required all four keys).
    header = {key: doc[key] for key in ("format", "version", "exportedAt", "app")}
    empty_size = _encoded_size({**header, "order": [], "cards": []})

    parts, current = [], []
    images = size = 0
    for card, image_bytes in ordered:
        # Size the card adds: its record, its quoted ID in `order`, and a comma in each array when not first.
        alone = _encoded_size(card) + _encoded_size(card["id"])
        added = alone + (2 if current else 0)
        if empty_size + alone > limits["fileBytes"]:
            raise BackupError(f"card {card['id']!r} alone exceeds the {limits['fileBytes']}-byte file limit")
        fits = (
            len(current) < limits["cards"]
            and images + image_bytes <= limits["totalImageBytes"]
            and empty_size + size + added <= limits["fileBytes"]
        )
        if current and not fits:
            parts.append(current)
            current, images, size = [], 0, 0
            added -= 2  # first card of the new part: no commas
        current.append(card)
        images += image_bytes
        size += added
    if current:
        parts.append(current)
    return [{**header, "order": [card["id"] for card in part], "cards": part} for part in parts]


def part_names(input_path, count):
    stem = os.path.basename(input_path)
    if stem.lower().endswith(EXTENSION):
        stem = stem[: -len(EXTENSION)]
    width = max(2, len(str(count)))
    return [f"{stem}-part-{i:0{width}d}-of-{count:0{width}d}{EXTENSION}" for i in range(1, count + 1)]


def run(input_path, output_dir, limits):
    with open(input_path, "rb") as handle:
        raw = handle.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise BackupError("file is not UTF-8 text") from None
    try:
        doc = _loads(text)
    except (json.JSONDecodeError, RecursionError):
        raise BackupError("not an M8TRX backup (invalid JSON)") from None

    parts = split(doc, limits)
    if not parts:
        raise BackupError("backup contains no cards; nothing to split")

    # Re-validate every part exactly as it will be written, before writing any.
    encoded = []
    seen = []
    for part in parts:
        data = _encode(part)
        if len(data) > limits["fileBytes"]:
            raise BackupError("internal error: a part exceeds the file limit")
        validate_backup(_loads(data.decode("utf-8")), limits)
        encoded.append(data)
        seen.extend(part["order"])
    if seen != doc["order"]:
        raise BackupError("internal error: parts do not cover every card exactly once")

    names = part_names(input_path, len(parts))
    paths = [os.path.join(output_dir, name) for name in names]
    existing = [path for path in paths if os.path.exists(path)]
    if existing:
        raise BackupError(f"refusing to overwrite existing file(s): {', '.join(existing)}")
    os.makedirs(output_dir, exist_ok=True)
    written = []
    try:
        for path, data in zip(paths, encoded):
            with open(path, "xb") as handle:  # "x": never overwrite
                written.append(path)  # created by this run, so ours to remove
                handle.write(data)
    except OSError:
        # Never leave an incomplete set of parts behind (e.g. disk full).
        for path in written:
            try:
                os.remove(path)
            except OSError:
                pass
        raise
    return paths, parts


def main(argv=None):
    parser = argparse.ArgumentParser(description="Split an oversized M8TRX backup into restorable parts.")
    parser.add_argument("backup", nargs="?", help="the .m8trx backup to split")
    parser.add_argument("--output-dir", help="where to write the parts (default: next to the input)")
    parser.add_argument("--max-image-mib", type=float, help="decoded image data per part, in MiB (at most 60)")
    parser.add_argument("--max-cards", type=int, help="cards per part (at most 1000)")
    parser.add_argument("--print-limits", action="store_true", help="print the standard restore limits as JSON and exit")
    args = parser.parse_args(argv)

    if args.print_limits:
        print(json.dumps(LIMITS))
        return 0
    if not args.backup:
        parser.error("the backup file is required")

    limits = dict(LIMITS)
    if args.max_image_mib is not None:
        if not 0 < args.max_image_mib * MIB <= LIMITS["totalImageBytes"]:
            parser.error("--max-image-mib must be greater than 0 and at most 60")
        limits["totalImageBytes"] = int(args.max_image_mib * MIB)
    if args.max_cards is not None:
        if not 0 < args.max_cards <= LIMITS["cards"]:
            parser.error("--max-cards must be between 1 and 1000")
        limits["cards"] = args.max_cards

    output_dir = args.output_dir or os.path.dirname(os.path.abspath(args.backup))
    try:
        paths, parts = run(args.backup, output_dir, limits)
    except (BackupError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for path, part in zip(paths, parts):
        print(f"{path}: {len(part['cards'])} cards")
    print(f"Wrote {len(paths)} part(s). Restore them one at a time, in order, and keep the original backup until all are restored.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
