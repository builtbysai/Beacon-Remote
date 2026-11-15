"""Render a health alert payload; never reads credentials or sends mail."""
import html
import json
import sys


def render(sender, recipient, subject, body):
    title = html.escape(subject)
    message = html.escape(body)
    return {
        "from": sender,
        "to": [recipient],
        "subject": subject,
        "text": body,
        "html": f'''<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>{title}</title>
<style>@media(prefers-color-scheme:dark){{body{{background:#111820!important;color:#e8eef7!important}}.card{{background:#19222d!important;border-color:#313d4d!important}}}}</style></head>
<body style="margin:0;background:#f5f7fa;color:#192941;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px">
<table role="presentation" class="card" align="center" style="width:100%;max-width:600px;border:1px solid #dce3eb;border-radius:10px;background:#fff"><tr><td style="padding:28px">
<p style="font-size:12px;font-weight:bold;letter-spacing:1px;margin:0 0 24px">BEACON REMOTE · OPERATIONS</p>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 20px">{title}</h1>
<pre style="font:14px/1.6 Arial,Helvetica,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:0">{message}</pre>
</td></tr></table></td></tr></table></body></html>''',
    }


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: render-alert.py <sender> <recipient> <subject>; body on stdin")
    print(json.dumps(render(*sys.argv[1:], sys.stdin.read())))
