from __future__ import annotations

"""
Finding the block a token was launched in.

$FONS launches through Pons, the same factory every token on the site uses,
which means its first block is already recorded on chain: the factory emits
TokenLaunched with the token address indexed. So the operator does not have
to copy a block number out of a terminal and paste it into a settings field
-- the one step in the launch checklist most likely to be fumbled, and the
one whose failure mode is silent. A start block that is wrong by a little
does not error; it just quietly drops every holder who bought earlier.

The lookup is one filtered call over the whole chain. The filter names both
the factory and the token, so the node returns a single log and the range
being unbounded costs nothing.
"""

from typing import Any

from axiom_scanner.chain.pons_abi import TOKEN_LAUNCHED_TOPIC, require_eth_address
from axiom_scanner.chain.rpc_client import RpcClient, RpcError


class LaunchLookupError(RuntimeError):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def find_launch(rpc: RpcClient, token: str, factory: str) -> dict[str, Any]:
    """
    The launch of `token` as the factory recorded it.

    Raises rather than returning a default: a guessed block would be accepted
    silently by everything downstream and quietly underpay real holders.
    """
    address = require_eth_address(token)
    token_topic = "0x" + address[2:].lower().rjust(64, "0")

    try:
        logs = rpc.call(
            "eth_getLogs",
            [
                {
                    "fromBlock": "0x0",
                    "toBlock": "latest",
                    "address": require_eth_address(factory),
                    "topics": ["0x" + TOKEN_LAUNCHED_TOPIC.hex(), token_topic],
                }
            ],
        )
    except RpcError as exc:
        raise LaunchLookupError(f"Could not read the chain: {exc}", "RPC_UNAVAILABLE") from exc

    if not logs:
        raise LaunchLookupError(
            "No launch was found for that address on the Pons factory. "
            "Either it was not launched through Pons, or the address is wrong.",
            "LAUNCH_NOT_FOUND",
        )

    # Earliest wins. A token can only be launched once, but taking the minimum
    # rather than the first element keeps this independent of node ordering.
    first = min(logs, key=lambda log: int(str(log.get("blockNumber") or "0x0"), 16))
    topics = first.get("topics") or []
    if len(topics) < 4:
        raise LaunchLookupError("The launch log is malformed.", "LAUNCH_NOT_FOUND")

    return {
        "token": address,
        "block_number": int(str(first.get("blockNumber") or "0x0"), 16),
        "curve": require_eth_address("0x" + str(topics[2])[-40:]),
        "deployer": require_eth_address("0x" + str(topics[3])[-40:]),
    }
