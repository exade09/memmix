from __future__ import annotations

"""
Pons v2 launch factory, spoken to server-side.

Every shape here is transcribed from the same source as web/src/chain/pons.ts
(the Pons team's MIT-licensed contractsV2/src/v2/), not guessed. The two
files must not drift: a field added to TOKEN_PARAMS_TYPE here without the
matching change there breaks a launch with a revert, not a readable error.
"""

from dataclasses import dataclass
from typing import Any

from eth_abi import decode, encode
from eth_utils import keccak, to_checksum_address

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# TokenParams, as a nested ABI tuple type string. Order matters: it is a
# positional tuple, not a named struct, on the wire.
SOCIALS_TYPE = "(string,string,string,string,string)"
TOKEN_PARAMS_TYPE = f"(string,string,string,string,{SOCIALS_TYPE},address,uint16,bool,bytes32,bytes32)"

LAUNCH_TOKEN_SIGNATURE = f"launchToken({TOKEN_PARAMS_TYPE},uint256,address)"
LAUNCH_FEE_SIGNATURE = "launchFee()"
LAUNCH_ENABLED_SIGNATURE = "launchEnabled()"
GET_LAUNCH_CONFIG_SIGNATURE = "getLaunchConfig(uint256)"
PREVIEW_ECONOMICS_SIGNATURE = "previewLaunchEconomics(uint256,address)"
CAN_LAUNCH_SIGNATURE = "canLaunch(address)"

LAUNCH_CONFIG_OUTPUT_TYPE = "(uint256,uint256,uint256,uint256,uint24,int24,bool)"


def selector(signature: str) -> bytes:
    return keccak(text=signature)[:4]


LAUNCH_TOKEN_SELECTOR = selector(LAUNCH_TOKEN_SIGNATURE)
LAUNCH_FEE_SELECTOR = selector(LAUNCH_FEE_SIGNATURE)
LAUNCH_ENABLED_SELECTOR = selector(LAUNCH_ENABLED_SIGNATURE)
GET_LAUNCH_CONFIG_SELECTOR = selector(GET_LAUNCH_CONFIG_SIGNATURE)
PREVIEW_ECONOMICS_SELECTOR = selector(PREVIEW_ECONOMICS_SIGNATURE)
CAN_LAUNCH_SELECTOR = selector(CAN_LAUNCH_SIGNATURE)

# keccak256("TokenLaunched(address,address,address,address,uint256,uint256)"),
# the first indexed topic every launch emits. Used to find the right log in a
# receipt that may carry other events (approvals, transfers) alongside it.
TOKEN_LAUNCHED_TOPIC = keccak(
    text="TokenLaunched(address,address,address,address,uint256,uint256)"
)


class EthAddressError(ValueError):
    pass


def require_eth_address(value: object) -> str:
    """Checksummed form, or raise. Mirrors viem's getAddress on the client."""
    text = str(value or "").strip()
    if not text.startswith("0x") or len(text) != 42:
        raise EthAddressError("That address is not a valid Ethereum address.")
    try:
        int(text, 16)
    except ValueError as exc:
        raise EthAddressError("That address is not a valid Ethereum address.") from exc
    try:
        return to_checksum_address(text)
    except ValueError as exc:
        raise EthAddressError("That address is not a valid Ethereum address.") from exc


@dataclass(frozen=True)
class Socials:
    twitter: str = ""
    telegram: str = ""
    discord: str = ""
    website: str = ""
    farcaster: str = ""

    def as_tuple(self) -> tuple[str, str, str, str, str]:
        return (self.twitter, self.telegram, self.discord, self.website, self.farcaster)


@dataclass(frozen=True)
class TokenParams:
    name: str
    symbol: str
    logo: str
    description: str
    socials: Socials
    creator_fee_recipient: str
    creator_tax_bps: int
    buyback_enabled: bool
    expected_economics: bytes
    salt: bytes

    def as_tuple(self) -> tuple[Any, ...]:
        return (
            self.name,
            self.symbol,
            self.logo,
            self.description,
            self.socials.as_tuple(),
            require_eth_address(self.creator_fee_recipient),
            self.creator_tax_bps,
            self.buyback_enabled,
            self.expected_economics,
            self.salt,
        )


def encode_launch_token_call(params: TokenParams, launch_config_id: int, pair_token: str) -> bytes:
    body = encode(
        [TOKEN_PARAMS_TYPE, "uint256", "address"],
        [params.as_tuple(), launch_config_id, require_eth_address(pair_token)],
    )
    return LAUNCH_TOKEN_SELECTOR + body


def encode_launch_fee_call() -> bytes:
    return LAUNCH_FEE_SELECTOR


def encode_launch_enabled_call() -> bytes:
    return LAUNCH_ENABLED_SELECTOR


def encode_get_launch_config_call(launch_config_id: int) -> bytes:
    return GET_LAUNCH_CONFIG_SELECTOR + encode(["uint256"], [launch_config_id])


def encode_preview_economics_call(launch_config_id: int, pair_token: str) -> bytes:
    return PREVIEW_ECONOMICS_SELECTOR + encode(
        ["uint256", "address"], [launch_config_id, require_eth_address(pair_token)]
    )


def encode_can_launch_call(account: str) -> bytes:
    return CAN_LAUNCH_SELECTOR + encode(["address"], [require_eth_address(account)])


def decode_uint256(data: bytes) -> int:
    return decode(["uint256"], data)[0]


def decode_bool(data: bytes) -> bool:
    return decode(["bool"], data)[0]


def decode_bytes32(data: bytes) -> bytes:
    return decode(["bytes32"], data)[0]


@dataclass(frozen=True)
class LaunchConfig:
    supply: int
    curve_fee_bps: int
    phantom_quote: int
    graduation_threshold: int
    pool_fee: int
    tick_spacing: int
    enabled: bool


def decode_launch_config(data: bytes) -> LaunchConfig:
    values = decode([LAUNCH_CONFIG_OUTPUT_TYPE], data)[0]
    supply, curve_fee_bps, phantom_quote, graduation_threshold, pool_fee, tick_spacing, enabled = values
    return LaunchConfig(
        supply=supply,
        curve_fee_bps=curve_fee_bps,
        phantom_quote=phantom_quote,
        graduation_threshold=graduation_threshold,
        pool_fee=pool_fee,
        tick_spacing=tick_spacing,
        enabled=enabled,
    )


def decode_launch_token_result(data: bytes) -> tuple[str, str]:
    token, curve = decode(["address", "address"], data)
    return require_eth_address(token), require_eth_address(curve)


def find_token_launched_log(logs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """
    The launch call can emit more than one log (curve init, approvals). This
    is the one indexed event every successful launch carries, so it is the
    reliable way to read back the addresses instead of trusting call output
    decoding on a transaction we only have a receipt for.
    """
    topic_hex = "0x" + TOKEN_LAUNCHED_TOPIC.hex()
    for log in logs:
        topics = log.get("topics") or []
        if topics and str(topics[0]).lower() == topic_hex.lower():
            return log
    return None


def decode_token_launched_log(log: dict[str, Any]) -> tuple[str, str, str]:
    topics = log.get("topics") or []
    if len(topics) < 4:
        raise ValueError("TokenLaunched log is missing indexed topics.")
    token = require_eth_address("0x" + str(topics[1])[-40:])
    curve = require_eth_address("0x" + str(topics[2])[-40:])
    deployer = require_eth_address("0x" + str(topics[3])[-40:])
    return token, curve, deployer
