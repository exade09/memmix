from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from axiom_scanner.analysis.local_ai import explain_ranked_tokens
from axiom_scanner.analysis.scoring import rank_tokens
from axiom_scanner.config import ScannerConfig, load_config
from axiom_scanner.reporting import render_console_report
from axiom_scanner.sources.dexscreener import DexScreenerSource


PROJECT_ROOT = Path(__file__).resolve().parent
WEB_ROOT = PROJECT_ROOT / "web"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find currently hyped on-chain tokens from public market data."
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to config JSON. Defaults are used when omitted.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan", help="Run one scan and print ranked tokens.")
    scan.add_argument("--limit", type=int, default=15, help="How many tokens to show.")
    scan.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="Output format.",
    )
    scan.add_argument(
        "--chain",
        action="append",
        help="Override config chains. Can be passed more than once.",
    )

    watch = subparsers.add_parser("watch", help="Run scans in a loop.")
    watch.add_argument("--limit", type=int, default=10, help="How many tokens to show.")
    watch.add_argument(
        "--interval",
        type=int,
        default=60,
        help="Seconds between scans.",
    )
    watch.add_argument(
        "--chain",
        action="append",
        help="Override config chains. Can be passed more than once.",
    )

    web = subparsers.add_parser("web", help="Run the visual dashboard.")
    web.add_argument("--host", default="127.0.0.1", help="Dashboard host.")
    web.add_argument("--port", type=int, default=8080, help="Dashboard port.")
    web.add_argument("--limit", type=int, default=100, help="Default token count.")
    web.add_argument(
        "--chain",
        action="append",
        help="Override config chains. Can be passed more than once.",
    )

    return parser


def scan_once(config: ScannerConfig, limit: int) -> list[dict]:
    source = DexScreenerSource(config=config)
    snapshots = source.fetch_tokens()
    ranked = rank_tokens(snapshots, config=config)
    explanations = explain_ranked_tokens(ranked[:limit])

    rows: list[dict] = []
    for item, explanation in zip(ranked[:limit], explanations):
        rows.append(
            {
                "rank": len(rows) + 1,
                "token": item.snapshot.symbol,
                "name": item.snapshot.name,
                "chain": item.snapshot.chain_id,
                "address": item.snapshot.token_address,
                "image_url": item.snapshot.image_url,
                "score": round(item.score, 2),
                "signal": item.signal,
                "price_usd": item.snapshot.price_usd,
                "liquidity_usd": item.snapshot.liquidity_usd,
                "volume_1h": item.snapshot.volume_1h,
                "volume_24h": item.snapshot.volume_24h,
                "txns_1h": item.snapshot.txns_1h,
                "buys_1h": item.snapshot.buys_1h,
                "sells_1h": item.snapshot.sells_1h,
                "price_change_5m": item.snapshot.price_change_5m,
                "price_change_1h": item.snapshot.price_change_1h,
                "price_change_6h": item.snapshot.price_change_6h,
                "price_change_24h": item.snapshot.price_change_24h,
                "age_minutes": item.snapshot.age_minutes,
                "risk_flags": item.risk_flags,
                "why": explanation,
                "url": item.snapshot.pair_url,
            }
        )

    return rows


def apply_cli_overrides(config: ScannerConfig, chains: list[str] | None) -> ScannerConfig:
    if chains:
        config.chains = [chain.strip().lower() for chain in chains if chain.strip()]
    return config


def run_scan(args: argparse.Namespace) -> int:
    config = apply_cli_overrides(load_config(args.config), args.chain)
    rows = scan_once(config, limit=args.limit)

    if args.format == "json":
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        print(render_console_report(rows))

    return 0


def run_watch(args: argparse.Namespace) -> int:
    config = apply_cli_overrides(load_config(args.config), args.chain)

    while True:
        rows = scan_once(config, limit=args.limit)
        print("\n" + "=" * 96)
        print(time.strftime("Scan time: %Y-%m-%d %H:%M:%S"))
        print(render_console_report(rows))
        sys.stdout.flush()
        time.sleep(max(args.interval, 15))


def run_web(args: argparse.Namespace) -> int:
    config_path = args.config
    chains = args.chain

    class DashboardHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/api/scan":
                self._send_scan(parsed.query)
                return

            path = "index.html" if parsed.path in ("", "/") else parsed.path.lstrip("/")
            self._send_static(path)

        def log_message(self, format: str, *args: object) -> None:
            # Keep the terminal useful: scans are visible in the browser UI.
            return

        def _send_scan(self, query: str) -> None:
            params = parse_qs(query)
            limit = _parse_int(params.get("limit", [str(args.limit)])[0], args.limit)
            config = apply_cli_overrides(load_config(config_path), chains)
            rows = scan_once(config, limit=limit)
            payload = {
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "count": len(rows),
                "tokens": rows,
            }
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_static(self, path: str) -> None:
            full_path = (WEB_ROOT / path).resolve()
            if not str(full_path).startswith(str(WEB_ROOT.resolve())) or not full_path.is_file():
                self.send_error(404)
                return

            body = full_path.read_bytes()
            content_type = mimetypes.guess_type(str(full_path))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"Dashboard: http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard stopped.")
    finally:
        server.server_close()
    return 0


def _parse_int(value: str, fallback: int) -> int:
    try:
        return max(int(value), 1)
    except ValueError:
        return fallback


def main() -> int:
    _configure_stdout()
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "scan":
        return run_scan(args)
    if args.command == "watch":
        return run_watch(args)
    if args.command == "web":
        return run_web(args)

    parser.print_help()
    return 1


def _configure_stdout() -> None:
    # Meme token names can contain symbols outside the Windows console codepage.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
