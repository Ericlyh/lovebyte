#!/usr/bin/env python3
"""
seed_catalog_covers.py — give the seeded Lovorithm catalogue real covers.

OOP-6717 — the catalogue shipped as nine seeded rows whose every image was
a `placehold.co` text box and whose `cover_media_id` was NULL, so /browse
drew an emoji tile for every gift. This script replaces that placeholder
storefront with the real media pipeline the app already has:

   1. generate cover art (Pillow),
   2. upload it to the public `lovorithm-media` bucket,
   3. insert a `gift_media` row per object,
   4. point each gift at its cover (`cover_media_id`) and rewrite the
      placeholder URLs inside its payload to the uploaded objects,
   5. unlist the leftover test row (`title = 'hi'`, empty payload).

The same three steps a creator's upload runs through — generate, upload,
attach — so the catalogue ends up exercising the production path rather
than a special case.

WHY PYTHON AND NOT NODE
The rest of `scripts/` is Node. Image generation is the one thing here
that needs a real rasteriser, and Pillow is what the host has; a hand-
rolled PNG encoder in JS would be more code and a worse image. The upload
and the database wiring use plain `urllib` against the same REST endpoints
the app uses (Storage REST + PostgREST), so no new dependency is added to
the Node app.

CREDENTIALS
Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env.local`
— the same secret key the app's service-role client uses. It is server-
only; never prefix it with `NEXT_PUBLIC_`.

USAGE
    python3 scripts/seed_catalog_covers.py            # apply
    python3 scripts/seed_catalog_covers.py --dry-run  # print the plan only

Idempotent: storage objects are upserted, `gift_media` rows are matched on
`storage_path` and updated rather than duplicated, and the gifts are
re-pointed at the same media every run.
"""

import io
import json
import math
import os
import random
import re
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SIZE = 900
BUCKET = 'lovorithm-media'


# ---------------------------------------------------------------------------
# The catalogue plan
# ---------------------------------------------------------------------------
#
# One entry per listed gift. `payload` is the ordered list of replacements
# for the placeholder URLs found inside the payload (walked in order, so the
# list must match the order the URLs appear); `cover` names the slug whose
# object becomes the listing's cover. When the gift has photos of its own,
# the cover is its FIRST photo — a creator who picks a cover picks one of
# the gift's own pictures.
#
# `kind` is 'image' or 'audio' — the Lisbon collage carries a voice note,
# and a photo URL standing in for audio is exactly the kind of placeholder
# this script exists to remove.

#
# `palette` is [light, mid, dark, accent]: `light`/`mid` are the sky and
# the bokeh lights, `dark` is the base the lights glow against, `accent`
# is the brightest highlight.

CATALOGUE = {
    # Mei — Our Sunday dim sum (memory_cards, two photos)
    'aaaa1111-0000-0000-0000-000000000001': {
        'cover': 'dim-sum-1',
        'style': 'bokeh',
        'palette': ['#f6e3c5', '#e8b98a', '#4a2f18', '#fdf6e6'],
        'payload': [('dim-sum-1', 'image'), ('dim-sum-2', 'image')],
    },
    # Arjun — Match the Goa sunsets (memory_cards, two photos)
    'aaaa1111-0000-0000-0000-000000000002': {
        'cover': 'goa-sunset-1',
        'style': 'sunset',
        'palette': ['#f7b267', '#e8743b', '#c9455f', '#2f3e6e'],
        'payload': [('goa-sunset-1', 'image'), ('goa-sunset-2', 'image')],
    },
    # Arjun — Bangkok street photo puzzle (dragdrop_puzzle, one photo)
    'aaaa2222-0000-0000-0000-000000000001': {
        'cover': 'bangkok-street',
        'style': 'street',
        'palette': ['#0d1b2a', '#1b3a5c', '#f4a259', '#e8e0d0'],
        'payload': [('bangkok-street', 'image')],
    },
    # Mei — Trivia of our first year (quiz, no photos of its own)
    'aaaa3333-0000-0000-0000-000000000002': {
        'cover': 'trivia-year',
        'style': 'bokeh',
        'palette': ['#f7d9a0', '#e9a23b', '#3b2410', '#fff4dc'],
        'payload': [],
    },
    # Sofia — A weekend in Lisbon (multimedia_collage, one photo + a voice note)
    'aaaa4444-0000-0000-0000-000000000001': {
        'cover': 'lisbon-tram',
        'style': 'skyline',
        'palette': ['#f3c1a4', '#e07a5f', '#2f3e5e', '#f6efe6'],
        'payload': [('lisbon-tram', 'image'), ('lisbon-voice-note', 'audio')],
    },
    # Mei — A letter that unfolds (animated_letter, no photos of its own)
    'aaaa5555-0000-0000-0000-000000000001': {
        'cover': 'letter-paper',
        'style': 'paper',
        'palette': ['#f3e9d8', '#e8d8c8', '#2f3e6e', '#d9c7a7'],
        'payload': [],
    },
    # Mei — How well do you know us? (quiz, no photos of its own)
    'aaaa3333-0000-0000-0000-000000000001': {
        'cover': 'know-us',
        'style': 'bokeh',
        'palette': ['#cfe8e0', '#7fb8a4', '#12332c', '#f2f7f4'],
        'payload': [],
    },
    # Arjun — 5×5 Madrid rooftops (dragdrop_puzzle, one photo)
    'aaaa2222-0000-0000-0000-000000000002': {
        'cover': 'madrid-rooftops',
        'style': 'skyline',
        'palette': ['#f6c89a', '#c97b4a', '#4a2f1d', '#f6c89a'],
        'payload': [('madrid-rooftops', 'image')],
    },
}

