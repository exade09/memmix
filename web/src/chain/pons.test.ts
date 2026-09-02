import { describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, toBytes, toFunctionSelector } from "viem";
import {
  DEFAULT_LAUNCH_CONFIG_ID,
  MAX_CREATOR_TAX_BPS,
  NATIVE_PAIR_TOKEN,
  PONS_CURVE_ABI,
  PONS_FACTORY_ABI,
  emptySocials,
  freshSalt,
  ponsFactoryAddress,
} from "./pons";

/*
  This is the money path, so the ABI is checked against the signature written
  in Pons's own Solidity rather than trusted because it looks right. A tuple
  field in the wrong order still encodes and still sends: it just sends the
  wrong launch.
*/

const LAUNCH_TOKEN_SIGNATURE =
  "launchToken((string,string,string,string,(string,string,string,string,string),address,uint16,bool,bytes32,bytes32),uint256,address)";

describe("Pons v2 factory ABI", () => {
  it("encodes launchToken with the selector the deployed contract exposes", () => {
    const fromSolidity = keccak256(toBytes(LAUNCH_TOKEN_SIGNATURE)).slice(0, 10);
    const fromOurAbi = toFunctionSelector(
      PONS_FACTORY_ABI.find((entry) => entry.type === "function" && entry.name === "launchToken")!,
    );
    expect(fromOurAbi).toBe(fromSolidity);
  });

  it("encodes a full launch call without dropping a field", () => {
    const data = encodeFunctionData({
      abi: PONS_FACTORY_ABI,
      functionName: "launchToken",
      args: [
        {
          name: "Mixborn",
          symbol: "MIXB",
          logo: "ipfs://logo",
          description: "born from two",
          socials: { ...emptySocials(), twitter: "https://x.com/fons" },
          creatorFeeRecipient: "0x1111111111111111111111111111111111111111",
          creatorTaxBps: 0,
          buybackEnabled: false,
          expectedEconomics: `0x${"ab".repeat(32)}`,
          salt: freshSalt(),
        },
        DEFAULT_LAUNCH_CONFIG_ID,
        NATIVE_PAIR_TOKEN,
      ],
    });
    expect(data.startsWith(keccak256(toBytes(LAUNCH_TOKEN_SIGNATURE)).slice(0, 10))).toBe(true);
    // Every string we passed has to survive into the calldata.
    for (const value of ["Mixborn", "MIXB", "born from two"]) {
      expect(data).toContain(Buffer.from(value, "utf8").toString("hex"));
    }
  });

  it("matches the curve buy signature", () => {
    const expected = keccak256(toBytes("buy(uint256,uint256,address)")).slice(0, 10);
    const actual = toFunctionSelector(
      PONS_CURVE_ABI.find((entry) => entry.type === "function" && entry.name === "buy")!,
    );
    expect(actual).toBe(expected);
  });

  it("uses the verified factory and the native quote asset by default", () => {
    expect(ponsFactoryAddress().toLowerCase()).toBe("0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e");
    // pairToken == address(0) is what selects the native ETH curve.
    expect(NATIVE_PAIR_TOKEN).toBe("0x0000000000000000000000000000000000000000");
    // launchConfigCount() is 1 on chain, so 0 is the only accepted id.
    expect(DEFAULT_LAUNCH_CONFIG_ID).toBe(0n);
    expect(MAX_CREATOR_TAX_BPS).toBe(1000);
  });

  it("never repeats a CREATE2 salt", () => {
    const salts = new Set(Array.from({ length: 200 }, () => freshSalt()));
    expect(salts.size).toBe(200);
    for (const salt of salts) expect(salt).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
