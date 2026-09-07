import { useEffect, useState } from "react";
import type { Address } from "viem";
import { fetchPublicSettings } from "../services/api";
import { rewardsDistributorAddress } from "./rewards";

/*
  Where claims are sent, resolved at runtime.

  This was a build-time variable, so setting it meant a rebuild -- which made
  it the one part of the launch checklist that could not be done from the
  admin panel. The server answers now, and the old variable stays as the
  fallback so an existing deployment keeps working unchanged.

  `loading` matters: null means "no distributor" and drives a real message on
  screen, so the first render must not claim that before the answer arrives.
*/

export function useDistributor(): { distributor: Address | null; loading: boolean } {
  const fallback = rewardsDistributorAddress();
  const [distributor, setDistributor] = useState<Address | null>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicSettings(controller.signal).then((settings) => {
      const raw = (settings?.distributor ?? "").trim();
      if (/^0x[a-fA-F0-9]{40}$/.test(raw)) setDistributor(raw as Address);
      else if (settings) setDistributor(fallback);
      setLoading(false);
    });
    return () => controller.abort();
    // The fallback is a build-time constant, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { distributor, loading };
}