# The leftover test row: title 'hi', description 'hi', empty payload,
# listed. It was the first card on /browse and it bypassed the empty-payload
# guard because it was inserted directly rather than published. It is
# unlisted, not deleted — it belongs to a real account.
UNLIST = {
    'id': '54eb5dd7-45d0-4b6b-8bba-694bf2a34353',
    'title': 'hi',
}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def load_env():
    env = {}
    env_file = ROOT / '.env.local'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            env[key.strip()] = value.strip()
    for key in ('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'):
        if key in os.environ:
            env[key] = os.environ[key]
    missing = [k for k in ('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY') if not env.get(k)]
    if missing:
        sys.exit(f'Missing {", ".join(missing)} — set it in .env.local or the environment.')
    return env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/'), env['SUPABASE_SECRET_KEY']


def request(url, method='GET', body=None, headers=None, secret=None):
    hdrs = {'apikey': secret, 'Authorization': f'Bearer {secret}'}
    if headers:
        hdrs.update(headers)
    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = json.dumps(body).encode('utf-8')
            hdrs.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return resp.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def rest(base, secret, path, method='GET', body=None, prefer=None):
    headers = {}
    if prefer:
        headers['Prefer'] = prefer
    status, raw = request(f'{base}/rest/v1/{path}', method, body, headers, secret)
    if status >= 300:
        raise SystemExit(f'{method} /{path} -> {status}: {raw[:400]!r}')
    return json.loads(raw) if raw else None


# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------

def hex_rgb(value):
    if isinstance(value, tuple):
        return value
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(top, bottom, size=(SIZE, SIZE), horizontal=False):
    """A smooth two-colour gradient, built small and scaled up."""
    w, h = size
    if horizontal:
        strip = Image.new('RGB', (w, 1))
        for x in range(w):
            strip.putpixel((x, 0), lerp(top, bottom, x / max(w - 1, 1)))
    else:
        strip = Image.new('RGB', (1, h))
        for y in range(h):
            strip.putpixel((0, y), lerp(top, bottom, y / max(h - 1, 1)))
    return strip.resize((w, h), Image.BICUBIC)


