from __future__ import annotations

import os

# Robinhood Chain: an Arbitrum Orbit L2, EVM-equivalent, gas paid in ETH.
# These are the published network parameters, not guesses.
ROBINHOOD_MAINNET_ID = 4663
ROBINHOOD_TESTNET_ID = 46630
DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com"
DEFAULT_EXPLORER = "https://robinhoodchain.blockscout.com"

# Pons v2 launch factory, the deployment this build launches through. Read back
# off chain before being written here: launchFee 0.0005 ETH, launchEnabled true,
# launchConfigCount 1. Overridable, never guessed.
DEFAULT_PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"

# Only what the client actually needs. Writes go through the wallet, never
# through this proxy, so eth_sendRawTransaction is deliberately absent.
#
# Every entry here is a read. The list is not a guess about what viem might
# want: eth_getBlockByNumber was missing and estimateFeesPerGas reads
# baseFeePerGas from the latest block, so every launch died at the fee
# estimate with a 403. tests/test_rpc.py now pins the launch flow's methods so
# a gap fails a test instead of a user's launch.
RPC_ALLOWED_METHODS = frozenset(
    {
        "eth_chainId",
        "eth_blockNumber",
        "eth_getBalance",
        "eth_getCode",
        "eth_call",
        "eth_estimateGas",
        "eth_gasPrice",
        "eth_maxPriorityFeePerGas",
        "eth_feeHistory",
        # Fee estimation reads the latest block header for baseFeePerGas.
        "eth_getBlockByNumber",
        "eth_getBlockByHash",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
        "eth_getTransactionCount",
        "eth_getLogs",
        "net_version",
    }
)

# The calls a launch makes, start to finish. Kept next to the allowlist
# because the two must not drift apart.
LAUNCH_FLOW_RPC_METHODS = frozenset(
    {
        "eth_chainId",           # network check
        "eth_getCode",           # factory holds code
        "eth_call",              # launchFee, previewLaunchEconomics, canLaunch, simulate
        "eth_getBlockByNumber",  # baseFeePerGas
        "eth_maxPriorityFeePerGas",
        "eth_estimateGas",
        "eth_getBalance",        # what the wallet actually holds
        "eth_blockNumber",       # receipt polling
        "eth_getTransactionReceipt",
    }
)

RPC_READ_METHODS = RPC_ALLOWED_METHODS
RPC_MAX_BODY_BYTES = 256_000
RPC_MAX_BATCH = 5
RPC_SEND_WINDOW_SECONDS = 60
RPC_SEND_LIMIT = 8
RPC_READ_WINDOW_SECONDS = 60
RPC_READ_LIMIT = 120


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def chain_rpc_url() -> str:
    return (os.getenv("ROBINHOOD_RPC_URL") or DEFAULT_RPC).strip() or DEFAULT_RPC


def explorer_url() -> str:
    return (os.getenv("ROBINHOOD_EXPLORER_URL") or DEFAULT_EXPLORER).strip() or DEFAULT_EXPLORER


def chain_id() -> int:
    """
    Defaults to mainnet because DEFAULT_RPC is the mainnet endpoint and there
    is no published public testnet RPC to point at. Claiming testnet while
    talking to mainnet would be worse than saying which chain this really is.

    Safety does not rest on this value: launching still needs
    ENABLE_NATIVE_LAUNCH and, on mainnet, ENABLE_MAINNET_LAUNCH, and every
    transaction is simulated and then signed in the user's own wallet.
    """
    explicit = os.getenv("ROBINHOOD_CHAIN_ID", "").strip()
    if explicit.isdigit():
        return int(explicit)
    if env_flag("ROBINHOOD_TESTNET", False):
        return ROBINHOOD_TESTNET_ID
    return ROBINHOOD_MAINNET_ID


def is_mainnet() -> bool:
    return chain_id() == ROBINHOOD_MAINNET_ID


def launchpad_address() -> str:
    """The Pons v2 factory. Falls back to the verified live deployment."""
    override = (os.getenv("PONS_FACTORY_ADDRESS") or "").strip()
    return override or DEFAULT_PONS_FACTORY


def native_launch_enabled() -> bool:
    """On by default: launching now runs through a deployed, public factory."""
    return env_flag("ENABLE_NATIVE_LAUNCH", True)


def mainnet_launch_enabled() -> bool:
    return env_flag("ENABLE_MAINNET_LAUNCH", True)


def send_transaction_allowed() -> tuple[bool, str]:
    """
    Kept for the proxy guard. Writes never pass through this server, so this
    only ever reports why a launch is off.
    """
    if not native_launch_enabled():
        return False, "Native launch is disabled."
    if not launchpad_address():
        return False, "Launchpad contract is not configured."
    if is_mainnet() and not mainnet_launch_enabled():
        return False, "Mainnet launch is disabled."
    return True, ""


def allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return []
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
