import { useSyncExternalStore } from "react";
import { getNetworkCount, subscribeNetwork } from "./networkMonitor";

/** Live count of script-initiated network requests on this page (drives the trust badge). */
export function useNetworkCount(): number {
  return useSyncExternalStore(subscribeNetwork, getNetworkCount, getNetworkCount);
}
