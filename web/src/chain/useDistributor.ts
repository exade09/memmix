import { useEffect, useState } from "react";
import type { Address } from "viem";
import { appConfig } from "../app/config";
import { fetchPublicSettings } from "../services/api";
import { rewardsDistributorAddress } from "./rewards";

/*
  The addresses the browser needs, resolved at runtime.

  Both of these were build-time variables, so changing either meant a rebuild
  -- which made them the parts of the launch checklist that could not be done
  from the admin panel at all. The server answers now. The old variables stay
  as fallbacks, so an existing deployment keeps working unchanged.

  One fetch backs both hooks. `loading` matters for the distributor, because
  null means "no distributor" and drives a real message on screen: the first
  render must not claim that before the answer arrives.
*/

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

type PublicAddresses = {
  distributor: Address | null;
  token: Address | null;
  loading: boolean;
};

function usePublicAddresses(): PublicAddresses {
  const distributorFallback = rewardsDistributorAddress();
  const tokenFallback = ADDRESS_RE.test(appConfig.platformTokenAddress.trim())
    ? (appConfig.platformTokenAddress.trim() as Address)
    : null;

  const [state, setState] = useState<PublicAddresses>({
    distributor: distributorFallback,
    token: tokenFallback,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicSettings(controller.signal).then((settings) => {
      // A reachable server that knows nothing still answers: fall back
      // rather than blanking out an address the build already had.
      const pick = (served: string | null | undefined, fallback: Address | null): Address | null => {
        const raw = (served ?? "").trim();
        return ADDRESS_RE.test(raw) ? (raw as Address) : fallback;
      };
      setState({
        distributor: pick(settings?.distributor, distributorFallback),
        token: pick(settings?.token, tokenFallback),
        loading: false,
      });
    });
    return () => controller.abort();
    // Both fallbacks are build-time constants, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

export function useDistributor(): { distributor: Address | null; loading: boolean } {
  const { distributor, loading } = usePublicAddresses();
  return { distributor, loading };
}

/** $FONS itself, for the places that link to buying it. */
export function usePlatformToken(): Address | null {
  return usePublicAddresses().token;
}