def bokeh_layer(palette, size, seed, count=16, radius=(50, 240), blur=None):
    rnd = random.Random(seed)
    w, h = size
    layer = Image.new('RGB', (w, h), (0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(count):
        color = hex_rgb(rnd.choice(palette))
        r = rnd.randint(*radius)
        cx = rnd.randint(-r // 2, w + r // 2)
        cy = rnd.randint(-r // 2, h + r // 2)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    return layer.filter(ImageFilter.GaussianBlur(blur if blur is not None else rnd.randint(26, 60)))


def add_vignette(img, strength=0.5):
    w, h = img.size
    small = Image.new('L', (w // 8, h // 8), 0)
    ImageDraw.Draw(small).ellipse(
        [-w // 20, -h // 20, w // 8 + w // 20, h // 8 + h // 20], fill=255
    )
    mask = small.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(w * 0.06))
    dark = Image.new('RGB', (w, h), (0, 0, 0))
    return Image.composite(img, Image.blend(img, dark, strength), mask)


def add_grain(img, sigma=6):
    noise = Image.effect_noise(img.size, sigma).convert('L')
    return ImageChops.add(img, Image.merge('RGB', (noise, noise, noise)), scale=1.0, offset=-128)


def render(style, palette, seed):
    """Render one cover image.

    Every recipe is soft-focus on purpose: a heavy blur plus grain and a
    vignette is what makes a flat gradient read as a photograph rather
    than as a graphic. Only the sunset and the night street carry a
    recognisable subject; the rest are light and colour, which is what a
    real cover photo usually is.
    """
    colors = [hex_rgb(c) for c in palette]
    rnd = random.Random(seed)
    w, h = SIZE, SIZE

    if style == 'sunset':
        img = gradient(colors[0], colors[1])
        sea = gradient(colors[3], lerp(colors[3], (0, 0, 0), 0.35))
        img.paste(sea.crop((0, int(h * 0.62), w, h)), (0, int(h * 0.62)))
        sun_r = int(w * 0.17)
        sun = Image.new('RGB', (w, h), (0, 0, 0))
        ImageDraw.Draw(sun).ellipse(
            [w // 2 - sun_r, int(h * 0.44) - sun_r, w // 2 + sun_r, int(h * 0.44) + sun_r],
            fill=lerp(colors[0], (255, 255, 255), 0.55),
        )
        img = ImageChops.screen(img, sun.filter(ImageFilter.GaussianBlur(14)))
        glow = Image.new('RGB', (w, h), (0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            [w // 2 - sun_r * 2, int(h * 0.44) - sun_r * 2, w // 2 + sun_r * 2, int(h * 0.44) + sun_r * 2],
            fill=colors[1],
        )
        img = ImageChops.screen(img, glow.filter(ImageFilter.GaussianBlur(90)))
        img = ImageChops.screen(img, bokeh_layer(palette, (w, h), seed + 1, count=8, radius=(40, 130)))

    elif style == 'street':
        img = gradient(colors[0], colors[1])
        draw = ImageDraw.Draw(img)
        for _ in range(18):
            x = rnd.randint(0, w)
            top = rnd.randint(int(h * 0.1), int(h * 0.6))
            length = rnd.randint(120, 420)
            draw.line([x, top, x + rnd.randint(-20, 20), top + length], fill=colors[3], width=rnd.randint(3, 9))
        lights = Image.new('RGB', (w, h), (0, 0, 0))
        ldraw = ImageDraw.Draw(lights)
        for _ in range(26):
            x = rnd.randint(0, w)
            y = rnd.randint(int(h * 0.15), int(h * 0.95))
            r = rnd.randint(8, 26)
            ldraw.ellipse([x - r, y - r, x + r, y + r], fill=rnd.choice([colors[2], colors[3], colors[2]]))
        img = ImageChops.screen(img, lights.filter(ImageFilter.GaussianBlur(9)))
        img = ImageChops.screen(img, bokeh_layer(palette, (w, h), seed + 3, count=14, radius=(30, 110)))

    elif style == 'skyline':
        # A dusk skyline: warm sky, low sun, blurred rooftops in front.
        img = gradient(colors[0], colors[1])
        sun = Image.new('RGB', (w, h), (0, 0, 0))
        ImageDraw.Draw(sun).ellipse([int(w * 0.62), int(h * 0.44), int(w * 0.92), int(h * 0.74)],
                                    fill=lerp(colors[0], (255, 255, 255), 0.5))
        img = ImageChops.screen(img, sun.filter(ImageFilter.GaussianBlur(60)))
        img = ImageChops.screen(img, bokeh_layer(palette, (w, h), seed + 1, count=10, radius=(40, 140)))
        # The rooftops — blurred hard, so they read as a silhouette rather
        # than as shapes.
        front = Image.new('RGB', (w, h), (0, 0, 0))
        fdraw = ImageDraw.Draw(front)
        x = -60
        while x < w + 60:
            bw = rnd.randint(110, 210)
            bh = rnd.randint(int(h * 0.16), int(h * 0.36))
            top = h - bh
            fdraw.rectangle([x, top, x + bw, h], fill=colors[2])
            for wy in range(top + 46, h - 34, 78):
                for wx in range(x + 26, x + bw - 34, 58):
                    if rnd.random() < 0.4:
                        fdraw.rectangle([wx, wy, wx + 24, wy + 32], fill=lerp(colors[3], colors[0], rnd.uniform(0.5, 1.0)))
            x += bw + rnd.randint(4, 22)
        img = ImageChops.screen(img, front.filter(ImageFilter.GaussianBlur(9)))

    elif style == 'paper':
        img = Image.new('RGB', (w, h), hex_rgb(palette[0]))
        for _ in range(26):
            y = rnd.randint(0, h)
            draw = ImageDraw.Draw(img)
            draw.line([0, y, w, y + rnd.randint(-8, 8)], fill=lerp(colors[0], colors[3], 0.06), width=rnd.randint(1, 3))
        draw = ImageDraw.Draw(img)
        for i in range(9):
            y = int(h * 0.2) + i * 52
            width = rnd.randint(int(w * 0.35), int(w * 0.72))
            draw.line([int(w * 0.14), y, int(w * 0.14) + width, y],
                      fill=lerp(colors[2], colors[0], rnd.uniform(0.05, 0.35)), width=rnd.randint(3, 7))
        shadow = Image.new('RGB', (w, h), (0, 0, 0))
        ImageDraw.Draw(shadow).rectangle([int(w * 0.08), int(h * 0.08), int(w * 0.94), int(h * 0.94)],
                                         fill=lerp(colors[3], (0, 0, 0), 0.4))
        shadow = shadow.filter(ImageFilter.GaussianBlur(40))
        img = ImageChops.subtract(img, shadow.point(lambda v: int(v * 0.35)))
        img = img.filter(ImageFilter.GaussianBlur(0.8))

    else:  # 'bokeh' — a room of warm light, out of focus
        # A dark base so the out-of-focus lights have something to glow
        # against; a wide blur for the depth, a tight one for the discs.
        img = gradient(lerp(colors[2], (0, 0, 0), 0.4), lerp(colors[1], colors[0], 0.3))
        lit = [colors[0], colors[1], colors[3]]
        img = ImageChops.screen(img, bokeh_layer(lit, (w, h), seed + 1, count=9, radius=(150, 330), blur=95))
        img = ImageChops.screen(img, bokeh_layer(lit, (w, h), seed + 2, count=16, radius=(30, 120), blur=13))
        img = img.filter(ImageFilter.GaussianBlur(1.2))

    img = add_vignette(img)
    img = add_grain(img)
    return img


def render_audio(slug, seconds=3):
    """A short, quiet tone standing in for the Lisbon voice note.

    It is a real, playable audio file — the point of the fix is that the
    catalogue holds no more dangling placeholder URLs, and an audio item
    pointing at a JPEG is exactly such a URL. It is a tone, not a
    recording, and it says so in the delivery notes.
    """
    rate = 22050
    frames = bytearray()
    for n in range(rate * seconds):
        t = n / rate
        envelope = min(1.0, t / 0.4) * min(1.0, (seconds - t) / 0.6)
        value = 0.0
        for freq, weight in ((196.0, 1.0), (294.0, 0.45), (392.0, 0.25)):
            value += weight * math.sin(2 * math.pi * freq * t)
        value *= envelope * 0.16
        frames += int(max(-1.0, min(1.0, value)) * 32767).to_bytes(2, 'little', signed=True)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(bytes(frames))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

# A media URL in a payload: either the placeholder it replaces, or one of
# the objects this script has already uploaded.
MEDIA_URL_RE = re.compile(r'^https://(placehold\.co|[a-z0-9]+\.supabase\.co/storage/v1/object/public/)')


def replace_media(payload, replacements):
    """Point a payload's media fields at the uploaded objects.

    The URLs are replaced in the order they appear in the payload, which
    for every gift type is the order of the media array — `pairs[0]`,
    `pairs[1]`, `media[0]`, `media[1]`. A field left as a two-element
    `[url, mime]` pair by an earlier run is repaired into a plain URL.
    """
    found = []

    def find(node):
        if isinstance(node, dict):
            return {k: find(v) for k, v in node.items()}
        if isinstance(node, list):
            if (
                len(node) == 2
                and isinstance(node[0], str)
                and isinstance(node[1], str)
                and MEDIA_URL_RE.match(node[0])
            ):
                found.append(node[0])
                return node[0]
            return [find(v) for v in node]
        if isinstance(node, str) and MEDIA_URL_RE.match(node):
            found.append(node)
        return node

    result = find(payload)
    if len(found) != len(replacements):
        raise SystemExit(
            f'payload has {len(found)} media URLs, {len(replacements)} replacements given'
        )
    lookup = dict(zip(found, replacements))

    def apply(node):
        if isinstance(node, dict):
            return {k: apply(v) for k, v in node.items()}
        if isinstance(node, list):
            return [apply(v) for v in node]
        if isinstance(node, str) and node in lookup:
            return lookup[node]
        return node

    return apply(result)


def main():
    dry_run = '--dry-run' in sys.argv
    base, secret = load_env()
    project_ref = base.replace('https://', '').replace('.supabase.co', '')

    gifts = rest(base, secret, 'gifts?is_listed=eq.true&select=id,title,owner_id,payload,cover_media_id')
    by_id = {g['id']: g for g in gifts}
    print(f'Listed gifts: {len(gifts)}')

    for gift in gifts:
        if gift['id'] in CATALOGUE:
            continue
        if gift['id'] == UNLIST['id']:
            continue
        raise SystemExit(f"No plan for listed gift {gift['id']} ({gift['title']!r})")

    # 1. Generate.
    objects = {}  # slug -> (bytes, mime, ext)
    for index, (gift_id, plan) in enumerate(CATALOGUE.items()):
        slugs = [plan['cover']] + [slug for slug, _ in plan['payload']]
        for slug in dict.fromkeys(slugs):
            if slug in objects:
                continue
            kind = next((k for s, k in plan['payload'] if s == slug), 'image')
            if kind == 'audio':
                objects[slug] = (render_audio(slug), 'audio/wav', 'wav')
                print(f'  rendered {slug}.wav (audio)')
                continue
            style = plan['style']
            palette = plan['palette']
            # The second photo of a pair gets a variation of the same scene,
            # so the two cards are recognisably from the same afternoon.
            variant = 1 if slug.endswith('-2') else 0
            img = render(style, palette, 1000 + index * 17 + variant * 5)
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=84, optimize=True)
            objects[slug] = (buf.getvalue(), 'image/jpeg', 'jpg')
            print(f'  rendered {slug}.jpg ({len(objects[slug][0]) // 1024} KB)')

    if dry_run:
        print('\n--dry-run: no uploads, no database writes.')
        return

    # 2. Upload + 3. attach.
    public_base = f'{base}/storage/v1/object/public/{BUCKET}'
    storage_base = f'{base}/storage/v1/object/{BUCKET}'
    uploaded = {}

    for gift_id, plan in CATALOGUE.items():
        gift = by_id[gift_id]
        owner_id = gift['owner_id']
        slugs = [plan['cover']] + [slug for slug, _ in plan['payload']]
        for slug in dict.fromkeys(slugs):
            data, mime, ext = objects[slug]
            path = f'gifts/catalogue/{owner_id}/{slug}.{ext}'
            status, raw = request(
                f'{storage_base}/{path}', 'POST', data,
                {'Content-Type': mime, 'x-upsert': 'true'}, secret,
            )
            if status >= 300:
                raise SystemExit(f'upload {path} -> {status}: {raw[:400]!r}')
            url = f'{public_base}/{path}'
            uploaded[slug] = {'path': path, 'url': url, 'mime': mime,
                              'size': len(data), 'owner_id': owner_id}
            print(f'  uploaded {path}')

    # gift_media rows — matched on storage_path so a re-run updates rather
    # than duplicates.
    existing = rest(base, secret, 'gift_media?select=id,storage_path')
    existing_by_path = {row['storage_path']: row for row in existing}

    media_ids = {}
    for slug, info in uploaded.items():
        row = existing_by_path.get(info['path'])
        payload = {
            'owner_id': info['owner_id'],
            'storage_path': info['path'],
            'mime': info['mime'],
            'byte_size': info['size'],
        }
        if info['mime'].startswith('image/'):
            payload['width'] = SIZE
            payload['height'] = SIZE
        if row:
            rest(base, secret, f'gift_media?id=eq.{row["id"]}', 'PATCH', payload,
                 prefer='return=representation')
            media_ids[slug] = row['id']
        else:
            created = rest(base, secret, 'gift_media', 'POST', payload, prefer='return=representation')
            media_ids[slug] = created[0]['id']
        print(f'  gift_media row for {slug} -> {media_ids[slug]}')

    # 4. Point the gifts at their covers and rewrite the payload URLs.
    for gift_id, plan in CATALOGUE.items():
        gift = by_id[gift_id]
        replacements = [uploaded[slug]['url'] for slug, _ in plan['payload']]
        payload = replace_media(gift['payload'], replacements)
        body = {'cover_media_id': media_ids[plan['cover']]}
        if plan['payload']:
            body['payload'] = payload
        rest(base, secret, f'gifts?id=eq.{gift_id}', 'PATCH', body, prefer='return=representation')
        print(f'  {gift["title"]!r} -> cover {media_ids[plan["cover"]]}')

    # 5. Unlist the leftover test row.
    if UNLIST['id'] in by_id:
        rest(base, secret, f'gifts?id=eq.{UNLIST["id"]}',
             'PATCH', {'is_listed': False, 'published_at': None},
             prefer='return=representation')
        print(f'  unlisted {UNLIST["title"]!r} ({UNLIST["id"]})')

    print('\nDone.')


if __name__ == '__main__':
    main()
