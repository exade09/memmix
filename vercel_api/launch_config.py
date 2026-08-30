from __future__ import annotations

import os

# Pinned to web/package.json @pump-fun/pump-sdk. Do not invent a different version.
PINNED_LAUNCH_SDK_VERSION = "1.36.0"

DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com"

RPC_ALLOWED_METHODS = frozenset(
    {
        "getLatestBlockhash",
        "getAccountInfo",
        "getMultipleAccounts",
        "getBalance",
        "getFeeForMessage",
        "simulateTransaction",
        "sendTransaction",
        "getSignatureStatuses",
        "getMinimumBalanceForRentExemption",
    }
)

RPC_READ_METHODS = RPC_ALLOWED_METHODS - {"sendTransaction"}
RPC_MAX_BODY_BYTES = 256_000
RPC_MAX_BATCH = 5
RPC_SEND_WINDOW_SECONDS = 60
RPC_SEND_LIMIT = 8
RPC_READ_WINDOW_SECONDS = 60
RPC_READ_LIMIT = 60


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def solana_rpc_url() -> str:
    return (os.getenv("SOLANA_RPC_URL") or DEFAULT_DEVNET_RPC).strip() or DEFAULT_DEVNET_RPC


def solana_cluster() -> str:
    explicit = os.getenv("SOLANA_CLUSTER", "").strip().lower()
    if explicit in {"mainnet", "mainnet-beta"}:
        return "mainnet-beta"
    if explicit == "devnet":
        return "devnet"
    url = solana_rpc_url().lower()
    if "mainnet" in url:
        return "mainnet-beta"
    return "devnet"


def native_launch_enabled() -> bool:
    return env_flag("ENABLE_NATIVE_LAUNCH", False)


def mainnet_launch_enabled() -> bool:
    return env_flag("ENABLE_MAINNET_LAUNCH", False)


def send_transaction_allowed() -> tuple[bool, str]:
    if not native_launch_enabled():
        return False, "Native launch is disabled."
    if solana_cluster() == "mainnet-beta" and not mainnet_launch_enabled():
        return False, "Mainnet launch is disabled."
    return True, ""


def allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return []
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
