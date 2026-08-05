import { useSyncExternalStore } from "react";
import { getNetworkState, subscribeNetwork, type NetworkState } from "./networkMonitor";

/** Live main-thread network observation (count + off-policy destinations) for the trust badge. */
export function useNetwork(): NetworkState {
  return useSyncExternalStore(subscribeNetwork, getNetworkState, getNetworkState);
}
